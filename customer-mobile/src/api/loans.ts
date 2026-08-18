import { apiRequest } from "./client";

// Mirrors the subset of backend/internal/loan/model.go's Ornament JSON
// shape the Loan Detail screen needs.
export type Ornament = {
  id: number;
  loanId: number;
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight: number;
  netWeight: number;
  quantity: number;
  goldValue: number;
  remarks?: string;
};

// Mirrors backend/internal/loan/model.go's RequestApproval — one row per
// decision at an Extension/Release request's approval-chain stage.
export type RequestApproval = {
  id: number;
  requestId: number;
  stage: string; // Extension: "LoanOfficer" | "BranchManager" | "Management"; Release: "Manager" | "Management"
  action: string; // "Approved" | "Rejected"
  actorEmployeeId: number;
  remarks?: string;
  createdAt: string;
};

// Mirrors backend/internal/loan/model.go's LoanRequest — an Extension or
// Release request, staged through ApprovalStage (see
// backend/internal/loan/service.go's ApproveExtensionRequest/
// ApproveReleaseRequest).
export type LoanRequest = {
  id: number;
  loanId: number;
  type: "Extension" | "Release";
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: string;
  detail?: string;
  requestedExtensionMonths?: number | null;
  newDueDate?: string | null;
  // "PendingLoanOfficer" | "PendingBranchManager" | "PendingManagement" |
  // "PendingManager" | "Approved" | "Rejected" — the first two only apply
  // to Extension, "PendingManager" only to Release.
  approvalStage?: string;
  charges: number;
  settlementAmount: number;
  remarks?: string;
  requestedAt: string;
  decidedAt?: string | null;
  createdAt: string;
};

// Mirrors the subset of backend/internal/loan/model.go's Loan JSON shape
// the customer app's My Loans list/Loan Detail screens use.
export type Loan = {
  id: number;
  loanNumber: string;
  branchId: number;
  customerId: number;
  scheme?: { id: number; name: string };
  status: string;
  openedDate: string;
  dueDate: string;
  principalAmount: number;
  outstandingAmount: number;
  accruedInterest?: number;
  interestPaid?: number;
  accruedPenalInterest?: number;
  penalInterestPaid?: number;
  outstandingInterest?: number;
  outstandingPenalInterest?: number;
  totalOutstandingBalance?: number;
  settlementAmount?: number;
  totalPaid?: number;
  totalNetWeight?: number;
  totalGoldValue?: number;
  isDefaulted?: boolean;
  isOverdue?: boolean;
  isDueSoon?: boolean;
  daysOverdue?: number;
  bankPledgeStatus?: string;
  ornaments?: Ornament[];
};

// GET /customer/loans?status=&limit=&offset= — paginated, server-side
// filtered per the "every filter chip is its own API call" rule (no
// client-side filtering of one fetched list).
export function listLoans(params: {
  status?: string;
  limit: number;
  offset: number;
}): Promise<{ items: Loan[]; hasMore: boolean }> {
  return apiRequest("/loans", { params });
}

// GET /customer/loans, no limit param — the backend's CustomerListLoans
// only paginates when limit>0, otherwise it returns every one of the
// caller's loans as a bare array. Used by the Dashboard's My Loans/
// Reminders KPI cards, which need the whole set (all statuses/due dates) to
// summarize, not one page of it.
export function listAllLoans(): Promise<Loan[]> {
  return apiRequest("/loans");
}

// GET /customer/loans/:id — 404s if the loan isn't the caller's own.
export function getLoan(id: number): Promise<Loan> {
  return apiRequest(`/loans/${id}`);
}

// GET /customer/loans/:id/requests — every Extension/Release request ever
// logged against this loan, newest first (mirrors the staff app's
// GET /loans/requests?loanId=). Used to show an already-pending request's
// current stage on a fresh screen load, not only right after this session
// submitted one.
export function listLoanRequests(loanId: number): Promise<LoanRequest[]> {
  return apiRequest(`/loans/${loanId}/requests`);
}

// POST /customer/loans/:id/extension-request.
export function requestExtension(id: number, input: { months: number; detail?: string }): Promise<LoanRequest> {
  return apiRequest(`/loans/${id}/extension-request`, { method: "POST", body: input });
}

// POST /customer/loans/:id/release-request.
export function requestRelease(id: number, input: { detail?: string }): Promise<LoanRequest> {
  return apiRequest(`/loans/${id}/release-request`, { method: "POST", body: input });
}
