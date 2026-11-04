import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError, quietly } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { queueWrite } from "@/common/offline/queueWrite";
import { currentActor } from "@/common/offline/actor";
import { pendingInvestmentRow } from "@/common/offline/investmentAdjust";
import { PLAN_REF, findLocalPlan, localRequestId } from "@/common/offline/requestRef";
import { branchHeader } from "@/common/services/branchSelection";
import { printPdfJob } from "@/common/utils/print";
import type { InvestmentStatus, BackendInvestmentPlan, CreatePlanInput, BackendInvestment, BackendInvestmentTransaction, BackendInvestmentPayout, CreateInvestmentInput, InvestmentLedgerRow, MaturityAction, AddCashInput, WithdrawInput } from "@/modules/investments/types/investment-types";

/* Desktop, server not answering: the plan goes into the outbox and is listed (and offered for a new investment) at once under
 * a local id (see common/offline/investmentAdjust.ts); it is sent when the connection is back, before any investment made with
 * it. Otherwise the plan is created on the server as before. */
export async function createInvestmentPlan(input: CreatePlanInput): Promise<BackendInvestmentPlan> {
  try {
    // quiet: with no answer the plan is queued below, so no "couldn't reach" pop-up is wanted
    return await quietly(() => apiFetch<BackendInvestmentPlan>("/investment-plans", { method: "POST", body: JSON.stringify(input) }));
  } catch (e) {
    if (!(offlineReady() && e instanceof ApiError && e.status === 0)) throw e;
    const entry = newEntry("POST", "/investment-plans", input, currentActor());
    await enqueueAndWait(entry, () => undefined, () => undefined);
    return { id: localRequestId(entry.id), ...input } as BackendInvestmentPlan;
  }
}

export function updateInvestmentPlan(id: number, input: CreatePlanInput): Promise<BackendInvestmentPlan> {
  if (id < 0) throw new ApiError("This plan has not reached the server yet. Edit it once it has (it is sent as soon as the connection is back).", 409);
  return apiFetch<BackendInvestmentPlan>(`/investment-plans/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/* activeOnly=true is what the New Investment picker uses (only plans still
 * open for new money) — the plan admin screen passes false to also show
 * retired plans, since existing investments still reference them. */
export function listInvestmentPlans(activeOnly?: boolean): Promise<BackendInvestmentPlan[]> {
  const qs = activeOnly ? "?activeOnly=true" : "";
  return apiFetch<BackendInvestmentPlan[]>(`/investment-plans${qs}`);
}

/* One page of plans (1-based), searched by name on the server — backs the Plan filter's scrolling list. */
export function searchInvestmentPlansPage(q: string, page: number, limit = 20): Promise<{ items: BackendInvestmentPlan[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String((page - 1) * limit) });
  return apiFetch<{ items: BackendInvestmentPlan[]; hasMore: boolean }>(`/investment-plans?${params}`);
}

/* What the form already knows that the server would otherwise work out, so the investment can be listed before it is sent. */
export type CreateInvestmentHint = { customerName: string; customerCode: string; plan: BackendInvestmentPlan };

/* Desktop: an investment for an investor this PC registered, or with a plan this PC made (neither numbered by the server yet),
 * goes straight into the outbox, and so does one made while the server does not answer. It is listed at once as PENDING and sent
 * when the connection is there, after the investor and the plan, which the entry points at by their uuid / plan ref. Otherwise
 * the investment is created on the server exactly as before, so its real number comes back. */
export async function createInvestment(input: CreateInvestmentInput, hint?: CreateInvestmentHint): Promise<BackendInvestment> {
  if (offlineReady() && hint && (typeof input.customerId === "string" || input.planId < 0)) return queueInvestment(input, hint);
  try {
    return await quietly(() => apiFetch<BackendInvestment>("/investments", { method: "POST", body: JSON.stringify(input) }));
  } catch (e) {
    if (offlineReady() && hint && e instanceof ApiError && e.status === 0) return queueInvestment(input, hint);
    throw e;
  }
}

async function queueInvestment(input: CreateInvestmentInput, hint: CreateInvestmentHint): Promise<BackendInvestment> {
  let planId: number | string = input.planId;
  if (input.planId < 0) {
    const found = await findLocalPlan(input.planId);
    if (!found) throw new ApiError("This plan is no longer on this PC. Pick the plan again.", 409);
    planId = "entryId" in found ? PLAN_REF + found.entryId : found.serverId;
  }
  // no targets: the sender copies a reply's id onto the record a target names, and the reply here is an investment
  const entry = newEntry("POST", "/investments", { ...input, planId }, currentActor());
  entry.view = { customerName: hint.customerName, customerCode: hint.customerCode, plan: hint.plan };
  await enqueueAndWait(entry, () => undefined, () => undefined);
  return pendingInvestmentRow(entry, input, entry.view as { customerName: string; customerCode: string; plan: BackendInvestmentPlan }) as unknown as BackendInvestment;
}

export const INVESTMENTS_TABLE_PAGE_SIZE = 10;

/* Paginated, searched, filtered list — backs the Investments list page.
 * `page` is 1-based; the backend responds with an {items, hasMore, total}
 * envelope (see backend/internal/investment/handler.go's List) — mirrors
 * personalLoanService.ts's listPersonalLoansPage exactly. */
export function listInvestmentsPage(params: {
  page: number;
  q?: string;
  status?: string; // "All", one status, or several joined by commas
  customerId?: number;
  customerIds?: string[]; // any of these investors
  planIds?: string[]; // any of these plans
  from?: string; // YYYY-MM-DD, bounds the start date (inclusive)
  to?: string; // YYYY-MM-DD, bounds the start date (inclusive)
  pageSize?: number;
}): Promise<{ items: BackendInvestment[]; hasMore: boolean; total: number }> {
  const pageSize = params.pageSize || INVESTMENTS_TABLE_PAGE_SIZE;
  const query = new URLSearchParams({
    limit: String(pageSize),
    offset: String((params.page - 1) * pageSize),
  });
  if (params.q) query.set("q", params.q);
  if (params.status && params.status !== "All") query.set("status", params.status);
  if (params.customerId) query.set("customerId", String(params.customerId));
  if (params.customerIds?.length) query.set("customerIds", params.customerIds.join(","));
  // Not in the contract's key table, so sent under the backend's own name.
  if (params.planIds?.length) query.set("plan_ids", params.planIds.join(","));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  return apiFetch<{ items: BackendInvestment[]; hasMore: boolean; total: number }>(`/investments?${query}`);
}

export function getInvestment(id: number): Promise<BackendInvestment> {
  return apiFetch<BackendInvestment>(`/investments/${id}`);
}

/* Resolves "INV-00003" to its numeric id — lets a ledger reference link to
 * #investment/INV-00003 (see LedgerRefLink's "investment" kind). */
export async function resolveInvestmentNumber(number: string): Promise<number> {
  return (await apiFetch<{ id: number }>(`/investments/by-number/${encodeURIComponent(number)}`)).id;
}

/* One server page of the ledger; `page` is 0-based like getInvestmentSchedulePage. */
export const INVESTMENT_LEDGER_PAGE_SIZE = 10;

export async function getInvestmentLedgerPage(id: number, page: number, pageSize: number = INVESTMENT_LEDGER_PAGE_SIZE): Promise<{ items: InvestmentLedgerRow[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
  const res = await apiFetch<{ items: InvestmentLedgerRow[] | null; hasMore?: boolean }>(`/investments/${id}/ledger?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

export async function getInvestmentLedger(id: number): Promise<InvestmentLedgerRow[]> {
  return (await apiFetch<{ items: InvestmentLedgerRow[] | null }>(`/investments/${id}/ledger`)).items || [];
}

export const INVESTMENT_PAGE_SIZE = 20;

/* Unpaginated in practice (limit 20 comfortably covers a Monthly/12mo or
 * Yearly/multi-year schedule) — backs InvestmentDetail's schedule table.
 * `page` is 0-based, mirrors getPersonalLoanSchedulePage. */
export function getInvestmentSchedulePage(id: number, page: number, pageSize: number = INVESTMENT_PAGE_SIZE): Promise<{ items: BackendInvestmentPayout[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
  return apiFetch<{ items: BackendInvestmentPayout[]; hasMore: boolean }>(`/investments/${id}/schedule?${params}`);
}

export function markPayoutPaid(
  investmentId: number,
  payoutId: number,
  split: { cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number },
  bankId?: number
): Promise<BackendInvestmentPayout> {
  const path = `/investments/${investmentId}/payouts/${payoutId}/pay`;
  const body = { ...split, bankId };
  return queueWrite("POST", path, body, { id: payoutId, status: "Paid" } as unknown as BackendInvestmentPayout, () =>
    apiFetch<BackendInvestmentPayout>(path, { method: "POST", body: JSON.stringify(body) })
  );
}

export function matureInvestment(
  investmentId: number,
  input: { action: MaturityAction; planId?: number; principalAmount?: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number }
): Promise<BackendInvestment> {
  const path = `/investments/${investmentId}/mature`;
  return queueWrite("POST", path, input, undefined as unknown as BackendInvestment, () => apiFetch<BackendInvestment>(path, { method: "POST", body: JSON.stringify(input) })).then((r) => r ?? getInvestment(investmentId));
}

export function listInvestmentsForCustomer(customerId: number): Promise<BackendInvestment[]> {
  return apiFetch<BackendInvestment[]>(`/customers/${customerId}/investments`);
}

export function addCashToInvestment(investmentId: number, input: AddCashInput): Promise<BackendInvestment> {
  const path = `/investments/${investmentId}/add-cash`;
  return queueWrite("POST", path, input, undefined as unknown as BackendInvestment, () =>
    apiFetch<BackendInvestment>(path, { method: "POST", body: JSON.stringify(input) })
  ).then((r) => r ?? getInvestment(investmentId));
}

export function withdrawFromInvestment(investmentId: number, input: WithdrawInput): Promise<BackendInvestment> {
  const path = `/investments/${investmentId}/withdraw`;
  return queueWrite("POST", path, input, undefined as unknown as BackendInvestment, () =>
    apiFetch<BackendInvestment>(path, { method: "POST", body: JSON.stringify(input) })
  ).then((r) => r ?? getInvestment(investmentId));
}

export const INVESTMENT_TRANSACTIONS_PAGE_SIZE = 20;

/* `page` is 0-based, mirrors getInvestmentSchedulePage. */
export function getInvestmentTransactionsPage(
  investmentId: number,
  page: number
): Promise<{ items: BackendInvestmentTransaction[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    limit: String(INVESTMENT_TRANSACTIONS_PAGE_SIZE),
    offset: String(page * INVESTMENT_TRANSACTIONS_PAGE_SIZE),
  });
  return apiFetch<{ items: BackendInvestmentTransaction[]; hasMore: boolean }>(`/investments/${investmentId}/transactions?${params}`);
}

/* Fetches a PDF blob at the given investment endpoint path — shared helper
 * behind fetchInvestmentBondPdf and fetchInvestmentStatementPdf below. */
async function fetchInvestmentPdf(investmentId: number, path: string): Promise<Blob> {
  const token = typeof window !== "undefined" ? getAuthToken() : null;
  const res = await apiRawFetch(`/investments/${investmentId}/${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body — fall back to statusText */
    }
    throw new ApiError(message, res.status);
  }
  return res.blob();
}

/* Fetches GET /investments/:id/bond/pdf as a blob — shared by
 * printInvestmentBondPdf and printInvestmentStatementPdf below (straight to
 * the print dialog), mirroring loanService.ts's downloadIndemnityBondPDF/
 * downloadReleaseAgreementPDF print flow. Available for every investment
 * regardless of ProductType. */
async function fetchInvestmentBondPdf(investmentId: number): Promise<Blob> {
  return fetchInvestmentPdf(investmentId, "bond/pdf");
}

/* Fetches GET /investments/:id/statement/pdf as a blob — the investor
 * account statement (terms + full transaction/payout history). */
async function fetchInvestmentStatementPdf(investmentId: number): Promise<Blob> {
  return fetchInvestmentPdf(investmentId, "statement/pdf");
}

/* Sends the Debenture Subscription Agreement straight to the browser's
 * print dialog — same printPdfBlob flow as loanService.ts's
 * downloadIndemnityBondPDF/downloadReleaseAgreementPDF. */
export async function printInvestmentBondPdf(investmentId: number): Promise<void> {
  return printPdfJob(() => fetchInvestmentBondPdf(investmentId), undefined, `investment-bond-${investmentId}.pdf`);
}

/* Sends the investment's account statement straight to the browser's print
 * dialog — same printPdfBlob flow as printInvestmentBondPdf above. */
export async function printInvestmentStatementPdf(investmentId: number): Promise<void> {
  return printPdfJob(() => fetchInvestmentStatementPdf(investmentId), undefined, `investment-statement-${investmentId}.pdf`);
}


/* The unpaid interest months of a scheduled investment, oldest first. */
export async function getPendingInterest(investmentId: number): Promise<BackendInvestmentPayout[]> {
  return (await apiFetch<{ items: BackendInvestmentPayout[] | null }>(`/investments/${investmentId}/pending-interest`)).items || [];
}

/* Pays several months of interest together: the amount is applied to the oldest unpaid months in order, and the
 * payment breakdown (mode split + bank) is spread over them. The amount must be a whole number of months. */
export async function payInterestMonths(
  investmentId: number,
  input: { amount: number; cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number; bankId?: number }
): Promise<BackendInvestmentPayout[]> {
  const path = `/investments/${investmentId}/pay-interest`;
  return queueWrite("POST", path, input, [] as BackendInvestmentPayout[], async () => {
    const res = await apiFetch<{ items: BackendInvestmentPayout[] | null }>(path, { method: "POST", body: JSON.stringify(input) });
    return res.items || [];
  });
}

/* --- Ledger entry edit / delete ---
 * The investment is recalculated server-side in one transaction. dryRun asks for the before/after figures
 * without saving anything. entryId is the ledger row id ("tx-5", "payout-3", "open-7"). */
export type InvestmentLedgerSummary = {
  invested: number;
  outstandingPrincipal: number;
  outstandingInterest: number;
  totalInterestPaid: number;
  paidPayouts: number;
  status: string;
  startDate: string;
  maturityDate: string;
};
export type InvestmentLedgerEditPreview = { before: InvestmentLedgerSummary; after: InvestmentLedgerSummary; dryRun: boolean };
export type EditInvestmentLedgerInput = {
  occurredOn?: string;
  amount?: number; // opening / add-cash deposit
  principalAmount?: number; // withdrawal
  interestAmount?: number; // withdrawal
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
  reference?: string;
  reason?: string;
};

export function editInvestmentLedgerEntry(investmentId: number, entryId: string, input: EditInvestmentLedgerInput, dryRun = false): Promise<InvestmentLedgerEditPreview> {
  const path = `/investments/${investmentId}/ledger/${encodeURIComponent(entryId)}`;
  if (dryRun) return apiFetch<InvestmentLedgerEditPreview>(`${path}?dry_run=true`, { method: "PATCH", body: JSON.stringify(input) });
  return queueWrite("PATCH", path, input, { dryRun: false } as InvestmentLedgerEditPreview, () =>
    apiFetch<InvestmentLedgerEditPreview>(path, { method: "PATCH", body: JSON.stringify(input) })
  );
}

export function deleteInvestmentLedgerEntry(investmentId: number, entryId: string, dryRun = false, reason?: string): Promise<InvestmentLedgerEditPreview> {
  const path = `/investments/${investmentId}/ledger/${encodeURIComponent(entryId)}`;
  const qs = new URLSearchParams({ ...(reason ? { reason } : {}), ...(dryRun ? { dry_run: "true" } : {}) });
  if (dryRun) return apiFetch<InvestmentLedgerEditPreview>(`${path}?${qs}`, { method: "DELETE" });
  return queueWrite("DELETE", reason ? `${path}?${qs}` : path, undefined, { dryRun: false } as InvestmentLedgerEditPreview, () =>
    apiFetch<InvestmentLedgerEditPreview>(`${path}?${qs}`, { method: "DELETE" })
  );
}

/* Closes an active/matured investment that owes the investor nothing more (every payout paid, principal paid
 * back) — no cash moves. The backend refuses with what is still owed otherwise. */
export function closeInvestment(investmentId: number): Promise<BackendInvestment> {
  const path = `/investments/${investmentId}/close`;
  return queueWrite("POST", path, undefined, undefined as unknown as BackendInvestment, () => apiFetch<BackendInvestment>(path, { method: "POST" })).then((r) => r ?? getInvestment(investmentId));
}

/* Deletes an investment at any stage, reversing every cash entry it booked, in one transaction server-side.
 * Needs the "can delete investment" permission. */
export async function deleteInvestment(investmentId: number): Promise<void> {
  const path = `/investments/${investmentId}/delete`;
  await queueWrite("DELETE", path, undefined, undefined, async () => {
    await apiFetch<unknown>(path, { method: "DELETE" });
  });
}
