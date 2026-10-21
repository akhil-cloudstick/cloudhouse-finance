import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";

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

export type RequestApproval = {
  id: number;
  requestId: number;
  stage: string; // Extension: "LoanOfficer" | "BranchManager" | "Management"; Release: "Manager" | "Management"
  action: string; // "Approved" | "Rejected"
  actorEmployeeId: number;
  remarks?: string;
  createdAt: string;
};

export type LoanRequest = {
  id: number;
  loanId: number;
  type: "Extension" | "Release";
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: string;
  detail?: string;
  requestedExtensionMonths?: number | null;
  newDueDate?: string | null;
  // First two stages apply only to Extension, "PendingManager" only to Release.
  approvalStage?: string;
  charges: number;
  settlementAmount: number;
  remarks?: string;
  requestedAt: string;
  decidedAt?: string | null;
  createdAt: string;
};

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

// GET /customer/loans?status=&limit=&offset= — server-side filtered, no client-side filtering of one fetched list.
export function listLoans(params: {
  status?: string;
  limit: number;
  offset: number;
}): Promise<{ items: Loan[]; hasMore: boolean }> {
  return apiRequest("/loans", { params });
}

// GET /customer/loans with no limit: backend returns every loan as a bare array when limit is omitted.
export function listAllLoans(): Promise<Loan[]> {
  return apiRequest("/loans");
}

export function getLoan(id: number): Promise<Loan> {
  return apiRequest(`/loans/${id}`);
}

export function listLoanRequests(loanId: number): Promise<LoanRequest[]> {
  return apiRequest(`/loans/${loanId}/requests`);
}

export function requestExtension(id: number, input: { months: number; detail?: string }): Promise<LoanRequest> {
  return apiRequest(`/loans/${id}/extension-request`, { method: "POST", body: input });
}

export function requestRelease(id: number, input: { detail?: string }): Promise<LoanRequest> {
  return apiRequest(`/loans/${id}/release-request`, { method: "POST", body: input });
}
