import { apiFetchEnveloped as apiFetch, API_BASE, getAuthToken, ApiError } from "@/common/services/httpClient";
import { printPdfBlob } from "@/common/utils/print";

export type InterestType = "Flat" | "Percentage";
export type Frequency = "Daily" | "Weekly" | "Monthly";
export type PersonalLoanStatus = "Active" | "Pending" | "Closed" | "Renewed" | "Defaulted";

/* Mirrors backend/internal/personalloan/handler.go's createRequest exactly. */
export type CreatePersonalLoanInput = {
  branchId: number;
  customerId: number;
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
  /* When true, disburses the full principal now with no interest withheld
   * upfront — the customer owes principal + the full interest back instead
   * of today's default (interest withheld upfront, principal-only
   * repayment). Defaults to false server-side when omitted. */
  fullDisbursement?: boolean;
  /* Omit or 0 to default to the loan's own effective interest rate — see
   * backend CreateInput.PenalInterestRate's doc comment. */
  penalInterestRate?: number;
  /* Omit or 0 for no grace period. */
  gracePeriodDays?: number;
};

/* Mirrors backend/internal/personalloan/model_loan.go's PersonalLoan
 * exactly (only the fields the frontend needs). */
export type BackendPersonalLoan = {
  id: number;
  loanNumber: string;
  branchId: number;
  customerId: number;
  customer: { id: number; name: string; code: string; phone: string };
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  interestAmount: number;
  disbursedAmount: number;
  fullDisbursement: boolean;
  frequency: Frequency;
  tenureCount: number;
  installmentAmount: number;
  outstandingAmount: number;
  totalPaid: number;
  status: PersonalLoanStatus;
  openedDate: string;
  disbursedAt: string;
  closedAt: string | null;
  renewedFromLoanId: number | null;
  renewedToLoanId: number | null;
  penalInterestRate: number;
  penalFlatAmount: number;
  gracePeriodDays: number;
  penalCycleCount: number;
  totalPenalInterestCharged: number;
  lastPenalAppliedAt: string | null;
  createdAt: string;
};

/* Mirrors backend/internal/personalloan/model_installment.go's
 * PersonalLoanInstallment exactly. */
export type BackendPersonalLoanInstallment = {
  id: number;
  personalLoanId: number;
  sequenceNo: number;
  dueDate: string;
  amount: number;
  status: "Pending" | "Paid" | "PartiallyPaid";
  paidAmount: number;
};

/* Mirrors backend/internal/personalloan/model_payment.go's
 * PersonalLoanPayment exactly. */
export type BackendPersonalLoanPayment = {
  id: number;
  personalLoanId: number;
  amount: number;
  paidOn: string;
  receivedByEmployeeId: number | null;
  /* Derived/display-only — the single mode's name when exactly one split
   * amount below is non-zero, "Split" when more than one is. */
  method: string;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  reference: string;
  description: string;
  runningBalance: number;
  installmentId: number | null;
  // Which bank the UPI/Bank Transfer/Cheque portion landed in — see
  // backend PersonalLoanPayment.BankID's doc comment. Nil for a Cash-only
  // payment.
  bankId?: number | null;
  bankRef?: { id: number; name: string } | null;
  createdAt: string;
};

export function createPersonalLoan(input: CreatePersonalLoanInput): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>("/personal-loans", { method: "POST", body: JSON.stringify(input) });
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
  frequency?: Frequency;
  customerId?: number;
  status?: string;
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

export const PERSONAL_LOAN_PAGE_SIZE = 10;

/* Paginated schedule/payments — backs PersonalLoanDetail's infinite-scroll
 * panels. `page` is 0-based; the backend responds with an
 * {items, hasMore, total} envelope (see
 * backend/internal/personalloan/handler.go's Schedule/Payments) — `total` is
 * the real row count so the pager can show "Page N of M" instead of an
 * hasMore-derived estimate. */
export function getPersonalLoanSchedulePage(id: number, page: number): Promise<{ items: BackendPersonalLoanInstallment[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ limit: String(PERSONAL_LOAN_PAGE_SIZE), offset: String(page * PERSONAL_LOAN_PAGE_SIZE) });
  return apiFetch<{ items: BackendPersonalLoanInstallment[]; hasMore: boolean; total: number }>(`/personal-loans/${id}/schedule?${params}`);
}

export function listPersonalLoanPaymentsPage(id: number, page: number): Promise<{ items: BackendPersonalLoanPayment[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ limit: String(PERSONAL_LOAN_PAGE_SIZE), offset: String(page * PERSONAL_LOAN_PAGE_SIZE) });
  return apiFetch<{ items: BackendPersonalLoanPayment[]; hasMore: boolean; total: number }>(`/personal-loans/${id}/payments?${params}`);
}

/* Mirrors backend/internal/personalloan/model_history.go's
 * PersonalLoanHistory exactly. */
export type BackendPersonalLoanHistory = {
  id: number;
  personalLoanId: number;
  event: "loan_created" | "penal_applied" | "loan_renewed";
  detail: string;
  amount: number;
  relatedLoanId: number | null;
  occurredAt: string;
  createdAt: string;
};

export function getPersonalLoanHistoryPage(id: number, page: number): Promise<{ items: BackendPersonalLoanHistory[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ limit: String(PERSONAL_LOAN_PAGE_SIZE), offset: String(page * PERSONAL_LOAN_PAGE_SIZE) });
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

export type RenewInput = {
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
};

export type RenewalPreview = {
  rollover: number;
  interestAmount: number;
  disbursedAmount: number;
  shortfall: boolean;
};

export function previewRenewal(id: number, input: RenewInput): Promise<RenewalPreview> {
  return apiFetch<RenewalPreview>(`/personal-loans/${id}/renewal-preview`, { method: "POST", body: JSON.stringify(input) });
}

export type RenewResult = { oldLoan: BackendPersonalLoan; newLoan: BackendPersonalLoan };

export function renewPersonalLoan(id: number, input: RenewInput): Promise<RenewResult> {
  return apiFetch<RenewResult>(`/personal-loans/${id}/renew`, { method: "POST", body: JSON.stringify(input) });
}

export function listPersonalLoansForCustomer(customerId: number): Promise<BackendPersonalLoan[]> {
  return apiFetch<BackendPersonalLoan[]>(`/customers/${customerId}/personal-loans`);
}

/* Sends GET /personal-loans/:id/bond (the borrower-only bond PDF, see
 * backend/internal/personalloan/bond.go) straight to the browser's print
 * dialog via printPdfBlob — same server-rendered-PDF-to-print-preview
 * pattern as loanService.ts's downloadIndemnityBondPDF, rather than
 * silently triggering a browser file save with no visible preview. */
export async function downloadPersonalLoanBond(loanId: number): Promise<void> {
  const token = typeof window !== "undefined" ? getAuthToken() : null;
  const res = await fetch(`${API_BASE}/personal-loans/${loanId}/bond`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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

  const blob = await res.blob();
  printPdfBlob(blob);
}
