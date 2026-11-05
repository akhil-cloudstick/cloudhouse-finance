import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError, quietly } from "@/common/services/httpClient";
import { changeWithEntry, enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { waitingPersonalPayments } from "@/common/offline/personalLoanAdjust";
import { canMakeOffline, localPerson, renderAndPrint } from "@/common/offline/documents";
import { getBusinessProfile } from "@/modules/settings/services/businessProfileService";
import { queueWrite } from "@/common/offline/queueWrite";
import { currentActor } from "@/common/offline/actor";
import { localRequestId } from "@/common/offline/requestRef";
import { branchHeader } from "@/common/services/branchSelection";
import { printPdfJob } from "@/common/utils/print";
import type { CreatePersonalLoanInput, BackendPersonalLoan, BackendPersonalLoanInstallment, BackendPersonalLoanPayment, PersonalLoanApprovalInput, PersonalLoanApprovalRecord, BackendPersonalLoanHistory, RenewInput, RenewalPreview, RenewResult, PersonalLoanBondLang } from "@/modules/personal-loans/types/personal-loan-types";

/* With the personal_loan approval flow switched on the loan comes back
 * "Pending Approval" (with approvalStage set) — no schedule or disbursement
 * until the final stage approves it (approvePersonalLoan below). */
/* What the form already knows that the server would otherwise work out, so the loan can be listed before it is sent. */
export type CreatePersonalLoanHint = { customerName: string; customerCode: string; needsApproval: boolean };

/* Desktop: a loan for a customer this PC registered (not numbered by the server yet) goes straight into the outbox, and so
 * does one made while the server does not answer; it is listed at once as PENDING (see common/offline/personalLoanAdjust.ts)
 * and sent when the connection is there, the customer first, as the entry points at the customer by its uuid. Otherwise the
 * loan is created on the server exactly as before, so its real number comes back. */
export async function createPersonalLoan(input: CreatePersonalLoanInput, hint?: CreatePersonalLoanHint): Promise<BackendPersonalLoan> {
  if (offlineReady() && hint && typeof input.customerId === "string") return queuePersonalLoan(input, hint);
  try {
    // quiet: with no answer the loan is queued below, so no "couldn't reach" pop-up is wanted
    return await quietly(() => apiFetch<BackendPersonalLoan>("/personal-loans", { method: "POST", body: JSON.stringify(input) }));
  } catch (e) {
    if (offlineReady() && hint && e instanceof ApiError && e.status === 0) return queuePersonalLoan(input, hint);
    throw e;
  }
}

async function queuePersonalLoan(input: CreatePersonalLoanInput, hint: CreatePersonalLoanHint): Promise<BackendPersonalLoan> {
  // no targets: the sender copies a reply's id onto the record a target names, and the reply here is a personal loan, not the customer
  const entry = newEntry("POST", "/personal-loans", input, currentActor());
  const status = hint.needsApproval ? "Pending Approval" : "Active";
  entry.view = { customerName: hint.customerName, customerCode: hint.customerCode, status };
  await enqueueAndWait(entry, () => undefined, () => undefined);
  const interest = Math.round((input.interestType === "Percentage" ? (input.principalAmount * input.interestValue) / 100 : input.interestValue) * 100) / 100;
  const obligation = input.fullDisbursement ? Math.round((input.principalAmount + interest) * 100) / 100 : input.principalAmount;
  return {
    id: localRequestId(entry.id),
    loanNumber: "Pending",
    branchId: input.branchId,
    customerId: 0,
    customer: { id: 0, name: hint.customerName, code: hint.customerCode, phone: "" },
    principalAmount: input.principalAmount,
    interestType: input.interestType,
    interestValue: input.interestValue,
    interestAmount: interest,
    disbursedAmount: input.fullDisbursement ? input.principalAmount : Math.round((input.principalAmount - interest) * 100) / 100,
    fullDisbursement: !!input.fullDisbursement,
    frequency: input.frequency,
    tenureCount: input.tenureCount,
    installmentAmount: input.tenureCount > 0 ? Math.round((obligation / input.tenureCount) * 100) / 100 : 0,
    outstandingAmount: obligation,
    totalPaid: 0,
    status,
    approvalStage: "",
    openedDate: entry.occurredAt.slice(0, 10),
    disbursedAt: entry.occurredAt,
    closedAt: null,
    renewedFromLoanId: null,
    renewedToLoanId: null,
    penalInterestRate: input.penalInterestRate ?? 0,
    penalFlatAmount: 0,
    gracePeriodDays: input.gracePeriodDays ?? 0,
    penalCycleCount: 0,
    totalPenalInterestCharged: 0,
    lastPenalAppliedAt: null,
    createdAt: entry.occurredAt,
  } as BackendPersonalLoan;
}

export function approvePersonalLoan(id: number, input: PersonalLoanApprovalInput): Promise<BackendPersonalLoan> {
  const path = `/personal-loans/${id}/approve`;
  return queueWrite("POST", path, input, undefined as unknown as BackendPersonalLoan, () =>
    apiFetch<BackendPersonalLoan>(path, { method: "POST", body: JSON.stringify(input) })
  ).then((r) => r ?? getPersonalLoan(id));
}

export async function listPersonalLoanApprovals(id: number): Promise<PersonalLoanApprovalRecord[]> {
  return (await apiFetch<PersonalLoanApprovalRecord[]>(`/personal-loans/${id}/approvals`)) || [];
}

export const PERSONAL_LOANS_TABLE_PAGE_SIZE = 10;

/* Paginated, searched, filtered list — backs the Personal Loans list page.
 * `page` is 1-based (matching Loans.tsx's convention); the backend responds
 * with an {items, hasMore, total} envelope (see
 * backend/internal/personalloan/handler.go's List) — `total` is the real
 * row count across every page, so the list can show "Page N of M" instead
 * of just enabling/disabling Next. */
export function listPersonalLoansPage(params: {
  page: number;
  q?: string;
  frequency?: string; // one value or a comma-separated list
  customerId?: number;
  status?: string; // one value or a comma-separated list
  from?: string; // YYYY-MM-DD, bounds the opened date (inclusive)
  to?: string; // YYYY-MM-DD, bounds the opened date (inclusive)
  pageSize?: number;
}): Promise<{ items: BackendPersonalLoan[]; hasMore: boolean; total: number }> {
  const pageSize = params.pageSize || PERSONAL_LOANS_TABLE_PAGE_SIZE;
  const query = new URLSearchParams({
    limit: String(pageSize),
    offset: String((params.page - 1) * pageSize),
  });
  if (params.q) query.set("q", params.q);
  if (params.frequency) query.set("frequency", params.frequency);
  if (params.customerId) query.set("customerId", String(params.customerId));
  if (params.status) query.set("status", params.status);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  return apiFetch<{ items: BackendPersonalLoan[]; hasMore: boolean; total: number }>(`/personal-loans?${query}`);
}

/* Deletes a personal loan and reverses its disbursement in the cash book. The backend refuses
 * a loan that still has payments or is part of a renewal, answering with the reason. */
export async function deletePersonalLoan(id: number): Promise<void> {
  const path = `/personal-loans/${id}`;
  await queueWrite("DELETE", path, undefined, undefined, async () => {
    await apiFetch<unknown>(path, { method: "DELETE" });
  });
}

export function getPersonalLoan(id: number): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>(`/personal-loans/${id}`);
}

/* Resolves a loan number ("PL-00003") — what a ledger's Ref No links
 * with — to the loan's numeric id. */
export async function resolvePersonalLoanNumber(number: string): Promise<number> {
  return (await apiFetch<{ id: number }>(`/personal-loans/by-number/${encodeURIComponent(number)}`)).id;
}

export const PERSONAL_LOAN_PAGE_SIZE = 10;

/* Paginated schedule/payments — backs PersonalLoanDetail's infinite-scroll
 * panels. `page` is 0-based; the backend responds with an
 * {items, hasMore, total} envelope (see
 * backend/internal/personalloan/handler.go's Schedule/Payments) — `total` is
 * the real row count so the pager can show "Page N of M" instead of an
 * hasMore-derived estimate. */
export function getPersonalLoanSchedulePage(id: number, page: number, pageSize: number = PERSONAL_LOAN_PAGE_SIZE): Promise<{ items: BackendPersonalLoanInstallment[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
  return apiFetch<{ items: BackendPersonalLoanInstallment[]; hasMore: boolean; total: number }>(`/personal-loans/${id}/schedule?${params}`);
}

export function listPersonalLoanPaymentsPage(id: number, page: number, pageSize: number = PERSONAL_LOAN_PAGE_SIZE): Promise<{ items: BackendPersonalLoanPayment[]; hasMore: boolean; total: number; totalDebit: number; totalCredit: number }> {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize), order: "desc" });
  return apiFetch<{ items: BackendPersonalLoanPayment[]; hasMore: boolean; total: number; totalDebit: number; totalCredit: number }>(`/personal-loans/${id}/payments?${params}`);
}

export function getPersonalLoanHistoryPage(id: number, page: number, pageSize: number = PERSONAL_LOAN_PAGE_SIZE): Promise<{ items: BackendPersonalLoanHistory[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
  return apiFetch<{ items: BackendPersonalLoanHistory[]; hasMore: boolean; total: number }>(`/personal-loans/${id}/history?${params}`);
}

export function recordPersonalLoanPayment(
  id: number,
  input: {
    amount: number;
    cashAmount?: number;
    upiAmount?: number;
    bankTransferAmount?: number;
    chequeAmount?: number;
    bankId?: number;
    reference?: string;
    description?: string;
  }
): Promise<BackendPersonalLoan> {
  const path = `/personal-loans/${id}/payments`;
  return queueWrite("POST", path, input, undefined as unknown as BackendPersonalLoan, () =>
    apiFetch<BackendPersonalLoan>(path, { method: "POST", body: JSON.stringify(input) })
  ).then((r) => r ?? getPersonalLoan(id));
}

export function previewRenewal(id: number, input: RenewInput): Promise<RenewalPreview> {
  return apiFetch<RenewalPreview>(`/personal-loans/${id}/renewal-preview`, { method: "POST", body: JSON.stringify(input) });
}

export function renewPersonalLoan(id: number, input: RenewInput): Promise<RenewResult> {
  const path = `/personal-loans/${id}/renew`;
  return queueWrite("POST", path, input, { renewed: true } as unknown as RenewResult, () =>
    apiFetch<RenewResult>(path, { method: "POST", body: JSON.stringify(input) })
  );
}

export function listPersonalLoansForCustomer(customerId: number): Promise<BackendPersonalLoan[]> {
  return apiFetch<BackendPersonalLoan[]>(`/customers/${customerId}/personal-loans`);
}

/* Sends GET /personal-loans/:id/bond?lang= (the borrower-only bond PDF, see
 * backend/modules/PersonalLoan/controllers/bond.go) straight to the browser's print
 * dialog via printPdfBlob — same server-rendered-PDF-to-print-preview
 * pattern as loanService.ts's downloadIndemnityBondPDF, rather than
 * silently triggering a browser file save with no visible preview. */
export async function downloadPersonalLoanBond(loanId: number, lang: PersonalLoanBondLang): Promise<void> {
  try {
    return await downloadPersonalLoanBondOnline(loanId, lang);
  } catch (e) {
    if (!canMakeOffline(e)) throw e;
    // the server did not answer: the bond is made on this PC from the loan and customer it holds
    const loan = await getPersonalLoan(loanId);
    const [profile] = await Promise.all([getBusinessProfile().catch(() => null)]);
    return renderAndPrint("personal-loan-bond", lang, { personalLoan: loan, person: localPerson(loan.customerId), profile: profile ?? {} });
  }
}

async function downloadPersonalLoanBondOnline(loanId: number, lang: PersonalLoanBondLang): Promise<void> {
  return printPdfJob(async () => {
    const token = typeof window !== "undefined" ? getAuthToken() : null;
    const res = await apiRawFetch(`/personal-loans/${loanId}/bond?lang=${lang}`, {
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
  }, undefined, `personal-loan-bond-${loanId}.pdf`);
}

/* --- Ledger edit / delete -------------------------------------------------
 * Editing or deleting a payment recalculates the loan balances, instalments and
 * status on the server in one transaction. dryRun asks for the before/after figures
 * without saving. The disbursement can be edited (date, payment breakdown) but not
 * deleted or re-amounted. */
import type { InstalmentChangeView } from "@/modules/personal-loans/components/InstalmentChangesTable";
export type PersonalLedgerSummary = { outstanding: number; totalPaid: number; status: string };
/* A later payment that no longer fits once an earlier one is edited: what it can still be (0 = it would be removed). */
export type PersonalFollowingEntry = { id: number; paidOn: string; reference?: string; current: number; suggested: number; needsChange?: boolean };
export type PersonalLedgerEditPreview = { before: PersonalLedgerSummary; after: PersonalLedgerSummary; dryRun: boolean; following?: PersonalFollowingEntry[]; instalmentChanges?: InstalmentChangeView[] };
export type EditPersonalPaymentInput = {
  paidOn?: string;
  amount?: number;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
  reference?: string;
  description?: string;
  reason?: string;
  adjustFollowing?: { id: number; amount: number }[]; // the amounts chosen for the later payments that no longer fit
};
export type EditPersonalDisbursementInput = {
  disbursedAt?: string;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
  reason?: string;
};

/* A payment collected on this PC and not sent yet is listed under a local (negative) id. Its entry is rewritten (or dropped) so
 * the server only ever hears of the corrected payment; the screens are built from the outbox, so they follow at once. */
async function waitingPersonalPayment(loanId: number, paymentId: number) {
  const hit = (await waitingPersonalPayments(loanId)).find((w) => w.localId === paymentId);
  if (!hit) throw new ApiError("This payment was just sent. Refresh, then edit it.", 409);
  return hit;
}

export function editPersonalLoanPayment(loanId: number, paymentId: number, input: EditPersonalPaymentInput, dryRun = false): Promise<PersonalLedgerEditPreview> {
  if (!dryRun && offlineReady() && paymentId < 0) {
    return waitingPersonalPayment(loanId, paymentId).then(async ({ entry, body }) => {
      const next = {
        ...body,
        amount: input.amount ?? body.amount,
        cashAmount: input.cashAmount ?? body.cashAmount,
        upiAmount: input.upiAmount ?? body.upiAmount,
        bankTransferAmount: input.bankTransferAmount ?? body.bankTransferAmount,
        chequeAmount: input.chequeAmount ?? body.chequeAmount,
        bankId: input.bankId ?? body.bankId,
        reference: input.reference ?? body.reference,
        description: input.description ?? body.description,
      };
      await changeWithEntry(entry.id, JSON.stringify({ ...entry, body: next }), () => undefined);
      return { dryRun: false } as unknown as PersonalLedgerEditPreview;
    });
  }
  const path = `/personal-loans/${loanId}/payments/${paymentId}`;
  if (dryRun) return apiFetch<PersonalLedgerEditPreview>(`${path}?dry_run=true`, { method: "PATCH", body: JSON.stringify(input) });
  return queueWrite("PATCH", path, input, { dryRun: false } as unknown as PersonalLedgerEditPreview, () =>
    apiFetch<PersonalLedgerEditPreview>(path, { method: "PATCH", body: JSON.stringify(input) })
  );
}

export function deletePersonalLoanPayment(loanId: number, paymentId: number, dryRun = false, reason?: string): Promise<PersonalLedgerEditPreview> {
  if (!dryRun && offlineReady() && paymentId < 0) {
    return waitingPersonalPayment(loanId, paymentId).then(async ({ entry }) => {
      await changeWithEntry(entry.id, "", () => undefined);
      return { dryRun: false } as unknown as PersonalLedgerEditPreview;
    });
  }
  const path = `/personal-loans/${loanId}/payments/${paymentId}`;
  const qs = new URLSearchParams({ ...(reason ? { reason } : {}), ...(dryRun ? { dry_run: "true" } : {}) });
  if (dryRun) return apiFetch<PersonalLedgerEditPreview>(`${path}?${qs}`, { method: "DELETE" });
  return queueWrite("DELETE", reason ? `${path}?${qs}` : path, undefined, { dryRun: false } as unknown as PersonalLedgerEditPreview, () =>
    apiFetch<PersonalLedgerEditPreview>(`${path}?${qs}`, { method: "DELETE" })
  );
}

export function editPersonalLoanDisbursement(loanId: number, input: EditPersonalDisbursementInput, dryRun = false): Promise<PersonalLedgerEditPreview> {
  const path = `/personal-loans/${loanId}/disbursement`;
  if (dryRun) return apiFetch<PersonalLedgerEditPreview>(`${path}?dry_run=true`, { method: "PATCH", body: JSON.stringify(input) });
  return queueWrite("PATCH", path, input, { dryRun: false } as unknown as PersonalLedgerEditPreview, () =>
    apiFetch<PersonalLedgerEditPreview>(path, { method: "PATCH", body: JSON.stringify(input) })
  );
}
