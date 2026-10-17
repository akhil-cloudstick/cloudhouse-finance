import type { SANCTION_STAGES, AUCTION_STAGES } from "@/modules/loans/services/loanService";

/* Mirrors backend/internal/loan/handler.go's ornamentRequest exactly. */
export type OrnamentRequestInput = {
  name: string;
  purity: string; // "24K" | "22K" | "18K"
  grossWeight: number;
  deductionWeight: number;
  quantity: number;
  remarks?: string;
  // Every photo of this ornament, attached when the loan is created.
  images?: string[];
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
  // Optional — the saved draft this loan was submitted from, discarded
  // server-side once the loan exists (see the backend's loanRequest.DraftID).
  draftId?: number;
  // Optional free text captured at creation — anything the standard fields
  // don't cover, carried through onto the printed Statement of Account.
  additionalInfo?: string;
  // One photo of the whole pledged lot, shown on the loan details card.
  overallPhotoUrl?: string;
  // Per-loan choice of how the scheme's service charge is collected.
  serviceChargeMode?: "WithheldFromPayout" | "AddedToPrincipal";
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
  releasedAt?: string | null;
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
  /* Derived/display-only — the single mode's name when exactly one split
   * amount below is non-zero, "Split" when more than one is. */
  method: string;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  reference: string;
  penalInterestApplied: number;
  interestApplied: number;
  principalApplied: number;
  runningBalance: number;
  /* Links this payment to the CashMovement row(s) it produced (one row per
   * non-zero mode among cashAmount/upiAmount/bankTransferAmount/
   * chequeAmount above, all sharing this group id) — empty for a payment
   * that never recorded cash (e.g. a Waiver) or whose cash-recording
   * failed. */
  cashTransactionGroupId?: string;
  bankId?: number | null;
  bankRef?: { id: number; name: string } | null;
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
  // The loan's own frozen scheme terms as they stood at creation (or the
  // last explicit scheme swap) — see backend Loan.SchemeInterestRate's doc
  // comment. Display must read these, not the live `scheme` above, so
  // editing a scheme later never changes what an existing loan shows it was
  // charged under.
  schemeInterestRate: number;
  schemeLtvPercent: number;
  schemeInterestMethod: string;
  schemePenalRate: number;
  openedDate: string;
  dueDate: string;
  additionalInfo?: string;
  overallPhotoUrl?: string;
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
  // Frozen at final sanction (Approve reaching FinalSanction), distinct from
  // principalAmount above which can still change pre-approval — see backend
  // Loan.SanctionedAmount's own doc comment. Zero/absent until the loan
  // actually clears final sanction.
  sanctionedAmount?: number;
  disbursedAmount?: number;
  serviceChargeMode?: string;
  serviceChargeAmount?: number;
  disbursementDate?: string | null;
  bankPledgeStatus: string;
  isDueSoon: boolean;
  isOverdue: boolean;
  isDefaulted: boolean;
  daysOverdue: number;
  auctionDate?: string | null;
  auctionAmount?: number | null;
  indemnityBondDocumentId?: string;
  indemnityBondSignRequestId?: string;
  indemnityBondSignStatus?: string;
  indemnityBondSignedUrl?: string;
  indemnityBondSignedAt?: string | null;
  pledgeSlipSignStatus?: string;
  pledgeSlipSignedUrl?: string;
  ornaments?: BackendOrnament[];
  approvals?: BackendLoanApproval[];
  payments?: BackendLoanPayment[];
  bankPledges?: BackendBankPledgeRecord[];
  approvalWarning?: string;
  // Set only when the sanction chain rejected the loan (status "Rejected").
  rejectedByName?: string;
  rejectedAt?: string | null;
  rejectionRemarks?: string;
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
  // All photos of this ornament, oldest first; photoUrl is the preview.
  photoUrls: string[];
  // Set once CompleteRelease actually hands this ornament back — null while
  // still physically pledged. See backend/internal/loan/model_ornament.go's
  // Ornament.ReleasedAt doc comment.
  releasedAt: string | null;
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
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  reference: string;
  penalInterestApplied: number;
  interestApplied: number;
  principalApplied: number;
  runningBalance: number;
  cashTransactionGroupId?: string;
  // Which bank the UPI/Bank Transfer/Cheque portion landed in — see
  // backend LoanPayment.BankID's doc comment. Nil for a Cash-only payment.
  bankId?: number | null;
  bankName?: string;
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
  customerCode: string;
  schemeId: string; // stringified, matches SchemeView.id
  schemeName: string;
  schemeRate: number;
  schemeLtv: number;
  schemeMethod: string;
  schemePenal: number;
  opened: string; // "YYYY-MM-DD"
  due: string;
  additionalInfo: string;
  overallPhotoUrl: string;
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
  sanctionedAmount: number;
  disbursedAmount: number;
  serviceChargeMode: string;
  serviceChargeAmount: number;
  disbursementDate: string | null;
  bankPledgeStatus: string;
  isDueSoon: boolean;
  isOverdue: boolean;
  isDefaulted: boolean;
  daysOverdue: number;
  approvalWarning: string;
  rejectedByName: string;
  rejectedAt: string | null;
  rejectionRemarks: string;
  auctionDate: string | null;
  auctionAmount: number | null;
  // Indemnity bond Aadhaar eSign (Setu) — indemnityBondSignStatus mirrors
  // Setu's own SignatureStatus.Status verbatim: "" (never started),
  // "sign_initiated", "sign_complete", or "failed". See
  // loansApi.ts's startIndemnityBondEsign/checkIndemnityBondEsign and
  // LoanDetail.tsx's "Send for Aadhaar eSign" action.
  indemnityBondSignStatus: string;
  indemnityBondSignedUrl: string;
  indemnityBondSignedAt: string | null;
  // GML pledge slip eSign (customer signs) — same status values as the bond's.
  pledgeSlipSignStatus: string;
  pledgeSlipSignedUrl: string;
  ornaments: OrnamentView[];
  payments: PaymentView[];
  bankPledges: BankPledgeView[];
};
/* --- Customer 360 sub-table rows -----------------------------------------
 * The 5 customer-scoped, server-paginated sub-tables (GET
 * /customers/:id/{loans,ornaments,payments,bank-pledges,auction-history} —
 * see backend/internal/loan/repository.go's CustomerOrnamentRow/
 * CustomerPaymentRow/CustomerBankPledgeRow/CustomerAuctionRow) span every
 * loan a customer has, so each row carries its parent loan's loanNumber
 * directly rather than requiring a second lookup against a separately
 * paginated Loan History table. */
export type BackendCustomerOrnamentRow = BackendOrnament & { loanNumber: string };
export type CustomerOrnamentRowView = OrnamentView & { loanId: number; loanNumber: string };
export type BackendCustomerPaymentRow = BackendLoanPayment & { loanNumber: string };
export type CustomerPaymentRowView = PaymentView & { loanId: number; loanNumber: string };
export type BackendCustomerBankPledgeRow = BackendBankPledgeRecord & { loanNumber: string };
export type CustomerBankPledgeRowView = BankPledgeView & { loanId: number; loanNumber: string };
/* --- Loan drafts ---------------------------------------------------------
 *
 * The "Save Draft" button on the New Gold Loan page (NewLoan.tsx), backed by
 * /loans/drafts (backend/internal/loan — see the LoanDraft model). A draft is
 * the form exactly as far as staff got: every field is optional, nothing is
 * validated, and no loan number/packet/gold rate is involved until it's
 * submitted through createLoan() in the normal way. Drafts are private to
 * the employee who saved them, enforced server-side from the JWT. */
export type DraftOrnamentInput = {
  name: string;
  purity: string;
  grossWeight: number;
  quantity: number;
  imageUrl?: string;
  imageName?: string;
  imageUrls?: string[];
};
export type SaveDraftInput = {
  branchId: number;
  overallPhotoUrl?: string;
  customerId?: number;
  schemeId?: number;
  lockerId?: number;
  principalOverride?: number;
  ornaments: DraftOrnamentInput[];
};
export type BackendLoanDraft = {
  id: number;
  createdByEmployeeId: number;
  branchId: number;
  branch?: { id: number; name: string };
  customerId?: number;
  customer?: { id: number; name: string; code: string };
  schemeId?: number;
  scheme?: { id: number; name: string };
  lockerId?: number;
  principalOverride?: number;
  overallPhotoUrl?: string;
  ornaments: {
    id: number;
    name: string;
    purity: string;
    grossWeight: number;
    quantity: number;
    imageUrl: string;
    imageName: string;
    imageUrls?: string[] | null;
    position: number;
  }[];
  createdAt: string;
  updatedAt: string;
};
export type IndemnityBondEsignStart = {
  id: string;
  documentId: string;
  status: string;
  url: string;
  // One signing link per signer, borrower first, then witness 1 and 2.
  signers?: { identifier: string; displayName: string; url: string }[];
};
export type EsignWitnessInput = { name: string; phone: string };
/* Renders the loan's indemnity bond (in `lang`) server-side, uploads it to
 * Setu, and starts an Aadhaar eSign request — returns the signing URL the
 * CUSTOMER must open themselves (their own device/browser) to complete
 * Aadhaar+OTP signing. Mirrors customersApi.ts's startAadhaarVerify shape —
 * same "open URL, then poll" flow as DigiLocker Aadhaar verification. */
export type IndemnityBondDeliverBy = "open" | "whatsapp" | "dashboard";
export type IndemnityBondEsignCheck = {
  loan: BackendLoan;
  status: string;
  // Per-signer completion in request order: customer, then witness 1 and 2.
  signers?: { signed: boolean }[];
};
export type ServicingClass = "due_soon" | "overdue" | "defaulted";
export type LoanFilters = {
  q?: string;
  status?: string | string[]; // an array matches any of the statuses
  // Read-time classes (not stored statuses): the Loans page's Due Soon / Overdue /
  // Defaulted tabs. A single one replaces `status` on the server; several are
  // OR-ed with each other and with `status`.
  servicing?: ServicingClass | ServicingClass[];
  branchId?: number | number[];
  customerId?: number | number[];
  bankPledgeStatus?: string;
  schemeId?: number;
  from?: string; // YYYY-MM-DD, bounds openedDate (inclusive)
  to?: string; // YYYY-MM-DD, bounds openedDate (inclusive)
};
export type PurityTestInput = {
  testedPurity: string;
  testedGrossWeight: number;
  testedDeductionWeight: number;
  testingRemarks?: string;
  testedBy: string;
  testedAt: string; // "YYYY-MM-DD"
};
export type SanctionStage = (typeof SANCTION_STAGES)[number];
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
// employeeId/role are NOT sent — the backend derives the acting employee's
// identity and role from the authenticated JWT (see
// platform.ActorFromContext), never from the request body. Administrator's
// "may act at any pending stage" bypass still works, keyed off their real
// role.
// "Verified" is the LoanOperator stage's action — the operator verifies the
// loan they made, which advances the chain to the Branch Manager exactly
// like an "Approved" action does at the two stages above it. It is not
// valid at any other stage (backend: Service.Approve).
export type ApprovalInput = {
  stage: SanctionStage | string;
  action: "Approved" | "Rejected" | "Verified";
  remarks?: string;
  // Only meaningful (and only validated server-side) when this call is the
  // one that clears the FINAL enabled sanction stage (FinalSanction by
  // default, but whichever stage is last in this business's configured
  // chain) and triggers disbursement — must sum to the principal amount.
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  // Which bank the UPI/Bank Transfer/Cheque portion was sent from —
  // mirrors PaymentInput.bankId. Only stored at FinalSanction disbursement.
  bankId?: number;
  // How the withheld service charge is recorded (same four-mode split as the
  // payout; must sum to the loan's service charge). Omitted = recorded as Cash.
  chargeCashAmount?: number;
  chargeUpiAmount?: number;
  chargeBankTransferAmount?: number;
  chargeChequeAmount?: number;
  chargeBankId?: number;
};
/* Editable even after final sanction (see backend Service.UpdateLoan's own
 * doc comment) — scheme and/or principal amount, either independently.
 * Ornaments themselves go through the existing addOrnament/updateOrnament/
 * deleteOrnament calls below, one ornament at a time, not through this. */
export type UpdateLoanInput = { schemeId?: number; principalAmount?: number; overallPhotoUrl?: string };
// employeeId is NOT sent — the backend derives the receiving employee's
// identity from the authenticated JWT, never the request body (see
// platform.ActorFromContext).
export type PaymentInput = {
  amount: number;
  // What the amount may pay off. The API accepts only these five (see the
  // handler's staffSelectablePaymentTypes); Adjustment/Waiver and the auction
  // types are raised by their own flows, never posted from here.
  type: "Interest" | "Penal Interest" | "Principal" | "Partial" | "Full Settlement" | string;
  processingFee?: number; // extra charge collected alongside amount — never applied to penal/interest/principal
  paidOn: string;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  // Which bank the UPI/Bank Transfer/Cheque portion landed in — required
  // when any of those three is non-zero (see backend's
  // ErrBankRequiredForSplitMode).
  bankId?: number;
  reference?: string;
  description?: string;
  // Overrides the system-calculated interest bucket for this payment only
  // (see backend/internal/loan/service.go's PaymentInput.InterestOverride
  // doc comment) — omit to use the live-calculated figure, same as before
  // this existed.
  interestOverride?: number;
};
/* Top-up: draws additional cash against an already-Active loan's spare
 * eligible value (headroom = eligibleLoanAmount - outstanding), without
 * closing/reopening it — see backend/internal/loan/service.go's
 * Service.TopUpLoan. */
export type TopUpInput = {
  amount: number;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number; // required when the breakdown includes UPI or Bank Transfer
  occurredOn?: string; // "YYYY-MM-DD" — omit for today
  reference?: string;
  // "require" (default, if omitted) blocks the top-up when the loan has
  // outstanding interest/penal interest — staff must record that payment
  // separately first. "deduct" clears it out of this top-up's own cash
  // payout instead (the customer still draws the full requested amount
  // against the loan, but gets less cash out).
  settleInterest?: "require" | "deduct";
};
export type LoanTopUpView = {
  id: number;
  amount: number;
  eligibleAmountAtTopUp: number;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  occurredOn: string;
  reference: string;
  // Pending = waiting in the loan_topup approval chain (nothing paid out
  // yet); Rejected = turned down there. Only Active rows are real
  // disbursements.
  status: "Active" | "Reversed" | "Pending" | "Rejected";
  // The pending stage value while Pending ("PendingBranchManager", …),
  // "Approved"/"Rejected" once decided, "" when paid out with no chain.
  approvalStage: string;
  settleInterest: string;
  createdAt: string;
};
/* One decision on a pending top-up — stage is the stage KEY
 * ("BranchManager"/"Management"). The final enabled stage pays it out. The
 * acting employee/role come from the JWT. */
export type TopUpApprovalInput = { stage: string; action: "Approved" | "Rejected"; remarks?: string };
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

  /* How a "CashIn" advance was received, and the branch bank account a UPI/
   * Bank Transfer/Cheque share landed in. Omitted = all Cash. */
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  receivedBankId?: number;
};
export type BankPledgeCashTreatment = "CashIn" | "RecordOnly";
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
  // Populated only by rows that carry their parent loan alongside them
  // (the History tab's branch-wide query) — a plain per-loan history call
  // (GET /loans/:id/bank-pledge/history) already has the loan in context,
  // so its rows leave these blank rather than re-fetching what the caller
  // already has.
  loanNumber?: string;
  customerName?: string;
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
export type AuctionStage = (typeof AUCTION_STAGES)[number] | "Withdrawn";
export type AuctionSettlementStatus =
  | "Pending"
  | "SettledByRepayment"
  | "WrittenOff"
  | "SettledToCustomer"
  | "SettledToLoanCo";
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
type BackendAuctionEvent = {
  id: number;
  action: string;
  actorRole?: string;
  remarks?: string;
  createdAt: string;
};
export type BackendAuctionDecisionRequest = {
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
export type BackendCustomerAuctionRow = BackendAuctionRecord & { loanNumber: string };
export type CustomerAuctionRowView = AuctionRecordView & { loanNumber: string };
/* The Auctions screen's History tab (Auctions.tsx's "Auctions Conducted" /
 * "Closed Without Auction" sub-tables) needs the loan number and customer
 * name to actually identify a row and link it — the same augmentation
 * CustomerAuctionRow already needed, mirrored here as its own type since
 * this one also carries CustomerName. */
export type BackendConcludedAuctionRow = BackendAuctionRecord & { loanNumber: string; customerName: string };
export type ConcludedAuctionRowView = AuctionRecordView & { loanNumber: string; customerName: string };
/* The Payment Ledger on LoanDetail — one page of the loan's whole history
 * (sanction, payments, top-ups, auction rows), built and paged by GET
 * /loans/:id/ledger (backend/internal/loan/ledger.go). Balances are carried
 * over the full history server-side, so any page shows the true figure. A
 * payment/payout/top-up split across modes is one row per mode — `part` is
 * that row's share. */
export type LoanLedgerPart = { mode: string; amount: number; index: number; count: number };
// component names what a split repayment row was applied to (e.g. an auction's proceeds).
// accruing marks interest worked out up to the day the ledger is opened and not saved yet.
type LedgerEntryBase = { key: string; date: string; amount: number; part?: LoanLedgerPart; component?: string; mode?: string; accruing?: boolean };
export type LoanLedgerEntry =
  | (LedgerEntryBase & { kind: "sanction"; balance: number; payment: PaymentView | null })
  | (LedgerEntryBase & { kind: "payment"; balance: number; row: PaymentView; auction: AuctionRecordView | null })
  | (LedgerEntryBase & { kind: "topup"; balance: number; row: LoanTopUpView })
  | (LedgerEntryBase & { kind: "interest"; balance: number })
  | (LedgerEntryBase & { kind: "penal"; balance: number })
  | (LedgerEntryBase & { kind: "service-charge"; balance: number })
  | (LedgerEntryBase & { kind: "auction-sale"; balance: null; row: AuctionRecordView })
  | (LedgerEntryBase & { kind: "auction-surplus"; balance: null; row: AuctionRecordView });
// totalDebit/totalCredit sum the Debit/Credit columns over every row in the
// filtered range, not just this page — the footer's Total row.
export type LoanLedgerPage = { items: LoanLedgerEntry[]; total: number; limit: number; offset: number; totalDebit: number; totalCredit: number };
export type LoanLedgerQuery = {
  from?: string;
  to?: string;
  // Entry kinds to keep: sanction | payment | topup | interest | penal | auction.
  kinds?: string[];
  limit: number;
  offset: number;
  // Open on the page holding this row — by key, else by date + amount.
  focusKey?: string;
  focusDate?: string;
  focusAmount?: number;
};
export type BackendLoanLedgerEntry = {
  kind: LoanLedgerEntry["kind"];
  key: string;
  date: string;
  amount: number;
  balance: number | null;
  part?: LoanLedgerPart;
  component?: string;
  mode?: string;
  accruing?: boolean;
  payment?: BackendLoanPayment;
  topUp?: LoanTopUpView;
  auction?: BackendAuctionRecord;
};
/* --- Extension & release requests ("Extensions & Release" page) ---------
 * Mirrors backend/internal/loan/model.go's LoanRequest. Staff log these on
 * a customer's behalf today (from LoanDetail.tsx / CustomerDetail.tsx); the
 * Android app can create the same records later via the same endpoints. */
export type BackendLoanRequest = {
  id: number;
  loanId: number;
  loan?: BackendLoan;
  type: LoanRequestType;
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: "Customer" | "Staff";
  detail: string;
  requestedExtensionMonths?: number | null;
  newDueDate?: string | null;
  // Release only — the same Manager→Management chain used for loan
  // sanctioning (see backend/internal/loan/model.go's LoanRequest).
  approvalStage?: string;
  // isPartial/customerSawGold/paymentRecorded/locked are the reworked
  // Partial Ornament Release fields — see backend/internal/loan/
  // model_request.go's LoanRequest doc comment. paymentVerified/
  // packetVerified/bankPledgeVerified/customerConfirmed are the RETIRED
  // 4-item checklist, kept only because the backend still serialises them
  // (nothing writes/reads them any more) — not used by this file any more.
  isPartial: boolean;
  customerSawGold: boolean;
  paymentRecorded: boolean;
  locked: boolean;
  paymentVerified: boolean;
  packetVerified: boolean;
  bankPledgeVerified: boolean;
  customerConfirmed: boolean;
  verificationNotes: string;
  charges: number;
  // How much of `charges` has already been posted onto the loan as a real
  // payment (see backend/internal/loan/service.go's RecordReleasePayment) —
  // `charges - chargesApplied` is what's still left to collect.
  chargesApplied: number;
  settlementAmount: number;
  // "Record Payment" step on the Manager-stage release review screen — see
  // backend/internal/loan/service.go's RecordReleasePayment.
  recordedDiscount: number;
  recordedPayment: number;
  paymentDueDate?: string | null;
  // Partial Ornament Release's selected-ornament set — see
  // backend/internal/loan/model_request.go's LoanRequestOrnament.
  ornamentSelections?: { id: number; requestId: number; ornamentId: number }[];
  remarks: string;
  requestedAt: string;
  decidedAt?: string | null;
  decidedByEmployeeId?: number | null;
  createdAt: string;
};
export type LoanRequestType = "Extension" | "Release";
export type RequestView = {
  id: number;
  loanId: string; // loanNumber, matches LoanView.id
  loanNumericId: number; // raw backend loan id, needed to fetch full loan financials
  loanNumber: string;
  customerName: string;
  type: LoanRequestType;
  status: "Pending" | "Approved" | "Rejected";
  detail: string;
  requestedAt: string; // "YYYY-MM-DD"
  remarks: string;
  requestedExtensionMonths: number | null;
  approvalStage: string; // "" for Extension requests
  isPartial: boolean;
  customerSawGold: boolean;
  paymentRecorded: boolean;
  locked: boolean;
  verificationNotes: string;
  charges: number;
  chargesApplied: number;
  settlementAmount: number;
  recordedDiscount: number;
  recordedPayment: number;
  paymentDueDate: string | null; // "YYYY-MM-DD", null if not set
  // Ornament IDs selected for release on this request — empty for a plain
  // full release (or an Extension request).
  ornamentIds: number[];
};
export type LoanRequestFilters = {
  status?: string;
  loanId?: number;
  /* "extension" | "release" — server-side, matches LoanRequest.Type. */
  type?: string;
  /* Server-side search: loan number, customer name / code / phone. */
  q?: string;
};
/* Gold-value risk assessment — mirrors backend/internal/loan/service.go's
 * LoanRiskRow exactly. Compares each open loan's principal against what its
 * pledged gold would fetch sold TODAY (today's published rate × each
 * ornament's own purity/weight — a loan can carry mixed-purity ornaments),
 * not the value the loan was opened at. */
export type LoanRiskLevel = "Safe" | "AtRisk" | "Loss";
export type LoanRiskRow = {
  loanId: number;
  loanNumber: string;
  customerId: number;
  customerName: string;
  status: string;
  principalAmount: number;
  outstandingAmount: number;
  totalNetWeight: number;
  currentGoldValue: number;
  riskLevel: LoanRiskLevel;
};
// Mirrors backend/internal/loan/handler.go's ListRiskAssessment response
// envelope — counts/total cover every loan matching status/date (NOT the
// riskLevel filter below), not just the current page, so the KPI tiles stay
// a true breakdown of the whole matching set even while one risk level is
// selected.
export type LoanRiskCounts = { loss: number; atRisk: number; safe: number };
/* --- Release verification checklist & approval chain --------------------
 * Reworked 2-item checklist (customerSawGold + the payment step below) —
 * see backend/internal/loan/model_request.go's LoanRequest doc comment and
 * VerifyReleaseChecklist's handler, which reads customerSawGold as a
 * "present or not" *bool so it can tell "explicitly set to false" apart
 * from "field omitted"; leaving it undefined here therefore leaves the
 * server-side value untouched, same as charges/verificationNotes below. */
export type ChecklistInput = {
  customerSawGold?: boolean;
  verificationNotes?: string;
  charges?: number;
};
/* "Record Payment" step on the release review screen — now driven by the
 * SAME general payment shape PaymentModalContent posts to /loans/:id/payments
 * (see PaymentInput above), plus a Discount amount posted alongside it as a
 * real PaymentTypeDiscount ledger entry (see backend/internal/loan/
 * service.go's RecordReleaseRequestPayment). On success this flips
 * PaymentRecorded/Locked true and auto-advances the request through the
 * Manager stage — there is no more separate "does this clear the balance"
 * branch on the frontend, the backend handles the whole waterfall. */
export type ReleasePaymentInput = {
  type?: string;
  amount: number;
  discount?: number;
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
  method?: string;
  reference?: string;
  interestOverride?: number;
  dueDate?: string;
};
// employeeId is NOT sent — see platform.ActorFromContext's doc comment.
// stage is the release flow's stage KEY ("Manager"/"Management") — which of
// them apply is per-business configuration (flow "loan_release").
export type ReleaseApprovalInput = { stage: string; action: "Approved" | "Rejected"; remarks?: string };
/* --- Extension approval chain --------------------------------------------
 * Loan Officer -> Branch Manager -> Management, the same generalized
 * POST /loans/requests/:requestId/approve endpoint as Release (the backend
 * dispatches by the request's own Type — see
 * backend/internal/loan/service.go's ApproveExtensionRequest). Unlike
 * Release, this stage IS server-side role-gated (ActorRole is checked
 * against each stage's required role, Administrator bypasses); employeeId/
 * role are still not sent from here — the backend derives both from the
 * JWT (platform.ActorFromContext). */
// stage is the extension flow's stage KEY ("LoanOfficer"/"BranchManager"/
// "Management") — which of them apply is per-business configuration (flow
// "loan_extension").
export type ExtensionApprovalInput = { stage: string; action: "Approved" | "Rejected"; remarks?: string };
/* Same shape NewLoan.tsx's buildDraft() already assembles for the old
 * client-side printIndemnityBond() call — ornaments included. */
export type IndemnityBondPreviewInput = {
  loanNumber: string;
  name?: string;
  dob?: string;
  address?: string;
  branchName?: string;
  phone?: string;
  pan?: string;
  aadhaar?: string;
  principalAmount?: number;
  interestRate?: number;
  dueDate?: string;
  ornaments: { name: string; purity?: string; grossWeight: number; netWeight: number; value: number }[];
};
