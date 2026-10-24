import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError, quietly } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
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
  return apiFetch<BackendPersonalLoan>(`/personal-loans/${id}/approve`, { method: "POST", body: JSON.stringify(input) });
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
  return apiFetch<{ items: BackendPersonalLoan[]; hasMore: boolean; total: number }>(`/personal-loans?${query}`);
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
  return apiFetch<BackendPersonalLoan>(`/personal-loans/${id}/payments`, { method: "POST", body: JSON.stringify(input) });
}

export function previewRenewal(id: number, input: RenewInput): Promise<RenewalPreview> {
  return apiFetch<RenewalPreview>(`/personal-loans/${id}/renewal-preview`, { method: "POST", body: JSON.stringify(input) });
}

export function renewPersonalLoan(id: number, input: RenewInput): Promise<RenewResult> {
  return apiFetch<RenewResult>(`/personal-loans/${id}/renew`, { method: "POST", body: JSON.stringify(input) });
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
