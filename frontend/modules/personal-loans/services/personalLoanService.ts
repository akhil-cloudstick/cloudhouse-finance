import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError } from "@/common/services/httpClient";
import { branchHeader } from "@/common/services/branchSelection";
import { printPdfJob } from "@/common/utils/print";
import type { CreatePersonalLoanInput, BackendPersonalLoan, BackendPersonalLoanInstallment, BackendPersonalLoanPayment, PersonalLoanApprovalInput, PersonalLoanApprovalRecord, BackendPersonalLoanHistory, RenewInput, RenewalPreview, RenewResult } from "@/modules/personal-loans/types/personal-loan-types";

/* With the personal_loan approval flow switched on the loan comes back
 * "Pending Approval" (with approvalStage set) — no schedule or disbursement
 * until the final stage approves it (approvePersonalLoan below). */
export function createPersonalLoan(input: CreatePersonalLoanInput): Promise<BackendPersonalLoan> {
  return apiFetch<BackendPersonalLoan>("/personal-loans", { method: "POST", body: JSON.stringify(input) });
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
export function getPersonalLoanSchedulePage(id: number, page: number): Promise<{ items: BackendPersonalLoanInstallment[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ limit: String(PERSONAL_LOAN_PAGE_SIZE), offset: String(page * PERSONAL_LOAN_PAGE_SIZE) });
  return apiFetch<{ items: BackendPersonalLoanInstallment[]; hasMore: boolean; total: number }>(`/personal-loans/${id}/schedule?${params}`);
}

export function listPersonalLoanPaymentsPage(id: number, page: number): Promise<{ items: BackendPersonalLoanPayment[]; hasMore: boolean; total: number; totalDebit: number; totalCredit: number }> {
  const params = new URLSearchParams({ limit: String(PERSONAL_LOAN_PAGE_SIZE), offset: String(page * PERSONAL_LOAN_PAGE_SIZE), order: "desc" });
  return apiFetch<{ items: BackendPersonalLoanPayment[]; hasMore: boolean; total: number; totalDebit: number; totalCredit: number }>(`/personal-loans/${id}/payments?${params}`);
}

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

export function previewRenewal(id: number, input: RenewInput): Promise<RenewalPreview> {
  return apiFetch<RenewalPreview>(`/personal-loans/${id}/renewal-preview`, { method: "POST", body: JSON.stringify(input) });
}

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
  return printPdfJob(async () => {
    const token = typeof window !== "undefined" ? getAuthToken() : null;
    const res = await apiRawFetch(`/personal-loans/${loanId}/bond`, {
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
  });
}
