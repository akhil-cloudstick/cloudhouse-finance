import { apiRequestEnveloped as apiRequest } from "./client";
import { Loan, LoanApproval, LoanRequest } from "../types/loan";

// q/status/branchId/customerId mirror backend/internal/loan/handler.go's
// LoanFilter — all server-side, per the plan's "no client-side filtering" rule.
export function listLoans(params?: { q?: string; status?: string; branchId?: number; customerId?: number }) {
  return apiRequest<Loan[]>("/loans", { params });
}

// Page-scoped variant: passing `limit` flips the backend (handler.go's
// List) into the {items, hasMore} envelope instead of the bare array above —
// used by the paginated mobile Loans list (10/page, one API call per page).
export function listLoansPage(params: {
  q?: string;
  status?: string;
  branchId?: number;
  customerId?: number;
  schemeId?: number;
  from?: string; // "YYYY-MM-DD", bounds openedDate (inclusive)
  to?: string; // "YYYY-MM-DD", bounds openedDate (inclusive)
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: Loan[]; hasMore: boolean }>("/loans", { params });
}

// Mirrors frontend/modules/loans/services/loanService.ts's getInterestCollected
// — GET /loans/interest-collected (backend/internal/loan/handler.go's
// GetInterestCollected), sums LoanPayment.interest_applied +
// penal_interest_applied over [from,to]. NOT branch-scoped (same as web);
// from/to default server-side to [first-of-current-month, today] when
// omitted, matching web Dashboard's own no-args call.
export function getInterestCollected(from?: string, to?: string) {
  return apiRequest<{ interestCollected: number; from: string; to: string }>("/loans/interest-collected", {
    params: { from, to },
  });
}

export function getLoan(id: number) {
  return apiRequest<Loan>(`/loans/${id}`);
}

// --- Create loan (backend/internal/loan/handler.go's loanRequest) ----------

export type CreateOrnamentInput = {
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight?: number;
  quantity?: number;
  remarks?: string;
};

export type CreateLoanInput = {
  branchId: number;
  customerId: number;
  schemeId: number;
  openedDate: string; // "YYYY-MM-DD"
  dueDate: string; // "YYYY-MM-DD"
  principalAmount: number;
  ornaments: CreateOrnamentInput[];
  lockerId?: number;
  // Optional free text captured at creation — anything the standard fields
  // don't cover, carried through onto the printed Statement of Account.
  additionalInfo?: string;
};

export function createLoan(input: CreateLoanInput) {
  return apiRequest<Loan>("/loans", { method: "POST", body: input });
}

// Attaches an already-uploaded ("/uploads/..." — see src/api/uploads.ts)
// image to an ornament. Called after createLoan() returns, once per
// photographed row — mirrors frontend/modules/loans/services/loanService.ts's
// addOrnamentImage, same route/body (backend/internal/loan/handler.go's
// AddOrnamentImage). An ornament can carry more than one image; this call
// just adds one.
export function addOrnamentImage(ornamentId: number, imageUrl: string) {
  return apiRequest<unknown>(`/loans/ornaments/${ornamentId}/images`, {
    method: "POST",
    body: { imageUrl },
  });
}

// --- Sanction-chain approvals (backend/internal/loan/handler.go's Approve/
// ListApprovals, POST/GET /loans/:id/approve|approvals) ---------------------

// Mirrors backend/internal/loan/model.go's SanctionStage* constants, in
// chain order: made by a Loan Operator, verified by the Loan Operator,
// approved by the Branch Manager, finally sanctioned by Management. (The
// retired 4th stage "AuthorizedManagement" made Management sign off twice;
// the backend migrates any loan still on it to FinalSanction.)
export const SANCTION_STAGES = ["LoanOperator", "BranchManager", "FinalSanction"] as const;
export type SanctionStage = (typeof SANCTION_STAGES)[number];

export const SANCTION_STAGE_LABELS: Record<SanctionStage, string> = {
  LoanOperator: "Verified by Loan Operator",
  BranchManager: "Approved by Branch Manager",
  FinalSanction: "Final Sanction (Management)",
};

// Which employee role must act at each stage — Administrator may always
// act too (enforced server-side, mirrored client-side only for UI gating).
export const SANCTION_STAGE_ROLES: Record<SanctionStage, string> = {
  LoanOperator: "Loan Operator",
  BranchManager: "Branch Manager",
  FinalSanction: "Management",
};

// Maps the retired AuthorizedManagement value onto the stage that replaced
// it, so a loan fetched before the backend migration ran still resolves to
// a pending stage instead of none.
export function normalizeSanctionStage(stage: string): SanctionStage | null {
  const s = stage === "AuthorizedManagement" ? "FinalSanction" : stage;
  return (SANCTION_STAGES as readonly string[]).includes(s) ? (s as SanctionStage) : null;
}

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

// --- Indemnity bond Aadhaar eSign (Setu) ------------------------------------
// Mirrors frontend/modules/loans/services/loanService.ts's
// startIndemnityBondEsign/checkIndemnityBondEsign exactly — same backend
// endpoints (backend/internal/loan/handler.go's StartIndemnityBondEsign/
// CheckIndemnityBondEsign).

export type BondLang = "en" | "gu";
// How the signing URL reaches the customer, in addition to always being
// returned to the caller (see backend/internal/loan/service.go's
// StartIndemnityBondSign doc comment):
//   - "open": no extra delivery — this screen opens the URL itself.
//   - "whatsapp": also sent to the customer's own WhatsApp.
//   - "dashboard": also pushed as an action card on customer-mobile.
export type BondDeliverBy = "open" | "whatsapp" | "dashboard";

export type IndemnityBondEsignStart = {
  id: string;
  documentId: string;
  status: string;
  url: string;
};

export function startIndemnityBondEsign(
  loanId: number,
  lang: BondLang,
  redirectUrl: string,
  deliverBy: BondDeliverBy = "open"
) {
  return apiRequest<IndemnityBondEsignStart>(`/loans/${loanId}/indemnity-bond/esign/start`, {
    method: "POST",
    body: { lang, redirectUrl, deliverBy },
  });
}

export type IndemnityBondEsignCheck = {
  loan: Loan;
  status: string;
};

export function checkIndemnityBondEsign(loanId: number) {
  return apiRequest<IndemnityBondEsignCheck>(`/loans/${loanId}/indemnity-bond/esign/status`);
}
