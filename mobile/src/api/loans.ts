import { apiRequestEnveloped as apiRequest } from "./client";
import { Loan, LoanApproval, LoanRequest, LoanRiskLevel, LoanRiskRow, LoanTopUp } from "../types/loan";
import type { SplitAmounts } from "./investments";

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
  // Auction case buckets, computed server-side (replaces the old on-phone
  // isDefaulted filter): eligible | defaulted | auctioned_balance_due.
  auctionCase?: string;
  bankPledgeStatus?: string;
  excludeBankPledged?: boolean;
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: Loan[]; hasMore: boolean; total?: number }>("/loans", { params });
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

// Risk-eligible statuses — mirrors loanService.ts's RISK_STATUSES, sent as
// the `status` filter's options ("All statuses" sends none).
export const RISK_STATUSES = ["Active", "Due Soon", "Overdue", "Closure Requested", "Defaulted", "Auction Eligible"] as const;

export type LoanRiskCounts = { loss: number; atRisk: number; safe: number };

// GET /loans/risk-assessment — see LoanRiskRow's own doc comment. `total`/
// `counts` cover every loan matching status/from/to (NOT riskLevel below —
// see loanService.ts's LoanRiskCounts doc comment on the web side), not
// just this page, for the screen's KPI tiles.
export function listLoanRiskAssessmentPage(params: {
  q?: string;
  status?: string;
  riskLevel?: LoanRiskLevel;
  from?: string; // "YYYY-MM-DD", bounds openedDate
  to?: string;
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: LoanRiskRow[]; hasMore: boolean; total: number; counts: LoanRiskCounts }>(
    "/loans/risk-assessment",
    { params }
  );
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

// --- Ornament add/update/delete (backend/internal/loan/handler.go's
// AddOrnament/UpdateOrnament/DeleteOrnament) — callable regardless of the
// loan's sanction stage, mirrors frontend/modules/loans/services/
// loanService.ts's addOrnament/updateOrnament/deleteOrnament exactly. Used
// by the Edit Loan sheet's per-ornament rows.
export type OrnamentRequestInput = {
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight?: number;
  quantity?: number;
  remarks?: string;
};

export function addOrnament(loanId: number, input: OrnamentRequestInput) {
  return apiRequest<Loan>(`/loans/${loanId}/ornaments`, { method: "POST", body: input });
}

export function updateOrnament(ornamentId: number, input: OrnamentRequestInput) {
  return apiRequest<Loan>(`/loans/ornaments/${ornamentId}`, { method: "PUT", body: input });
}

// Refused server-side if this is the loan's last remaining ornament, or if
// the loan is already Closed/Auctioned — see backend Service.DeleteOrnament.
export function deleteOrnament(ornamentId: number) {
  return apiRequest<Loan>(`/loans/ornaments/${ornamentId}`, { method: "DELETE" });
}

// --- Sanction-chain approvals (backend/internal/loan/handler.go's Approve/
// ListApprovals, POST/GET /loans/:id/approve|approvals) ---------------------

// Which sanction stages a loan walks — and which permission acts at each —
// is per-tenant configuration now (src/api/approvalWorkflow.ts, flow
// "loan_sanction"): the chain starts at the first enabled stage and the LAST
// enabled stage disburses. Stage keys are the chain's role keys ("R<roleId>",
// set on the web's Approval Workflow tab) or, on loans raised before that,
// LoanOperator / BranchManager / FinalSanction (key and pending value are
// identical for this flow).
export type SanctionStage = string;

// Maps the retired AuthorizedManagement value onto the stage that replaced
// it, so a loan fetched before the backend migration ran still resolves to
// a pending stage instead of none. A decided loan (Approved / Rejected / "")
// is null; anything else is a pending stage — accepting only the three
// legacy keys hid Approve/Disburse on every loan waiting at an "R<roleId>"
// stage.
export function normalizeSanctionStage(stage: string | null | undefined): SanctionStage | null {
  const s = stage === "AuthorizedManagement" ? "FinalSanction" : stage ?? "";
  return s && s !== "Approved" && s !== "Rejected" ? s : null;
}

export function approveLoan(
  loanId: number,
  // The split is required on the FINAL enabled stage's approval, which
  // disburses the loan: it must add up to the disbursed amount
  // (platform.ValidateSplit).
  input: { stage: SanctionStage | string; action: "Approved" | "Rejected" | "Verified"; remarks?: string } & Partial<SplitAmounts>
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

// ornamentIds: the ornaments to hand back. Empty, or every still-pledged
// ornament, is a full release; a strict subset is a partial release.
export function createReleaseRequest(loanId: number, input: { detail?: string; requestedBy?: string; ornamentIds?: number[] }) {
  return apiRequest<LoanRequest>(`/loans/${loanId}/release-request`, { method: "POST", body: input });
}

export function listLoanRequests(params?: { status?: string; loanId?: number }) {
  return apiRequest<LoanRequest[]>("/loans/requests", { params });
}

// Page-scoped variant: passing `limit` flips the backend into the
// {items, hasMore} envelope instead of the bare array above — mirrors
// listLoansPage, used by the standalone Requests list screen (10/page).
export function listLoanRequestsPage(params: {
  // Server-side search (loan no. / customer name / customer ID) and request
  // type filter: "extension" | "release".
  q?: string;
  type?: string;
  status?: string;
  loanId?: number;
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: LoanRequest[]; hasMore: boolean }>("/loans/requests", { params });
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

// Release verification: the single "customer has seen the gold" flag
// (locked once a release payment is recorded), plus notes and charges.
export function verifyReleaseChecklist(
  requestId: number,
  input: {
    customerSawGold?: boolean;
    verificationNotes?: string;
    charges?: number;
  }
) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/verify`, { method: "PUT", body: input });
}

// Records a payment (and optional discount, posted first as its own entry)
// against a release request; unapplied charges are folded in server-side.
// The split must sum to `amount` (platform.ValidateSplit). Sets
// paymentRecorded/locked and advances the request to Management the first
// time. dueDate is only needed when a FULL release is still short after it.
export function recordReleasePayment(
  requestId: number,
  input: {
    type?: string;
    amount: number;
    discount: number;
    cashAmount: number;
    upiAmount: number;
    bankTransferAmount: number;
    chequeAmount: number;
    reference?: string;
    dueDate?: string;
  }
) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/release-payment`, { method: "POST", body: input });
}

// Stage decision on an Extension / Release request —
// POST /loans/requests/:requestId/approve; the backend dispatches on the
// request's own Type. `stage` is the stage KEY from the request's flow in
// src/api/approvalWorkflow.ts (loan_extension / loan_release).
export function approveLoanRequest(
  requestId: number,
  input: { stage: string; action: "Approved" | "Rejected"; remarks?: string }
) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/approve`, { method: "POST", body: input });
}

export const approveReleaseRequest = approveLoanRequest;
export const approveExtensionRequest = approveLoanRequest;

// Finalizes a fully-approved release request: hands the gold back to the
// customer and closes the loan. Requires the outstanding balance to be
// zero and no active bank pledge (enforced server-side).
export function completeRelease(loanId: number) {
  return apiRequest<Loan>(`/loans/${loanId}/complete-release`, { method: "POST" });
}

// --- Edit Loan / Hard Delete (backend/internal/loan/handler.go's
// UpdateLoan/HardDeleteLoan) — mirrors frontend/modules/loans/services/
// loanService.ts's updateLoan/hardDeleteLoan exactly. Ornaments themselves
// go through addOrnament/updateOrnament/deleteOrnament above, one at a
// time, not through this. -------------------------------------------------

export type UpdateLoanInput = { schemeId?: number; principalAmount?: number };

export function updateLoan(loanId: number, input: UpdateLoanInput) {
  return apiRequest<Loan>(`/loans/${loanId}`, { method: "PATCH", body: input });
}

// Permanently deletes a loan and every record tied to it — a real DELETE,
// no undo. Gated server-side by its own "can hard delete loan" permission,
// independent of the ordinary "can delete loan" grant.
export function hardDeleteLoan(loanId: number) {
  return apiRequest<unknown>(`/loans/${loanId}/hard-delete`, { method: "DELETE" });
}

// --- Indemnity bond Aadhaar eSign (Setu) ------------------------------------
// Mirrors frontend/modules/loans/services/loanService.ts's
// startIndemnityBondEsign/checkIndemnityBondEsign exactly — same backend
// endpoints (backend/internal/loan/handler.go's StartIndemnityBondEsign/
// CheckIndemnityBondEsign).

// Backend accepts gu only for businesses allowed Gujarati; it rejects otherwise.
export type BondLang = "en" | "ml" | "gu";
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

// Top up an Active loan — POST /loans/:id/topup (backend/internal/loan/
// handler.go topUpRequest). Raises principal + outstanding by `amount`, up to
// the loan's headroom (eligibleLoanAmount − outstanding); the split must add
// up to the amount. Returns the updated loan.
export function topUpLoan(
  loanId: number,
  input: {
    amount: number;
    occurredOn?: string;
    reference?: string;
    // "require" (default, if omitted) blocks the top-up while outstanding
    // interest/penal interest stands; "deduct" clears it out of this
    // top-up's own cash payout instead.
    settleInterest?: "require" | "deduct";
  } & Partial<SplitAmounts>
) {
  return apiRequest<Loan>(`/loans/${loanId}/topup`, { method: "POST", body: input });
}

// Stage decision on a Pending top-up (tenant's "loan_topup" flow) — the
// final stage's approval pays it out with the split captured at request.
export function approveTopUp(topUpId: number, input: { stage: string; action: "Approved" | "Rejected"; remarks?: string }) {
  return apiRequest<LoanTopUp>(`/loans/topups/${topUpId}/approve`, { method: "POST", body: input });
}

// A loan's top-ups — GET /loans/:id/topups (same call the web LoanDetail
// makes; the loan payload itself doesn't carry them). Feeds the Payment
// Ledger alongside the loan's payments.
export function listTopUps(loanId: number) {
  return apiRequest<LoanTopUp[]>(`/loans/${loanId}/topups`);
}
