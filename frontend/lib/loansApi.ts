import { apiFetch } from "@/lib/api";

/* Mirrors backend/internal/loan/handler.go's ornamentRequest exactly. */
export type OrnamentRequestInput = {
  name: string;
  purity: string; // "24K" | "22K" | "18K"
  grossWeight: number;
  deductionWeight: number;
  quantity: number;
  remarks?: string;
};

/* Mirrors backend/internal/loan/handler.go's loanRequest exactly. */
export type CreateLoanInput = {
  branchId: number;
  customerId: number;
  schemeId: number;
  openedDate: string; // "YYYY-MM-DD"
  dueDate: string; // "YYYY-MM-DD"
  principalAmount: number;
  ornaments: OrnamentRequestInput[];
  // Optional — checks the auto-created tracking packet straight into this
  // locker at creation instead of leaving it ungrouped for a later manual
  // check-in (see backend/internal/packet/service.go's Create).
  lockerId?: number;
};

/* Shape returned by the Go backend (backend/internal/loan/model.go's Loan —
 * returned directly, not through a separate response DTO). Only the
 * fields this module needs are typed here. */
export type BackendOrnamentImage = { id: number; ornamentId: number; imageUrl: string; createdAt: string };
export type BackendOrnamentPurityTest = {
  id: number;
  ornamentId: number;
  testedPurity: string;
  testedGrossWeight: number;
  testedDeductionWeight: number;
  testedNetWeight: number;
  testingRemarks: string;
  testedBy: string;
  testedAt: string;
};

export type BackendOrnament = {
  id: number;
  loanId: number;
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight: number;
  netWeight: number;
  quantity: number;
  goldValue: number;
  remarks: string;
  purityTest?: BackendOrnamentPurityTest | null;
  images?: BackendOrnamentImage[];
};

export type BackendLoanApproval = {
  id: number;
  loanId: number;
  stage: string;
  action: string;
  actorEmployeeId: number;
  remarks: string;
  createdAt: string;
};

export type BackendLoanPayment = {
  id: number;
  loanId: number;
  amount: number;
  type: string;
  paidOn: string;
  receivedByEmployeeId: number;
  description: string;
  method: string;
  reference: string;
  penalInterestApplied: number;
  interestApplied: number;
  principalApplied: number;
  runningBalance: number;
  createdAt: string;
};

export type BackendBankPledgeRecord = {
  id: number;
  loanId: number;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  bankInterestRate: number;
  referenceNumber: string;
  createdAt: string;
};

/* Minimal shapes of the nested Branch/Customer/Scheme the backend preloads
 * onto every loan response — only the fields this module reads. */
type NestedBranch = { id: number; name: string; code: string };
type NestedCustomer = { id: number; name: string; code: string; phone: string };
type NestedScheme = { id: number; name: string; interestRate: number; ltvPercent: number; interestMethod: string; penalRate: number };

export type BackendLoan = {
  id: number;
  loanNumber: string;
  branchId: number;
  branch?: NestedBranch;
  customerId: number;
  customer?: NestedCustomer;
  schemeId: number;
  scheme?: NestedScheme;
  openedDate: string;
  dueDate: string;
  totalNetWeight: number;
  totalGoldValue: number;
  eligibleLoanAmount: number;
  principalAmount: number;
  outstandingAmount: number;
  accruedInterest: number;
  interestPaid: number;
  accruedPenalInterest: number;
  penalInterestPaid: number;
  outstandingInterest: number;
  outstandingPenalInterest: number;
  totalOutstandingBalance: number;
  settlementAmount: number;
  totalPaid: number;
  status: string;
  approvalStage: string;
  bankPledgeStatus: string;
  isDueSoon: boolean;
  isOverdue: boolean;
  isDefaulted: boolean;
  daysOverdue: number;
  auctionDate?: string | null;
  auctionAmount?: number | null;
  ornaments?: BackendOrnament[];
  approvals?: BackendLoanApproval[];
  payments?: BackendLoanPayment[];
  bankPledges?: BackendBankPledgeRecord[];
  approvalWarning?: string;
  createdAt: string;
  updatedAt: string;
};

/* UI-facing shape consumed by Loans.tsx / LoanDetail.tsx / LoanRow.tsx —
 * mirrors customersApi.ts's CustomerView convention: `id` is the string the
 * rest of the UI navigates/links with (here the human-readable loanNumber,
 * matching the old mock Loan.id shape of "GL-1001"-style strings so
 * #loan/<id> hash routing keeps working unchanged). */
export type OrnamentView = {
  id: number;
  name: string;
  purity: string;
  grossWeight: number;
  netWeight: number;
  quantity: number;
  goldValue: number;
  remarks: string;
  photoUrl?: string;
};

export type PaymentView = {
  id: number;
  amount: number;
  type: string;
  paidOn: string; // "YYYY-MM-DD"
  receivedByEmployeeId: number;
  description: string;
  method: string;
  reference: string;
  penalInterestApplied: number;
  interestApplied: number;
  principalApplied: number;
  runningBalance: number;
};

export type BankPledgeView = {
  id: number;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  isReleased: boolean;
  bankInterestRate: number;
  referenceNumber: string;
};

export type LoanView = {
  id: string; // loanNumber
  numericId: number; // raw backend id, needed for mutation endpoints
  loanNumber: string;
  branchId: number;
  branchName: string;
  customerId: string; // stringified, matches CustomerView.id
  customerName: string;
  schemeId: string; // stringified, matches SchemeView.id
  schemeName: string;
  schemeRate: number;
  schemeLtv: number;
  schemeMethod: string;
  schemePenal: number;
  opened: string; // "YYYY-MM-DD"
  due: string;
  totalNetWeight: number;
  totalGoldValue: number;
  eligibleLoanAmount: number;
  principal: number;
  outstanding: number;
  accruedInterest: number;
  interestPaid: number;
  accruedPenalInterest: number;
  penalInterestPaid: number;
  outstandingInterest: number;
  outstandingPenalInterest: number;
  totalOutstandingBalance: number;
  settlementAmount: number;
  totalPaid: number;
  status: string;
  approvalStage: string;
  bankPledgeStatus: string;
  isDueSoon: boolean;
  isOverdue: boolean;
  isDefaulted: boolean;
  daysOverdue: number;
  approvalWarning: string;
  auctionDate: string | null;
  auctionAmount: number | null;
  ornaments: OrnamentView[];
  payments: PaymentView[];
  bankPledges: BankPledgeView[];
};

function toOrnamentView(o: BackendOrnament): OrnamentView {
  return {
    id: o.id,
    name: o.name,
    purity: o.purity,
    grossWeight: o.grossWeight,
    netWeight: o.netWeight,
    quantity: o.quantity,
    goldValue: o.goldValue,
    remarks: o.remarks,
    photoUrl: o.images && o.images.length ? o.images[o.images.length - 1].imageUrl : undefined,
  };
}

function toPaymentView(p: BackendLoanPayment): PaymentView {
  return {
    id: p.id,
    amount: p.amount,
    type: p.type,
    paidOn: p.paidOn.slice(0, 10),
    receivedByEmployeeId: p.receivedByEmployeeId,
    description: p.description,
    method: p.method,
    reference: p.reference,
    penalInterestApplied: p.penalInterestApplied,
    interestApplied: p.interestApplied,
    principalApplied: p.principalApplied,
    runningBalance: p.runningBalance,
  };
}

function toBankPledgeView(p: BackendBankPledgeRecord): BankPledgeView {
  return {
    id: p.id,
    bankName: p.bankName,
    pledgedAmount: p.pledgedAmount,
    pledgeDate: p.pledgeDate.slice(0, 10),
    releaseDate: p.releaseDate ? p.releaseDate.slice(0, 10) : null,
    isReleased: !!p.releaseDate,
    bankInterestRate: p.bankInterestRate,
    referenceNumber: p.referenceNumber,
  };
}

export function toView(l: BackendLoan): LoanView {
  return {
    id: l.loanNumber,
    numericId: l.id,
    loanNumber: l.loanNumber,
    branchId: l.branchId,
    branchName: l.branch?.name || "—",
    customerId: String(l.customerId),
    customerName: l.customer?.name || "—",
    schemeId: String(l.schemeId),
    schemeName: l.scheme?.name || "—",
    schemeRate: l.scheme?.interestRate || 0,
    schemeLtv: l.scheme?.ltvPercent || 0,
    schemeMethod: l.scheme?.interestMethod || "—",
    schemePenal: l.scheme?.penalRate || 0,
    opened: l.openedDate ? l.openedDate.slice(0, 10) : "",
    due: l.dueDate ? l.dueDate.slice(0, 10) : "",
    totalNetWeight: l.totalNetWeight,
    totalGoldValue: l.totalGoldValue,
    eligibleLoanAmount: l.eligibleLoanAmount,
    principal: l.principalAmount,
    outstanding: l.outstandingAmount,
    accruedInterest: l.accruedInterest,
    interestPaid: l.interestPaid,
    accruedPenalInterest: l.accruedPenalInterest,
    penalInterestPaid: l.penalInterestPaid,
    outstandingInterest: l.outstandingInterest,
    outstandingPenalInterest: l.outstandingPenalInterest,
    totalOutstandingBalance: l.totalOutstandingBalance,
    settlementAmount: l.settlementAmount,
    totalPaid: l.totalPaid,
    status: l.status,
    approvalStage: l.approvalStage,
    bankPledgeStatus: l.bankPledgeStatus,
    isDueSoon: l.isDueSoon,
    isOverdue: l.isOverdue,
    isDefaulted: l.isDefaulted,
    daysOverdue: l.daysOverdue,
    approvalWarning: l.approvalWarning || "",
    auctionDate: l.auctionDate ? l.auctionDate.slice(0, 10) : null,
    auctionAmount: l.auctionAmount ?? null,
    ornaments: (l.ornaments || []).map(toOrnamentView),
    payments: (l.payments || []).map(toPaymentView),
    bankPledges: (l.bankPledges || []).map(toBankPledgeView),
  };
}

/* Creates a loan with its ornaments in one call. The backend creates
 * ornaments in the same order they're submitted and (per
 * internal/loan/repository.go's OrnamentRepository.FindByLoanID, which
 * orders "id asc") returns them back in that same order, so callers may
 * zip the input rows with `ornaments` in the response by array index. */
export async function createLoan(input: CreateLoanInput): Promise<BackendLoan> {
  return apiFetch<BackendLoan>("/loans", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* Attaches one photo to an already-created ornament. */
export async function addOrnamentImage(ornamentId: number, imageUrl: string): Promise<unknown> {
  return apiFetch(`/loans/ornaments/${ornamentId}/images`, {
    method: "POST",
    body: JSON.stringify({ imageUrl }),
  });
}

export type LoanFilters = { q?: string; status?: string; branchId?: number; customerId?: number };

export async function listLoans(filters?: LoanFilters): Promise<LoanView[]> {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.branchId) params.set("branchId", String(filters.branchId));
  if (filters?.customerId) params.set("customerId", String(filters.customerId));
  const qs = params.toString();
  const rec = await apiFetch<BackendLoan[]>(`/loans${qs ? `?${qs}` : ""}`);
  return (rec || []).map(toView);
}

export async function getLoan(id: number): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${id}`);
  return toView(rec);
}

/* Direct, atomic lookup by loan number (backend/internal/loan's GET
 * /loans/by-number/:loanNumber) — used by LoanDetail.tsx instead of the
 * previous listLoans({q}) + client-side find + getLoan two-step, which
 * needed two round trips and could show a transient "Loan not found" if
 * the list call raced against another in-flight /loans request. */
export async function getLoanByNumber(loanNumber: string): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/by-number/${encodeURIComponent(loanNumber)}`);
  return toView(rec);
}

export async function addOrnament(loanId: number, input: OrnamentRequestInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/ornaments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function updateOrnament(ornamentId: number, input: OrnamentRequestInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/ornaments/${ornamentId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export type PurityTestInput = {
  testedPurity: string;
  testedGrossWeight: number;
  testedDeductionWeight: number;
  testingRemarks?: string;
  testedBy: string;
  testedAt: string; // "YYYY-MM-DD"
};

export async function recordPurityTest(ornamentId: number, input: PurityTestInput): Promise<BackendOrnament> {
  return apiFetch<BackendOrnament>(`/loans/ornaments/${ornamentId}/purity-test`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* The 4-stage loan sanction chain (Loan Operator → Branch Manager →
 * Authorized Management → Final Sanction). `role` must match the stage's
 * required role below — except "Administrator", which may act at
 * whichever stage is currently pending. */
export const SANCTION_STAGES = ["LoanOperator", "BranchManager", "AuthorizedManagement", "FinalSanction"] as const;
export type SanctionStage = (typeof SANCTION_STAGES)[number];
export const SANCTION_STAGE_LABELS: Record<SanctionStage, string> = {
  LoanOperator: "Loan Operator",
  BranchManager: "Branch Manager",
  AuthorizedManagement: "Authorized Management",
  FinalSanction: "Final Sanction",
};
export const SANCTION_STAGE_ROLES: Record<SanctionStage, string> = {
  LoanOperator: "Loan Operator",
  BranchManager: "Branch Manager",
  AuthorizedManagement: "Management",
  FinalSanction: "Management",
};

export type ApprovalStageRecord = {
  id: number;
  loanId: number;
  stage: string;
  action: string;
  actorEmployeeId: number;
  actorRole: string;
  remarks: string;
  createdAt: string;
};

export async function listLoanApprovals(loanId: number): Promise<ApprovalStageRecord[]> {
  return (await apiFetch<ApprovalStageRecord[]>(`/loans/${loanId}/approvals`)) || [];
}

export type ApprovalInput = { stage: SanctionStage; action: "Approved" | "Rejected"; employeeId: number; role: string; remarks?: string };

export async function approveLoan(loanId: number, input: ApprovalInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export type PaymentInput = {
  amount: number;
  type: string; // "Interest" | "Principal" | "Partial" | "Full Settlement" | "Adjustment" | "Waiver"
  paidOn: string;
  employeeId: number;
  method?: string;
  reference?: string;
  description?: string;
};

export async function recordPayment(loanId: number, input: PaymentInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export type BankPledgeInput = {
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  bankInterestRate?: number;
  referenceNumber?: string;
};

export async function recordBankPledge(loanId: number, input: BankPledgeInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/bank-pledge`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

export async function releaseBankPledge(loanId: number, pledgeId: number): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/bank-pledge/${pledgeId}/release`, {
    method: "PUT",
  });
  return toView(rec);
}

/* Auction workflow — full 7-stage rebuild (see
 * backend/internal/loan/model.go's AuctionRecord/AuctionNotice). Overdue/
 * Defaulted are LoanView's isOverdue/isDefaulted flags (section 2); the
 * stages below only exist once a defaulted loan is actually marked
 * auction-eligible. */
export const AUCTION_STAGES = ["AuctionEligible", "NoticeIssued", "AuctionScheduled", "Auctioned", "Settled"] as const;
export type AuctionStage = (typeof AUCTION_STAGES)[number];
export const AUCTION_STAGE_LABELS: Record<AuctionStage, string> = {
  AuctionEligible: "Auction Eligible",
  NoticeIssued: "Notice Issued",
  AuctionScheduled: "Auction Scheduled",
  Auctioned: "Auctioned",
  Settled: "Settled",
};

export type AuctionNoticeView = {
  id: number;
  issuedAt: string;
  method: string;
  remarks: string;
};

export type AuctionRecordView = {
  id: number;
  loanId: number;
  stage: AuctionStage;
  auctionEligibleDate: string;
  auctionDate: string | null;
  auctionReferenceNumber: string;
  saleAmount: number;
  auctionExpenses: number;
  surplusShortfall: number;
  finalSettlementStatus: "Pending" | "SettledToCustomer" | "SettledToLoanCo";
  notices: AuctionNoticeView[];
};

export type BackendAuctionRecord = {
  id: number;
  loanId: number;
  stage: AuctionStage;
  auctionEligibleDate: string;
  auctionDate: string | null;
  auctionReferenceNumber: string;
  saleAmount: number;
  auctionExpenses: number;
  surplusShortfall: number;
  finalSettlementStatus: "Pending" | "SettledToCustomer" | "SettledToLoanCo";
  notices: { id: number; issuedAt: string; method: string; remarks: string }[] | null;
};

export function toAuctionRecordView(r: BackendAuctionRecord): AuctionRecordView {
  return {
    id: r.id,
    loanId: r.loanId,
    stage: r.stage,
    auctionEligibleDate: r.auctionEligibleDate ? r.auctionEligibleDate.slice(0, 10) : "",
    auctionDate: r.auctionDate ? r.auctionDate.slice(0, 10) : null,
    auctionReferenceNumber: r.auctionReferenceNumber,
    saleAmount: r.saleAmount,
    auctionExpenses: r.auctionExpenses,
    surplusShortfall: r.surplusShortfall,
    finalSettlementStatus: r.finalSettlementStatus,
    notices: (r.notices || []).map((n) => ({ id: n.id, issuedAt: n.issuedAt.slice(0, 10), method: n.method, remarks: n.remarks })),
  };
}

export async function getAuctionRecord(loanId: number): Promise<AuctionRecordView | null> {
  try {
    const rec = await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction`);
    return toAuctionRecordView(rec);
  } catch {
    return null; // no auction case started yet for this loan
  }
}

export async function markAuctionEligible(loanId: number): Promise<AuctionRecordView> {
  return toAuctionRecordView(await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/eligible`, { method: "POST" }));
}

export async function issueAuctionNotice(loanId: number, method: string, remarks?: string): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/notice`, { method: "POST", body: JSON.stringify({ method, remarks }) })
  );
}

export async function scheduleAuction(loanId: number, auctionDate: string, referenceNumber?: string): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/schedule`, { method: "POST", body: JSON.stringify({ auctionDate, referenceNumber }) })
  );
}

export async function recordAuctionSale(loanId: number, saleAmount: number, auctionExpenses: number): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/sale`, { method: "POST", body: JSON.stringify({ saleAmount, auctionExpenses }) })
  );
}

export async function settleAuction(loanId: number, settlementStatus: "SettledToCustomer" | "SettledToLoanCo"): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/settle`, { method: "POST", body: JSON.stringify({ settlementStatus }) })
  );
}

/* --- Extension & release requests ("Extensions & Release" page) ---------
 * Mirrors backend/internal/loan/model.go's LoanRequest. Staff log these on
 * a customer's behalf today (from LoanDetail.tsx / CustomerDetail.tsx); the
 * Android app can create the same records later via the same endpoints. */
export type BackendLoanRequest = {
  id: number;
  loanId: number;
  loan?: BackendLoan;
  type: "Extension" | "Release";
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: "Customer" | "Staff";
  detail: string;
  requestedExtensionMonths?: number | null;
  newDueDate?: string | null;
  // Release only — the same Manager→Management chain used for loan
  // sanctioning (see backend/internal/loan/model.go's LoanRequest).
  approvalStage?: string;
  paymentVerified: boolean;
  packetVerified: boolean;
  bankPledgeVerified: boolean;
  customerConfirmed: boolean;
  verificationNotes: string;
  charges: number;
  settlementAmount: number;
  remarks: string;
  requestedAt: string;
  decidedAt?: string | null;
  decidedByEmployeeId?: number | null;
  createdAt: string;
};

export type RequestView = {
  id: number;
  loanId: string; // loanNumber, matches LoanView.id
  loanNumericId: number; // raw backend loan id, needed to fetch full loan financials
  loanNumber: string;
  customerName: string;
  type: "Extension" | "Release";
  status: "Pending" | "Approved" | "Rejected";
  detail: string;
  requestedAt: string; // "YYYY-MM-DD"
  remarks: string;
  requestedExtensionMonths: number | null;
  approvalStage: string; // "" for Extension requests
  paymentVerified: boolean;
  packetVerified: boolean;
  bankPledgeVerified: boolean;
  customerConfirmed: boolean;
  verificationNotes: string;
  charges: number;
  settlementAmount: number;
};

function toRequestView(r: BackendLoanRequest): RequestView {
  return {
    id: r.id,
    loanId: r.loan?.loanNumber || String(r.loanId),
    loanNumericId: r.loanId,
    loanNumber: r.loan?.loanNumber || String(r.loanId),
    customerName: r.loan?.customer?.name || "—",
    type: r.type,
    status: r.status,
    detail: r.detail,
    requestedAt: r.requestedAt ? r.requestedAt.slice(0, 10) : "",
    remarks: r.remarks,
    requestedExtensionMonths: r.requestedExtensionMonths ?? null,
    approvalStage: r.approvalStage || "",
    paymentVerified: r.paymentVerified,
    packetVerified: r.packetVerified,
    bankPledgeVerified: r.bankPledgeVerified,
    customerConfirmed: r.customerConfirmed,
    verificationNotes: r.verificationNotes,
    charges: r.charges,
    settlementAmount: r.settlementAmount,
  };
}

export type LoanRequestFilters = { status?: string; loanId?: number };

export async function listLoanRequests(filters?: LoanRequestFilters): Promise<RequestView[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.loanId) params.set("loanId", String(filters.loanId));
  const qs = params.toString();
  const rec = await apiFetch<BackendLoanRequest[]>(`/loans/requests${qs ? `?${qs}` : ""}`);
  return (rec || []).map(toRequestView);
}

/* Backs Dashboard.tsx's "Interest Collected" KPI — replaces the old
 * always-empty `db.ledger` mock figure. Defaults (server-side) to the
 * current calendar month when `from`/`to` are omitted. */
export async function getInterestCollected(from?: string, to?: string): Promise<number> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const rec = await apiFetch<{ interestCollected: number }>(`/loans/interest-collected${qs ? `?${qs}` : ""}`);
  return rec.interestCollected;
}

export async function createExtensionRequest(loanId: number, months: number, detail?: string): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/${loanId}/extension-request`, {
    method: "POST",
    body: JSON.stringify({ months, detail }),
  });
  return toRequestView(rec);
}

export async function createReleaseRequest(loanId: number, detail?: string): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/${loanId}/release-request`, {
    method: "POST",
    body: JSON.stringify({ detail }),
  });
  return toRequestView(rec);
}

/* Extension-only decision — one step, mirrors DecideRequest on the backend.
 * Release requests use verifyReleaseChecklist + approveReleaseRequest
 * instead (the backend rejects a Release request here with
 * ErrNotExtensionRequest). */
export async function decideRequest(requestId: number, action: "Approved" | "Rejected", employeeId: number, remarks?: string): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/decide`, {
    method: "PUT",
    body: JSON.stringify({ action, employeeId, remarks }),
  });
  return toRequestView(rec);
}

/* --- Release verification checklist & approval chain --------------------
 * A Release request must have all four checklist items ticked before the
 * first approval stage can be submitted — see backend/internal/loan/
 * service.go's ApproveReleaseRequest. */
export type ChecklistInput = {
  paymentVerified?: boolean;
  packetVerified?: boolean;
  bankPledgeVerified?: boolean;
  customerConfirmed?: boolean;
  verificationNotes?: string;
  charges?: number;
};

export async function verifyReleaseChecklist(requestId: number, input: ChecklistInput): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/verify`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

export type ReleaseApprovalInput = { stage: "Manager" | "Management"; action: "Approved" | "Rejected"; employeeId: number; remarks?: string };

export async function approveReleaseRequest(requestId: number, input: ReleaseApprovalInput): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toRequestView(rec);
}

/* The actual "hand the gold back" step, separate from approving the
 * request — blocked server-side until the settlement is fully paid and any
 * bank pledge already released (see Service.CompleteRelease). */
export async function completeRelease(loanId: number, employeeId: number): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/complete-release`, {
    method: "POST",
    body: JSON.stringify({ employeeId }),
  });
  return toView(rec);
}
