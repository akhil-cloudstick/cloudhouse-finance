import { apiRequest } from "./client";
import { Loan, LoanApproval, LoanRequest } from "../types/loan";

// q/status/branchId/customerId mirror backend/internal/loan/handler.go's
// LoanFilter — all server-side, per the plan's "no client-side filtering" rule.
export function listLoans(params?: { q?: string; status?: string; branchId?: number; customerId?: number }) {
  return apiRequest<Loan[]>("/loans", { params });
}

export function getLoan(id: number) {
  return apiRequest<Loan>(`/loans/${id}`);
}

// --- Sanction-chain approvals (backend/internal/loan/handler.go's Approve/
// ListApprovals, POST/GET /loans/:id/approve|approvals) ---------------------

// Mirrors backend/internal/loan/model.go's SanctionStage* constants, in
// chain order.
export const SANCTION_STAGES = [
  "LoanOperator",
  "BranchManager",
  "AuthorizedManagement",
  "FinalSanction",
] as const;
export type SanctionStage = (typeof SANCTION_STAGES)[number];

export const SANCTION_STAGE_LABELS: Record<SanctionStage, string> = {
  LoanOperator: "Loan Operator",
  BranchManager: "Branch Manager",
  AuthorizedManagement: "Authorized Management",
  FinalSanction: "Final Sanction",
};

// Which employee role must act at each stage — Administrator may always
// act too (enforced server-side, mirrored client-side only for UI gating).
export const SANCTION_STAGE_ROLES: Record<SanctionStage, string> = {
  LoanOperator: "Loan Operator",
  BranchManager: "Branch Manager",
  AuthorizedManagement: "Management",
  FinalSanction: "Management",
};

export function approveLoan(
  loanId: number,
  input: { stage: SanctionStage | string; action: "Approved" | "Rejected" | "Verified"; remarks?: string }
) {
  return apiRequest<Loan>(`/loans/${loanId}/approve`, { method: "POST", body: input });
}

export function listLoanApprovals(loanId: number) {
  return apiRequest<LoanApproval[]>(`/loans/${loanId}/approvals`);
}

export function getLoanOperatorApprovalLimit() {
  return apiRequest<{ maxAmount: number }>("/loans/approval-limits/loan-operator");
}

// --- Extension / release requests (backend/internal/loan/handler.go's
// CreateExtensionRequest/CreateReleaseRequest/ListRequests/DecideRequest/
// VerifyReleaseChecklist/ApproveReleaseRequest/CompleteRelease) -------------

export function createExtensionRequest(
  loanId: number,
  input: { months: number; detail?: string; requestedBy?: string }
) {
  return apiRequest<LoanRequest>(`/loans/${loanId}/extension-request`, { method: "POST", body: input });
}

export function createReleaseRequest(loanId: number, input: { detail?: string; requestedBy?: string }) {
  return apiRequest<LoanRequest>(`/loans/${loanId}/release-request`, { method: "POST", body: input });
}

export function listLoanRequests(params?: { status?: string; loanId?: number }) {
  return apiRequest<LoanRequest[]>("/loans/requests", { params });
}

// action: "Approved" | "Rejected" — the single-step decision used for
// Extension requests (and for a Release request before its checklist/
// approval-chain steps have started).
export function decideLoanRequest(requestId: number, action: "Approved" | "Rejected", remarks?: string) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/decide`, {
    method: "PUT",
    body: { action, remarks },
  });
}

// Release-request verification checklist — all four booleans must be true
// before the release approval chain (below) can be submitted.
export function verifyReleaseChecklist(
  requestId: number,
  input: {
    paymentVerified?: boolean;
    packetVerified?: boolean;
    bankPledgeVerified?: boolean;
    customerConfirmed?: boolean;
    verificationNotes?: string;
    charges?: number;
  }
) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/verify`, { method: "PUT", body: input });
}

// Release-request approval chain (PendingManager -> PendingManagement ->
// Approved/Rejected) — same two-role hand-off shape as the loan sanction
// chain above, but scoped to the request, not the loan.
export function approveReleaseRequest(
  requestId: number,
  input: { stage: string; action: "Approved" | "Rejected"; remarks?: string }
) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/approve`, { method: "POST", body: input });
}

// Finalizes a fully-approved release request: hands the gold back to the
// customer and closes the loan. Requires the outstanding balance to be
// zero and no active bank pledge (enforced server-side).
export function completeRelease(loanId: number) {
  return apiRequest<Loan>(`/loans/${loanId}/complete-release`, { method: "POST" });
}
