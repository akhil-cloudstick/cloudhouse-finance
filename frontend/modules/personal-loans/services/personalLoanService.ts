import { apiFetchEnveloped as apiFetch, API_BASE, AUTH_TOKEN_KEY, ApiError } from "@/common/services/httpClient";

export type InterestType = "Flat" | "Percentage";
export type Frequency = "Daily" | "Weekly" | "Monthly";
export type PersonalLoanStatus = "Active" | "Closed" | "Renewed" | "Defaulted";

/* Mirrors backend/internal/personalloan/handler.go's createRequest exactly. */
export type CreatePersonalLoanInput = {
  branchId: number;
  customerId: number;
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
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
  method: string;
  reference: string;
  description: string;
  runningBalance: number;
  installmentId: number | null;
  createdAt: string;
};

export function createPersonalLoan(input: CreatePersonalLoanInput): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>("/personal-loans", { method: "POST", body: JSON.stringify(input) });
}

export const PERSONAL_LOANS_TABLE_PAGE_SIZE = 10;

/* Paginated, searched, filtered list — backs the Personal Loans list page.
 * `page` is 1-based (matching Loans.tsx's convention); the backend responds
 * with an {items, hasMore} envelope (see
 * backend/internal/personalloan/handler.go's List). */
export function listPersonalLoansPage(params: {
  page: number;
  q?: string;
  frequency?: Frequency;
  customerId?: number;
  status?: string;
}): Promise<{ items: BackendPersonalLoan[]; hasMore: boolean }> {
  const query = new URLSearchParams({
    limit: String(PERSONAL_LOANS_TABLE_PAGE_SIZE),
    offset: String((params.page - 1) * PERSONAL_LOANS_TABLE_PAGE_SIZE),
  });
  if (params.q) query.set("q", params.q);
  if (params.frequency) query.set("frequency", params.frequency);
  if (params.customerId) query.set("customerId", String(params.customerId));
  if (params.status) query.set("status", params.status);
  return apiFetch<{ items: BackendPersonalLoan[]; hasMore: boolean }>(`/personal-loans?${query}`);
}

export function getPersonalLoan(id: number): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>(`/personal-loans/${id}`);
}

export const PERSONAL_LOAN_PAGE_SIZE = 10;

/* Paginated schedule/payments — backs PersonalLoanDetail's infinite-scroll
 * panels. `page` is 0-based; the backend responds with an
 * {items, hasMore} envelope (see backend/internal/personalloan/handler.go's
 * Schedule/Payments). */
export function getPersonalLoanSchedulePage(id: number, page: number): Promise<{ items: BackendPersonalLoanInstallment[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(PERSONAL_LOAN_PAGE_SIZE), offset: String(page * PERSONAL_LOAN_PAGE_SIZE) });
  return apiFetch<{ items: BackendPersonalLoanInstallment[]; hasMore: boolean }>(`/personal-loans/${id}/schedule?${params}`);
}

export function listPersonalLoanPaymentsPage(id: number, page: number): Promise<{ items: BackendPersonalLoanPayment[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(PERSONAL_LOAN_PAGE_SIZE), offset: String(page * PERSONAL_LOAN_PAGE_SIZE) });
  return apiFetch<{ items: BackendPersonalLoanPayment[]; hasMore: boolean }>(`/personal-loans/${id}/payments?${params}`);
}

export function recordPersonalLoanPayment(
  id: number,
  input: { amount: number; method: string; reference?: string; description?: string }
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

/* Downloads GET /personal-loans/:id/bond (the borrower-only bond PDF, see
 * backend/internal/personalloan/bond.go) as a blob and triggers a browser
 * save — same fetch → blob → temporary <a download> pattern as
 * frontend/modules/reports/services/reportsService.ts's exportReport(). */
export async function downloadPersonalLoanBond(loanId: number): Promise<void> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem(AUTH_TOKEN_KEY) : null;
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
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `bond-${loanId}.pdf`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
