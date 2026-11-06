import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError, quietly } from "@/common/services/httpClient";
import { changeWithEntry, enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { pendingLoanKey, waitingPersonalPayments } from "@/common/offline/personalLoanAdjust";
import { createsPersonalLoan } from "@/common/offline/requestRef";
import { dropUnsentRecord } from "@/common/offline/unsent";
import { assertPayoutFunds, partsOfSplit } from "@/common/offline/funds";
import { canMakeOffline, localPerson, renderAndPrint } from "@/common/offline/documents";
import { getBusinessProfile } from "@/modules/settings/services/businessProfileService";
import { queueWrite } from "@/common/offline/queueWrite";
import { refuse, requirePositive, requireNotNegative, requireValidSplit } from "@/common/offline/validate";
import { currentActor } from "@/common/offline/actor";
import { enabledStages, fetchApprovalWorkflow } from "@/common/services/approvalWorkflowService";
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
  // the server's own input checks (SavePersonalLoan), made before anything is queued
  requirePositive(input.principalAmount, "principal amount must be greater than zero");
  requirePositive(input.tenureCount, "tenure count must be greater than zero");
  if (!["Daily", "Weekly", "Monthly"].includes(input.frequency)) refuse("frequency must be Daily, Weekly or Monthly");
  if (!["Flat", "Percentage"].includes(input.interestType)) refuse("interest type must be Flat or Percentage");
  requireNotNegative(input.interestValue, "interest value must not be negative");
  requireNotNegative(input.penalInterestRate, "penal interest rate must not be negative");
  requireNotNegative(input.gracePeriodDays, "grace period days must not be negative");
  {
    const principal = Math.round(input.principalAmount * 100) / 100;
    const interestAmt = Math.round((input.interestType === "Percentage" ? (principal * input.interestValue) / 100 : input.interestValue) * 100) / 100;
    if (interestAmt >= principal) refuse("interest amount must be less than the principal amount");
    requireValidSplit(input.fullDisbursement ? principal : Math.round((principal - interestAmt) * 100) / 100, input);
  }
  // With no approval step the loan is paid out at once, so the till or the chosen bank has to cover what is handed over (omitted split = all cash).
  if (!hint.needsApproval) {
    const interest = input.interestType === "Percentage" ? (input.principalAmount * input.interestValue) / 100 : input.interestValue;
    const handedOver = input.fullDisbursement ? input.principalAmount : Math.max(0, input.principalAmount - interest);
    const split = input.cashAmount || input.upiAmount || input.bankTransferAmount || input.chequeAmount ? input : { ...input, cashAmount: handedOver };
    await assertPayoutFunds(input.branchId, partsOfSplit(split));
  }
  // no targets: the sender copies a reply's id onto the record a target names, and the reply here is a personal loan, not the customer
  const entry = newEntry("POST", "/personal-loans", input, currentActor());
  const status = hint.needsApproval ? "Pending Approval" : "Active";
  entry.view = { customerName: hint.customerName, customerCode: hint.customerCode, status };
  await enqueueAndWait(entry, () => undefined, () => undefined);
  const interest = Math.round((input.interestType === "Percentage" ? (input.principalAmount * input.interestValue) / 100 : input.interestValue) * 100) / 100;
  const obligation = input.fullDisbursement ? Math.round((input.principalAmount + interest) * 100) / 100 : input.principalAmount;
  return {
    id: localRequestId(entry.id),
    // a local number the loan page can open it by (see personalLoanAdjust.ts): the server numbers it when it is sent
    loanNumber: pendingLoanKey(entry.id),
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

/* Corrects a loan's terms — only before any payment, renewal or penal charge (the backend answers with the reason otherwise). */
export function editPersonalLoan(id: number, input: Partial<CreatePersonalLoanInput> & { reason?: string }): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>(`/personal-loans/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function approvePersonalLoan(id: number, input: PersonalLoanApprovalInput): Promise<BackendPersonalLoan> {
  const path = `/personal-loans/${id}/approve`;
  const check = async () => {
    if (!offlineReady()) return;
    if (input.action !== "Approved" && input.action !== "Rejected") refuse("action must be Approved or Rejected");
    const loan = await readLoan(id);
    if (loan && loan.status !== "Pending Approval") refuse("this personal loan is not waiting for approval", 409);
    // The last stage pays the loan out, from the split it was made with (kept on the loan): the till or the chosen bank has to cover it.
    if (loan && id > 0 && input.action === "Approved") {
      const chain = enabledStages(await fetchApprovalWorkflow().catch(() => []), "personal_loan");
      if (chain.length > 0 && chain[chain.length - 1].key === input.stage) {
        const l = loan as unknown as { branchId: number; disbursementCashAmount?: number; disbursementUpiAmount?: number; disbursementBankTransferAmount?: number; disbursementBankId?: number | null };
        await assertPayoutFunds(l.branchId, [
          { mode: "Cash", amount: l.disbursementCashAmount },
          { mode: "UPI", amount: l.disbursementUpiAmount, bankId: l.disbursementBankId },
          { mode: "Bank Transfer", amount: l.disbursementBankTransferAmount, bankId: l.disbursementBankId },
        ]);
      }
    }
  };
  return check().then(() => queueWrite("POST", path, input, undefined as unknown as BackendPersonalLoan, () =>
    apiFetch<BackendPersonalLoan>(path, { method: "POST", body: JSON.stringify(input) })
  )).then((r) => r ?? getPersonalLoan(id));
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
  // one made on this PC and not sent yet: deleting it takes back the entry that creates it (and the payments taken on it since)
  if (id < 0 && offlineReady()) {
    if (await dropUnsentRecord(id, createsPersonalLoan)) return;
    throw new ApiError("This loan was sent while you were deleting it. Refresh, then delete it.", 409);
  }
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
  const check = offlineReady() ? checkPersonalPayment(id, input) : Promise.resolve();
  return check.then(() => queueWrite("POST", path, input, undefined as unknown as BackendPersonalLoan, () =>
    apiFetch<BackendPersonalLoan>(path, { method: "POST", body: JSON.stringify(input) })
  )).then((r) => r ?? getPersonalLoan(id));
}

/* The loan as this PC shows it (it already counts the entries waiting to be sent); null when it cannot be read, and then nothing is blocked. */
async function readLoan(id: number): Promise<BackendPersonalLoan | null> {
  try {
    return await getPersonalLoan(id);
  } catch {
    return null;
  }
}

async function checkPersonalPayment(id: number, input: { amount: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number }): Promise<void> {
  requirePositive(input.amount, "payment amount must be greater than zero");
  const loan = await readLoan(id);
  if (loan) {
    if (loan.status !== "Active" && loan.status !== "Pending") refuse("loan is not active", 409);
    if (Math.round(input.amount) > Math.round(loan.outstandingAmount)) refuse("payment amount exceeds the outstanding balance");
  }
  const amount = Math.round(input.amount);
  const sum = (input.cashAmount ?? 0) + (input.upiAmount ?? 0) + (input.bankTransferAmount ?? 0) + (input.chequeAmount ?? 0);
  // here the server wants the parts to add up (no all-cash default) and a bank for any non-cash part
  if (Math.abs(sum - amount) > 0.01) refuse(`payment breakdown (${sum.toFixed(2)}) does not match the amount (${amount.toFixed(2)})`);
  if ((input.upiAmount ?? 0) > 0 || (input.bankTransferAmount ?? 0) > 0 || (input.chequeAmount ?? 0) > 0) {
    if (!input.bankId) refuse("bank is required for UPI, transfer or cheque");
  }
}

export function previewRenewal(id: number, input: RenewInput): Promise<RenewalPreview> {
  return apiFetch<RenewalPreview>(`/personal-loans/${id}/renewal-preview`, { method: "POST", body: JSON.stringify(input) });
}

export function renewPersonalLoan(id: number, input: RenewInput): Promise<RenewResult> {
  const path = `/personal-loans/${id}/renew`;
  const check = async () => {
    if (!offlineReady()) return;
    requirePositive(input.principalAmount, "principal amount must be greater than zero");
    requirePositive(input.tenureCount, "tenure count must be greater than zero");
    if (!["Daily", "Weekly", "Monthly"].includes(input.frequency)) refuse("frequency must be Daily, Weekly or Monthly");
    if (!["Flat", "Percentage"].includes(input.interestType)) refuse("interest type must be Flat or Percentage");
    requireNotNegative(input.interestValue, "interest value must not be negative");
    const loan = await readLoan(id);
    if (loan && loan.status !== "Active" && loan.status !== "Pending") refuse("loan is not active", 409);
    const principal = Math.round(input.principalAmount * 100) / 100;
    const interest = Math.round((input.interestType === "Percentage" ? (principal * input.interestValue) / 100 : input.interestValue) * 100) / 100;
    if (!loan) return;
    const disbursed = Math.round((principal - loan.outstandingAmount - interest) * 100) / 100;
    if (disbursed < 0) refuse("new principal is below the amount owed");
    if (interest >= principal) refuse("interest amount must be less than the principal amount");
    if (disbursed > 0.005) {
      requireValidSplit(disbursed, input);
      const noSplit = !input.cashAmount && !input.upiAmount && !input.bankTransferAmount;
      await assertPayoutFunds(loan.branchId, partsOfSplit(noSplit ? { cashAmount: disbursed } : input));
    }
  };
  return check().then(() => queueWrite("POST", path, input, { renewed: true } as unknown as RenewResult, () =>
    apiFetch<RenewResult>(path, { method: "POST", body: JSON.stringify(input) })
  ));
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
