import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { type LoanDraft, type SaveDraftInput, Loan, LoanApproval, LoanRequest, LoanRiskLevel, LoanRiskRow, LoanTopUp, type LoanRiskCounts, type CreateLoanInput, type OrnamentRequestInput, type SanctionStage, type UpdateLoanInput, type BondLang, type BondDeliverBy, type IndemnityBondEsignStart, type IndemnityBondEsignCheck, type LoanLedgerEntry } from "@/modules/loans/types/loan-types";
import type { SplitAmounts } from "@/modules/investments/types/investment-types";

// All filters are server-side, per the "no client-side filtering" rule.
export function listLoans(params?: { q?: string; status?: string; branchId?: number; customerId?: number }) {
  return apiRequest<Loan[]>("/loans", { params });
}

// Page-scoped variant: passing `limit` flips the backend into the {items, hasMore} envelope.
export function listLoansPage(params: {
  q?: string;
  status?: string;
  servicing?: string; // due_soon | overdue | defaulted
  branchId?: number | string; // comma-joined for several
  customerId?: number | string;
  schemeId?: number;
  from?: string; // "YYYY-MM-DD", bounds openedDate (inclusive)
  to?: string; // "YYYY-MM-DD", bounds openedDate (inclusive)
  // Auction case buckets computed server-side: eligible | defaulted | auctioned_balance_due.
  auctionCase?: string;
  bankPledgeStatus?: string;
  excludeBankPledged?: boolean;
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: Loan[]; hasMore: boolean; total?: number }>("/loans", { params });
}

// Sums interest + penal interest applied over [from,to]; not branch-scoped. from/to default
// server-side to [first-of-current-month, today] when omitted.
export function getInterestCollected(from?: string, to?: string) {
  return apiRequest<{ interestCollected: number; from: string; to: string }>("/loans/interest-collected", {
    params: { from, to },
  });
}

// Risk-eligible statuses sent as the `status` filter's options ("All statuses" sends none).
export const RISK_STATUSES = ["Active", "Due Soon", "Overdue", "Closure Requested", "Defaulted", "Auction Eligible"] as const;

// `total`/`counts` cover every loan matching status/from/to (not riskLevel), not just this page,
// for the screen's KPI tiles.
export function listLoanRiskAssessmentPage(params: {
  q?: string;
  status?: string;
  servicing?: string; // due_soon | overdue | defaulted
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

export function createLoan(input: CreateLoanInput) {
  // The contract map has no entry for overallPhotoUrl, so it is sent under the backend's own name.
  const { overallPhotoUrl, ...rest } = input;
  return apiRequest<Loan>("/loans", { method: "POST", body: { ...rest, ...(overallPhotoUrl ? { overall_photo_url: overallPhotoUrl } : {}) } });
}

// Attaches an already-uploaded image to an ornament, one call per image (an ornament can carry more than one).
export function addOrnamentImage(ornamentId: number, imageUrl: string) {
  return apiRequest<unknown>(`/loans/ornaments/${ornamentId}/images`, {
    method: "POST",
    body: { imageUrl },
  });
}

export function addOrnament(loanId: number, input: OrnamentRequestInput) {
  return apiRequest<Loan>(`/loans/${loanId}/ornaments`, { method: "POST", body: input });
}

export function updateOrnament(ornamentId: number, input: OrnamentRequestInput) {
  return apiRequest<Loan>(`/loans/ornaments/${ornamentId}`, { method: "PUT", body: input });
}

// Refused server-side if this is the loan's last remaining ornament, or if the loan is already Closed/Auctioned.
export function deleteOrnament(ornamentId: number) {
  return apiRequest<Loan>(`/loans/ornaments/${ornamentId}`, { method: "DELETE" });
}

// Maps the retired AuthorizedManagement value onto its replacement stage; a decided loan is null,
// anything else is a pending stage.
export function normalizeSanctionStage(stage: string | null | undefined): SanctionStage | null {
  const s = stage === "AuthorizedManagement" ? "FinalSanction" : stage ?? "";
  return s && s !== "Approved" && s !== "Rejected" ? s : null;
}

export function approveLoan(
  loanId: number,
  // Split required on the FINAL enabled stage's approval, which disburses the loan; must add up to the disbursed amount.
  input: { stage: SanctionStage | string; action: "Approved" | "Rejected" | "Verified"; remarks?: string; bankId?: number } & Partial<SplitAmounts>
) {
  return apiRequest<Loan>(`/loans/${loanId}/approve`, { method: "POST", body: input });
}

export function listLoanApprovals(loanId: number) {
  return apiRequest<LoanApproval[]>(`/loans/${loanId}/approvals`);
}

export function createExtensionRequest(
  loanId: number,
  input: { months: number; detail?: string; requestedBy?: string }
) {
  return apiRequest<LoanRequest>(`/loans/${loanId}/extension-request`, { method: "POST", body: input });
}

// ornamentIds: empty, or every still-pledged ornament, is a full release; a strict subset is partial.
export function createReleaseRequest(loanId: number, input: { detail?: string; requestedBy?: string; ornamentIds?: number[] }) {
  return apiRequest<LoanRequest>(`/loans/${loanId}/release-request`, { method: "POST", body: input });
}

export function listLoanRequests(params?: { status?: string; loanId?: number }) {
  return apiRequest<LoanRequest[]>("/loans/requests", { params });
}

// Page-scoped variant: passing `limit` flips the backend into the {items, hasMore} envelope.
export function listLoanRequestsPage(params: {
  // Server-side search (loan no. / customer name / customer ID); type: "extension" | "release".
  q?: string;
  type?: string;
  status?: string;
  loanId?: number;
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: LoanRequest[]; hasMore: boolean }>("/loans/requests", { params });
}

// Single-step decision for Extension requests (and a Release request before its checklist/approval-chain steps start).
export function decideLoanRequest(requestId: number, action: "Approved" | "Rejected", remarks?: string) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/decide`, {
    method: "PUT",
    body: { action, remarks },
  });
}

// The "customer has seen the gold" flag is locked once a release payment is recorded.
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

// Split must sum to `amount`. Sets paymentRecorded/locked and advances the request to Management
// the first time; dueDate only needed when a FULL release is still short after it.
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
    // The branch bank account a UPI / Bank Transfer share was received in.
    bankId?: number;
  }
) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/release-payment`, { method: "POST", body: input });
}

// `stage` is the stage key from the request's flow (loan_extension / loan_release).
export function approveLoanRequest(
  requestId: number,
  input: { stage: string; action: "Approved" | "Rejected"; remarks?: string }
) {
  return apiRequest<LoanRequest>(`/loans/requests/${requestId}/approve`, { method: "POST", body: input });
}

export const approveReleaseRequest = approveLoanRequest;
export const approveExtensionRequest = approveLoanRequest;

// Requires the outstanding balance to be zero and no active bank pledge (enforced server-side).
export function completeRelease(loanId: number) {
  return apiRequest<Loan>(`/loans/${loanId}/complete-release`, { method: "POST" });
}

export function updateLoan(loanId: number, input: UpdateLoanInput) {
  return apiRequest<Loan>(`/loans/${loanId}`, { method: "PATCH", body: input });
}

// No undo. Gated server-side by its own "can hard delete loan" permission, independent of "can delete loan".
export function hardDeleteLoan(loanId: number) {
  return apiRequest<unknown>(`/loans/${loanId}/hard-delete`, { method: "DELETE" });
}

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

export function checkIndemnityBondEsign(loanId: number) {
  return apiRequest<IndemnityBondEsignCheck>(`/loans/${loanId}/indemnity-bond/esign/status`);
}

// Raises principal + outstanding by `amount`, up to the loan's headroom (eligibleLoanAmount − outstanding).
export function topUpLoan(
  loanId: number,
  input: {
    amount: number;
    occurredOn?: string;
    reference?: string;
    // "require" (default) blocks the top-up while outstanding interest/penal interest stands;
    // "deduct" clears it out of this top-up's own cash payout instead.
    settleInterest?: "require" | "deduct";
    // The branch bank account a UPI / Bank Transfer share of the payout leaves from.
    bankId?: number;
  } & Partial<SplitAmounts>
) {
  return apiRequest<Loan>(`/loans/${loanId}/topup`, { method: "POST", body: input });
}

// Final stage's approval pays out the top-up with the split captured at request.
export function approveTopUp(topUpId: number, input: { stage: string; action: "Approved" | "Rejected"; remarks?: string }) {
  return apiRequest<LoanTopUp>(`/loans/topups/${topUpId}/approve`, { method: "POST", body: input });
}

// The loan payload itself doesn't carry top-ups; feeds the Payment Ledger alongside its payments.
export function listTopUps(loanId: number) {
  return apiRequest<LoanTopUp[]>(`/loans/${loanId}/topups`);
}

export function getLoanLedger(loanId: number, params: { limit: number; offset: number; from?: string; to?: string; kinds?: string }) {
  return apiRequest<{ items: LoanLedgerEntry[] | null; total: number; totalDebit?: number; totalCredit?: number }>(`/loans/${loanId}/ledger`, { params });
}

// Drafts carry two fields the contract map doesn't know (overall photo, per-ornament photo list), so
// they are sent under the backend's own names.
function draftBody(input: SaveDraftInput) {
  const { overallPhotoUrl, ornaments, ...rest } = input;
  return {
    ...rest,
    ...(overallPhotoUrl ? { overall_photo_url: overallPhotoUrl } : {}),
    ornaments: ornaments.map(({ imageUrls, ...o }) => ({ ...o, ...(imageUrls?.length ? { image_urls: imageUrls } : {}) })),
  };
}
export function saveDraft(input: SaveDraftInput) {
  return apiRequest<LoanDraft>("/loans/drafts", { method: "POST", body: draftBody(input) });
}

// Overwrites an existing draft — saving again in the same sitting updates it in place.
export function updateDraft(draftId: number, input: SaveDraftInput) {
  return apiRequest<LoanDraft>(`/loans/drafts/${draftId}`, { method: "PUT", body: draftBody(input) });
}

// The caller's own drafts, most recently saved first. The two fields the contract map doesn't know
// (overall photo, per-ornament photo list) come back under the backend's own names — read both.
export function listDrafts() {
  type Raw = Omit<LoanDraft, "ornaments"> & { overall_photo_url?: string; ornaments: (LoanDraft["ornaments"][number] & { image_urls?: string[] | null })[] };
  return apiRequest<Raw[] | null>("/loans/drafts").then((r) =>
    (r ?? []).map((d) => ({
      ...d,
      overallPhotoUrl: d.overallPhotoUrl ?? d.overall_photo_url,
      ornaments: d.ornaments.map((o) => ({ ...o, imageUrls: o.imageUrls ?? o.image_urls ?? null })),
    }))
  );
}

export function deleteDraft(draftId: number) {
  return apiRequest<void>(`/loans/drafts/${draftId}`, { method: "DELETE" });
}
