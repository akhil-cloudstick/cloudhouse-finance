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
  processingFee: number;
  processingFeeApplied: number;
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
  bankId: number | null;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  bankPledgeDueDate: string | null;
  pledgedGrossWeight: number;
  pledgedNetWeight: number;
  bankInterestRate: number;
  referenceNumber: string;
  createdAt: string;

  /* Added with the cash-treatment toggle. Optional here because this same type
   * is used for pledges embedded in a loan response, where older serialized
   * payloads may not carry them — see toBankPledgeView for the defaults. */
  cashTreatment?: BankPledgeCashTreatment;
  status?: "Active" | "Released" | "Voided";
  voidedAt?: string | null;
  voidReason?: string;
  events?: {
    id: number;
    action: "Pledged" | "Released" | "Voided";
    actorRole?: string;
    amount: number;
    remarks?: string;
    createdAt: string;
  }[] | null;
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
  outstandingProcessingFee: number;
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
  processingFee: number;
  processingFeeApplied: number;
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
  bankId: number | null;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  bankPledgeDueDate: string | null;
  pledgedGrossWeight: number;
  pledgedNetWeight: number;
  isReleased: boolean;
  bankInterestRate: number;
  referenceNumber: string;
  /* Whether this pledge put the bank's advance into Cash-in-Hand. Determines
   * whether releasing it books cash back out, so it is surfaced on the loan's
   * pledge rows, not just in the history view. */
  cashTreatment: BankPledgeCashTreatment;
  status: "Active" | "Released" | "Voided";
  voidReason: string;
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
  outstandingProcessingFee: number;
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
    processingFee: p.processingFee,
    processingFeeApplied: p.processingFeeApplied,
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
    bankId: p.bankId,
    bankName: p.bankName,
    pledgedAmount: p.pledgedAmount,
    pledgeDate: p.pledgeDate.slice(0, 10),
    releaseDate: p.releaseDate ? p.releaseDate.slice(0, 10) : null,
    bankPledgeDueDate: p.bankPledgeDueDate ? p.bankPledgeDueDate.slice(0, 10) : null,
    pledgedGrossWeight: p.pledgedGrossWeight,
    pledgedNetWeight: p.pledgedNetWeight,
    isReleased: !!p.releaseDate,
    bankInterestRate: p.bankInterestRate,
    referenceNumber: p.referenceNumber,
    // Rows predating the cash-treatment field default to CashIn, which is what
    // they genuinely did — unconditional cash-in was the only behavior that
    // existed before. Defaulting to RecordOnly here would misreport history and
    // suppress the cash-out that releasing such a pledge needs.
    cashTreatment: p.cashTreatment || "CashIn",
    status: p.status || (p.releaseDate ? "Released" : "Active"),
    voidReason: p.voidReason || "",
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
    outstandingProcessingFee: l.outstandingProcessingFee,
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

// employeeId/role are NOT sent — the backend derives the acting employee's
// identity and role from the authenticated JWT (see
// platform.ActorFromContext), never from the request body. Administrator's
// "may act at any pending stage" bypass still works, keyed off their real
// role.
// "Verified" is only valid for the LoanOperator stage when the principal
// exceeds the operator's approval limit (see getLoanOperatorApprovalLimit
// below) — it records the operator's review without advancing the stage;
// Branch Manager/Management must still clear it with a normal Approved/
// Rejected action afterward (backend: Service.Approve/operatorVerified).
export type ApprovalInput = { stage: SanctionStage; action: "Approved" | "Rejected" | "Verified"; remarks?: string };

export async function approveLoan(loanId: number, input: ApprovalInput): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return toView(rec);
}

/* The Loan Operator's hard-enforced approval limit (see
 * backend/internal/loan/approval_limit.go) — a Loan Operator's own
 * "Approved" action on a loan whose principal exceeds this fails with
 * ErrExceedsApprovalLimit; only Branch Manager/Management/Administrator
 * may clear that stage above the limit. Editable from the Employees
 * page's "Roles" panel. */
export type ApprovalLimitView = { role: string; maxAmount: number };

export async function getLoanOperatorApprovalLimit(): Promise<ApprovalLimitView> {
  return apiFetch<ApprovalLimitView>("/loans/approval-limits/loan-operator");
}

export async function setLoanOperatorApprovalLimit(maxAmount: number): Promise<ApprovalLimitView> {
  return apiFetch<ApprovalLimitView>("/loans/approval-limits/loan-operator", {
    method: "PUT",
    body: JSON.stringify({ maxAmount }),
  });
}

// employeeId is NOT sent — the backend derives the receiving employee's
// identity from the authenticated JWT, never the request body (see
// platform.ActorFromContext).
export type PaymentInput = {
  amount: number;
  type: string; // "Interest" | "Principal" | "Partial" | "Full Settlement" | "Adjustment" | "Waiver"
  processingFee?: number; // extra charge collected alongside amount — never applied to penal/interest/principal
  paidOn: string;
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
  bankId?: number;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  bankInterestRate?: number;
  referenceNumber?: string;
  bankPledgeDueDate?: string;

  /* Whether the bank's advance actually entered the branch till ("CashIn") or
   * the pledge is pure book-keeping with no cash effect ("RecordOnly").
   * Omitting it means RecordOnly server-side — cash only moves when the
   * operator explicitly opts in. Immutable once saved: a wrong choice is
   * corrected by voiding the record (voidBankPledge) and re-creating it, never
   * by editing, since rewriting it would falsify booked cash history. */
  cashTreatment?: BankPledgeCashTreatment;
};

export type BankPledgeCashTreatment = "CashIn" | "RecordOnly";

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

/* voidBankPledge cancels a re-pledge recorded in error — the only way to fix a
 * mis-chosen cashTreatment. Restricted server-side to Branch Manager/
 * Management/Administrator. Books a compensating cash-out only if the original
 * actually moved cash; the voided record stays visible in history. */
export async function voidBankPledge(loanId: number, pledgeId: number, reason: string): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/bank-pledge/${pledgeId}/void`, {
    method: "PUT",
    body: JSON.stringify({ reason }),
  });
  return toView(rec);
}

/* --- Bank re-pledge history ---------------------------------------------
 * The Bank Re-Pledge page previously listed only currently-pledged loans, so a
 * released re-pledge vanished from the UI entirely. These endpoints expose the
 * full record set with its audit trail. */
export type BankPledgeEventView = {
  id: number;
  action: "Pledged" | "Released" | "Voided";
  actorRole: string;
  amount: number;
  remarks: string;
  createdAt: string;
};

export type BankPledgeRecordView = {
  id: number;
  loanId: number;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate: string | null;
  bankPledgeDueDate: string | null;
  bankInterestRate: number;
  referenceNumber: string;
  cashTreatment: BankPledgeCashTreatment;
  status: "Active" | "Released" | "Voided";
  voidedAt: string | null;
  voidReason: string;
  events: BankPledgeEventView[];
};

function toBankPledgeRecordView(r: BackendBankPledgeRecord): BankPledgeRecordView {
  return {
    id: r.id,
    loanId: r.loanId,
    bankName: r.bankName,
    pledgedAmount: r.pledgedAmount,
    pledgeDate: r.pledgeDate ? r.pledgeDate.slice(0, 10) : "",
    releaseDate: r.releaseDate ? r.releaseDate.slice(0, 10) : null,
    bankPledgeDueDate: r.bankPledgeDueDate ? r.bankPledgeDueDate.slice(0, 10) : null,
    bankInterestRate: r.bankInterestRate,
    referenceNumber: r.referenceNumber,
    // Rows predating the field default to CashIn server-side, which is what
    // they genuinely did — mirror that here rather than showing them as blank.
    cashTreatment: r.cashTreatment || "CashIn",
    status: r.status || "Active",
    voidedAt: r.voidedAt ? r.voidedAt.slice(0, 10) : null,
    voidReason: r.voidReason || "",
    events: (r.events || []).map((e) => ({
      id: e.id,
      action: e.action,
      actorRole: e.actorRole || "",
      amount: e.amount,
      remarks: e.remarks || "",
      createdAt: e.createdAt ? e.createdAt.slice(0, 10) : "",
    })),
  };
}

export async function getBankPledgeHistory(loanId: number): Promise<BankPledgeRecordView[]> {
  const recs = await apiFetch<BackendBankPledgeRecord[] | null>(`/loans/${loanId}/bank-pledge/history`);
  return (recs || []).map(toBankPledgeRecordView);
}

export async function listBankPledgeHistory(): Promise<BankPledgeRecordView[]> {
  const recs = await apiFetch<BackendBankPledgeRecord[] | null>(`/loans/bank-pledges/history`);
  return (recs || []).map(toBankPledgeRecordView);
}

export const CASH_TREATMENT_LABELS: Record<BankPledgeCashTreatment, string> = {
  CashIn: "Cash Added",
  RecordOnly: "Record Only",
};

/* Auction workflow — full 7-stage rebuild (see
 * backend/internal/loan/model.go's AuctionRecord/AuctionNotice). Overdue/
 * Defaulted are LoanView's isOverdue/isDefaulted flags (section 2); the
 * stages below only exist once a defaulted loan is actually marked
 * auction-eligible. */
/* AUCTION_STAGES drives the visual stepper, so it lists only the forward path.
 * "Withdrawn" is a second terminal stage — reached when management pulls a case
 * out after the customer paid — and is deliberately excluded here because it is
 * an exit, not a step along the way. */
export const AUCTION_STAGES = ["AuctionEligible", "NoticeIssued", "AuctionScheduled", "Auctioned", "Settled"] as const;
export type AuctionStage = (typeof AUCTION_STAGES)[number] | "Withdrawn";
export const AUCTION_STAGE_LABELS: Record<AuctionStage, string> = {
  AuctionEligible: "Auction Eligible",
  NoticeIssued: "Notice Issued",
  AuctionScheduled: "Auction Scheduled",
  Auctioned: "Auctioned",
  Settled: "Settled",
  Withdrawn: "Withdrawn",
};

/* A case is concluded once it reaches either terminal stage. Only concluded
 * cases free a loan to start a fresh auction if it defaults again. */
export function isAuctionConcluded(stage: AuctionStage): boolean {
  return stage === "Settled" || stage === "Withdrawn";
}

export type AuctionSettlementStatus =
  | "Pending"
  | "SettledByRepayment"
  | "WrittenOff"
  | "SettledToCustomer"
  | "SettledToLoanCo";

/* Plain-English outcome labels for the History tab — the raw enum values say
 * little about what actually happened to the customer's gold. */
export const AUCTION_OUTCOME_LABELS: Record<AuctionSettlementStatus, string> = {
  Pending: "Awaiting settlement",
  SettledByRepayment: "Settled by repayment",
  WrittenOff: "Closed — written off",
  SettledToCustomer: "Settled — surplus refunded",
  SettledToLoanCo: "Settled — surplus retained",
};

export type AuctionSurplusDisposition = "RefundedToCustomer" | "RecordedAsIncome";

export type AuctionNoticeView = {
  id: number;
  issuedAt: string;
  method: string;
  remarks: string;
};

/* AuctionEventView is the staff-action audit trail. Notices already covered
 * customer communication; who scheduled, sold, or settled a case previously
 * left no trace at all. */
export type AuctionEventView = {
  id: number;
  action: string;
  actorRole: string;
  remarks: string;
  createdAt: string;
};

export const AUCTION_EVENT_LABELS: Record<string, string> = {
  Eligible: "Marked auction-eligible",
  NoticeIssued: "Notice issued",
  Scheduled: "Auction scheduled",
  SaleRecorded: "Sale recorded",
  Settled: "Settled",
  SettledByRepaymentAuto: "Auto-settled by repayment",
  DecisionRequested: "Decision requested (part-payment)",
  ShortfallEscalated: "Shortfall escalated",
  DecisionKeep: "Decision: keep in auction",
  DecisionRemove: "Decision: removed from auction",
  DecisionWriteOff: "Decision: balance written off",
  DecisionPursue: "Decision: pursue balance",
};

export type AuctionDecisionKind = "PartialRepayment" | "Shortfall";
export type AuctionDecisionStatus =
  | "Pending"
  | "KeepInAuction"
  | "RemovedFromAuction"
  | "WriteOff"
  | "PursueBalance";

/* AuctionDecisionRequestView is an escalation awaiting a human ruling. Raised
 * by the system, never by staff, so the decision cannot be quietly skipped:
 *  - PartialRepayment: customer part-paid; the auction is FROZEN until someone
 *    decides to keep or release the gold.
 *  - Shortfall: the sale did not cover the debt; only Branch Manager/
 *    Management/Administrator may write it off or pursue it. */
export type AuctionDecisionRequestView = {
  id: number;
  auctionRecordId: number;
  loanId: number;
  kind: AuctionDecisionKind;
  amountPaid: number;
  outstandingAtRequest: number;
  status: AuctionDecisionStatus;
  decidedByRole: string;
  decisionRemarks: string;
  createdAt: string;
  decidedAt: string | null;
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
  /* Money owed BACK to the customer when the gold fetched more than the debt.
   * Tracked explicitly because the full net proceeds are booked into the till,
   * so without this the customer's share would silently sit in branch cash. */
  surplusPayableAmount: number;
  surplusDisposition: AuctionSurplusDisposition | "";
  finalSettlementStatus: AuctionSettlementStatus;
  notices: AuctionNoticeView[];
  events: AuctionEventView[];
  decisionRequests: AuctionDecisionRequestView[];
};

/* Convenience accessors used by the Auctions UI to decide what to render. */
export function pendingDecision(rec: AuctionRecordView | null | undefined): AuctionDecisionRequestView | null {
  return rec?.decisionRequests.find((d) => d.status === "Pending") ?? null;
}
export function hasUndisposedSurplus(rec: AuctionRecordView): boolean {
  return rec.surplusPayableAmount > 0.01 && !rec.surplusDisposition;
}

type BackendAuctionEvent = {
  id: number;
  action: string;
  actorRole?: string;
  remarks?: string;
  createdAt: string;
};

type BackendAuctionDecisionRequest = {
  id: number;
  auctionRecordId: number;
  loanId: number;
  kind: AuctionDecisionKind;
  amountPaid: number;
  outstandingAtRequest: number;
  status: AuctionDecisionStatus;
  decidedByRole?: string;
  decisionRemarks?: string;
  createdAt: string;
  decidedAt?: string | null;
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
  surplusPayableAmount?: number;
  surplusDisposition?: AuctionSurplusDisposition | "";
  finalSettlementStatus: AuctionSettlementStatus;
  notices: { id: number; issuedAt: string; method: string; remarks: string }[] | null;
  events?: BackendAuctionEvent[] | null;
  decisionRequests?: BackendAuctionDecisionRequest[] | null;
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
    surplusPayableAmount: r.surplusPayableAmount ?? 0,
    surplusDisposition: r.surplusDisposition || "",
    finalSettlementStatus: r.finalSettlementStatus,
    notices: (r.notices || []).map((n) => ({ id: n.id, issuedAt: n.issuedAt.slice(0, 10), method: n.method, remarks: n.remarks })),
    events: (r.events || []).map((e) => ({
      id: e.id,
      action: e.action,
      actorRole: e.actorRole || "",
      remarks: e.remarks || "",
      createdAt: e.createdAt ? e.createdAt.slice(0, 10) : "",
    })),
    decisionRequests: (r.decisionRequests || []).map((d) => ({
      id: d.id,
      auctionRecordId: d.auctionRecordId,
      loanId: d.loanId,
      kind: d.kind,
      amountPaid: d.amountPaid,
      outstandingAtRequest: d.outstandingAtRequest,
      status: d.status,
      decidedByRole: d.decidedByRole || "",
      decisionRemarks: d.decisionRemarks || "",
      createdAt: d.createdAt ? d.createdAt.slice(0, 10) : "",
      decidedAt: d.decidedAt ? d.decidedAt.slice(0, 10) : null,
    })),
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

// issueAuctionNotice always fires all three notice channels (SMS, WhatsApp,
// Registered Post) at once — the backend no longer takes a method, it logs
// one AuctionNotice per channel and sends the WhatsApp message live.
export async function issueAuctionNotice(loanId: number, remarks?: string): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/notice`, { method: "POST", body: JSON.stringify({ remarks }) })
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

/* settleAuction now disposes of a SURPLUS rather than recording a generic
 * settlement status. It is only reachable when the sale covered the debt in
 * full — a sale that left money owing raises a Shortfall decision instead (see
 * resolveAuctionDecision), and the backend rejects settling such a loan.
 *
 * "RefundedToCustomer" books a real cash-out; "RecordedAsIncome" books none
 * (the proceeds already entered the till at sale time) and requires remarks. */
export async function settleAuction(
  loanId: number,
  disposition: AuctionSurplusDisposition,
  remarks?: string,
): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/settle`, {
      method: "POST",
      body: JSON.stringify({ disposition, remarks }),
    })
  );
}

/* --- Auction history & decisions ----------------------------------------- */

/* getAuctionHistory returns every case ever opened against a loan. A loan can
 * now accumulate several: one withdrawn after the customer caught up, another
 * after a later default. */
export async function getAuctionHistory(loanId: number): Promise<AuctionRecordView[]> {
  const recs = await apiFetch<BackendAuctionRecord[] | null>(`/loans/${loanId}/auction/history`);
  return (recs || []).map(toAuctionRecordView);
}

/* listConcludedAuctions backs the Auctions page's History tab — finished cases
 * (Settled or Withdrawn) across all loans, which previously disappeared from
 * view entirely once concluded. */
export async function listConcludedAuctions(): Promise<AuctionRecordView[]> {
  const recs = await apiFetch<BackendAuctionRecord[] | null>(`/loans/auctions/concluded`);
  return (recs || []).map(toAuctionRecordView);
}

export async function listPendingAuctionDecisions(): Promise<AuctionDecisionRequestView[]> {
  const reqs = await apiFetch<BackendAuctionDecisionRequest[] | null>(`/loans/auctions/decisions/pending`);
  return (reqs || []).map((d) => ({
    id: d.id,
    auctionRecordId: d.auctionRecordId,
    loanId: d.loanId,
    kind: d.kind,
    amountPaid: d.amountPaid,
    outstandingAtRequest: d.outstandingAtRequest,
    status: d.status,
    decidedByRole: d.decidedByRole || "",
    decisionRemarks: d.decisionRemarks || "",
    createdAt: d.createdAt ? d.createdAt.slice(0, 10) : "",
    decidedAt: d.decidedAt ? d.decidedAt.slice(0, 10) : null,
  }));
}

/* resolveAuctionDecision applies a human ruling to an escalation. Valid
 * decisions depend on the request's kind, and the backend enforces both that
 * and the role authority — a Shortfall may only be decided by Branch Manager/
 * Management/Administrator, never by the Auction Administrator who raised it. */
export async function resolveAuctionDecision(
  loanId: number,
  requestId: number,
  decision: Exclude<AuctionDecisionStatus, "Pending">,
  remarks?: string,
): Promise<AuctionRecordView> {
  return toAuctionRecordView(
    await apiFetch<BackendAuctionRecord>(`/loans/${loanId}/auction/decision`, {
      method: "POST",
      body: JSON.stringify({ requestId, decision, remarks }),
    })
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
// employeeId is NOT sent — the backend derives the deciding employee's
// identity from the authenticated JWT (see platform.ActorFromContext).
export async function decideRequest(requestId: number, action: "Approved" | "Rejected", remarks?: string): Promise<RequestView> {
  const rec = await apiFetch<BackendLoanRequest>(`/loans/requests/${requestId}/decide`, {
    method: "PUT",
    body: JSON.stringify({ action, remarks }),
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

// employeeId is NOT sent — see platform.ActorFromContext's doc comment.
export type ReleaseApprovalInput = { stage: "Manager" | "Management"; action: "Approved" | "Rejected"; remarks?: string };

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
// No employeeId needed — the backend derives it from the authenticated JWT
// (see platform.ActorFromContext).
export async function completeRelease(loanId: number): Promise<LoanView> {
  const rec = await apiFetch<BackendLoan>(`/loans/${loanId}/complete-release`, {
    method: "POST",
  });
  return toView(rec);
}
