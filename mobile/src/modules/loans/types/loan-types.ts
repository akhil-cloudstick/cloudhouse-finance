// Mirrors the subset of backend/internal/loan/model.go's Loan JSON shape
// the mobile list/detail screens use so far — expand as more loan screens
// (payments, approval chain, auction, bank pledge) are built out.

// backend/internal/loan/model.go's Ornament (146-231ish).
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
  // Photos of this ornament (GET /loans/:id preloads them).
  images?: { id: number; imageUrl: string }[];
  // Set once handed back by a (partial) release; unset while still pledged.
  releasedAt?: string | null;
};

// Mirrors backend/internal/loan/service.go's LoanRiskRow — GET
// /loans/risk-assessment. riskLevel is computed server-side (see
// Service.ClassifyRisk): "Loss" (today's gold value < principal), "AtRisk"
// (covered but under the 10% safety margin), "Safe" (comfortably covered).
export type LoanRiskLevel = "Safe" | "AtRisk" | "Loss";

export type LoanRiskRow = {
  loanId: number;
  loanNumber: string;
  customerId: number;
  customerName: string;
  status: string;
  principalAmount: number;
  totalNetWeight: number;
  currentGoldValue: number;
  riskLevel: LoanRiskLevel;
};

// backend/internal/loan/model.go's LoanApproval (266-284) — one row per
// decision at a sanction-chain stage.
export type LoanApproval = {
  id: number;
  loanId: number;
  stage: string; // SanctionStage* — "LoanOperator" | "BranchManager" | "FinalSanction"
  action: string; // "Approved" | "Rejected" | "Verified"
  actorEmployeeId: number;
  actorRole: string;
  remarks?: string;
  createdAt: string;
};

// backend/internal/loan/model.go's LoanPayment (312-362).
export type LoanPayment = {
  id: number;
  loanId: number;
  amount: number;
  type: string; // PaymentType* — "Interest" | "Principal" | "Partial" | "Full Settlement" | "Adjustment" | "Waiver" | "Auction Sale" | "Auction Write-Off"
  paidOn: string;
  receivedByEmployeeId: number;
  description?: string;
  method?: string;
  // How amount was split across modes — mirrors web loanService.ts's
  // PaymentView. method above is derived from these (the single mode's
  // name when exactly one is non-zero, "Split" when more than one).
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  reference?: string;
  processingFeeApplied: number;
  penalInterestApplied: number;
  interestApplied: number;
  principalApplied: number;
  runningBalance: number;
  processingFee: number;
  // Links this payment to the CashMovement row(s) it produced — see
  // CashMovement.transactionGroupId in src/modules/cash/types/cash-types.ts.
  cashTransactionGroupId?: string;
  createdAt: string;
};

// backend/internal/loan/model.go's BankPledgeRecord (366+).
export type BankPledgeRecord = {
  id: number;
  loanId: number;
  bankId?: number | null;
  bankName: string;
  pledgedAmount: number;
  pledgeDate: string;
  releaseDate?: string | null;
  bankPledgeDueDate?: string | null;
  bankInterestRate?: number;
  referenceNumber?: string;
  cashTreatment?: string; // "CashIn" | "RecordOnly"
  status: string; // "Active" | "Released" | "Voided" — see BankPledgeStatusRecord* constants
  // Only ever set once status is "Voided" — the reason staff gave when
  // voidBankPledge() cancelled a mis-recorded pledge (see src/modules/bank-pledges/services/bankPledgeService.ts).
  voidReason?: string;
  voidedAt?: string | null;
};

// backend/internal/loan/model.go's LoanRequest (523+) — Extension or Release.
export type LoanRequest = {
  id: number;
  loanId: number;
  // Backend preloads Loan.Customer on every list/detail fetch — used by the
  // standalone Requests list screen to show loan number/customer name
  // without a separate lookup per row (mirrors frontend/modules/loans/
  // src/modules/loans/services/loanService.ts's RequestView flattening).
  loan?: Loan;
  type: "Extension" | "Release";
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: string;
  detail?: string;
  requestedExtensionMonths?: number | null;
  newDueDate?: string | null;
  // Pending stage value of the request's approval flow (src/api/
  // approvalWorkflow.ts: loan_extension / loan_release), or
  // "Approved" / "Rejected" once decided.
  approvalStage?: string;
  // Release only. isPartial: a strict subset of ornaments (ornamentSelections).
  // Approve needs customerSawGold plus a recorded payment (or the balance
  // condition already met); `locked` (set by the first release payment)
  // freezes customerSawGold and hides Reject.
  isPartial?: boolean;
  ornamentSelections?: { ornamentId: number }[];
  customerSawGold?: boolean;
  paymentRecorded?: boolean;
  locked?: boolean;
  verificationNotes?: string;
  charges: number;
  // How much of `charges` has already been posted onto the loan as a real
  // payment — see backend/internal/loan/service.go's RecordReleasePayment.
  chargesApplied: number;
  settlementAmount: number;
  // "Record Payment" step on the Manager-stage release review screen — see
  // backend/internal/loan/service.go's RecordReleasePayment.
  recordedDiscount: number;
  recordedPayment: number;
  paymentDueDate?: string | null;
  remarks?: string;
  requestedAt: string;
  decidedAt?: string | null;
  decidedByEmployeeId?: number | null;
  createdAt: string;
};

// backend/internal/loan/model_auction.go's AuctionRecord (66+) — only the
// fields the customer-profile Auction History table renders; add more if a
// future mobile Auctions screen needs them.
export type LoanAuctionRecord = {
  id: number;
  loanId: number;
  stage: string;
  auctionEligibleDate?: string | null;
  auctionDate?: string | null;
  auctionReferenceNumber?: string;
  saleAmount?: number;
  auctionExpenses?: number;
  surplusShortfall?: number;
  finalSettlementStatus?: string;
  surplusPayableAmount?: number;
  surplusDisposition?: string;
};

// The customer-scoped sub-table endpoints (GET /customers/:id/ornaments|
// payments|bank-pledges|auction-history, backend/internal/loan/handler.go's
// ListOrnamentsForCustomer etc.) return each base row plus a flattened
// `loanNumber` — mirrors frontend/modules/customers/services/
// customerService.ts's BackendCustomer*Row types exactly.
export type CustomerOrnamentRow = Ornament & { loanNumber: string };
export type CustomerPaymentRow = LoanPayment & { loanNumber: string };
export type CustomerBankPledgeRow = BankPledgeRecord & { loanNumber: string };
export type CustomerAuctionRow = LoanAuctionRecord & { loanNumber: string };

export type Loan = {
  id: number;
  loanNumber: string;
  branchId: number;
  branch?: { id: number; name: string };
  // One photo of the whole pledged lot ("/uploads/...").
  overallPhotoUrl?: string;
  customerId: number;
  // The backend actually embeds the full customer.Customer row here (see
  // backend/internal/loan/model_loan.go's Customer field) — this was only
  // ever declared with the 3 fields the list/detail screens used so far;
  // extended with what the print flows below need (address, code, dob for
  // the pledge agreement's age calc, pan for its KYC field — the full
  // Aadhaar is fetched separately via getCustomerAadhaarFull, never
  // carried on the loan payload itself).
  customer?: { id: number; name: string; phone: string; code?: string; address?: string; dob?: string; pan?: string };
  schemeId: number;
  scheme?: { id: number; name: string; interestRate: number; ltvPercent: number };
  schemeLtvPercent?: number;
  // Frozen from the scheme at creation. "WithheldFromPayout" pays out
  // principal − serviceChargeAmount at disbursement.
  serviceChargeMode?: string;
  serviceChargeAmount?: number;
  // The scheme terms frozen onto the loan.
  schemePenalRate?: number;
  schemeInterestMethod?: string;
  status: string;
  openedDate: string;
  dueDate: string;
  // Free text captured at creation (mobile/app/(tabs)/new-loan.tsx) —
  // anything the standard fields don't cover, carried through onto the
  // printed Statement of Account.
  additionalInfo?: string;
  principalAmount: number;
  outstandingAmount: number;
  outstandingProcessingFee?: number;
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
  eligibleLoanAmount?: number;
  // Read-time derived flags (backend/internal/loan/model.go's IsDefaulted
  // etc. — gorm:"-", never a persisted `status` value). Filtering the
  // /loans list by `status=Defaulted` server-side always returns zero rows
  // for this reason — bucket by this flag client-side instead.
  isDefaulted?: boolean;
  isOverdue?: boolean;
  isDueSoon?: boolean;
  daysOverdue?: number;
  // Sanction-chain state — "" once Approved/Rejected past the chain.
  approvalStage: string;
  approvalWarning?: string;
  // Set only when the sanction chain rejected the loan (status "Rejected").
  rejectedByName?: string;
  rejectedAt?: string | null;
  rejectionRemarks?: string;
  // Frozen at final sanction (Approve reaching FinalSanction), distinct
  // from principalAmount which can still change pre-approval — see backend
  // Loan.SanctionedAmount's own doc comment. Zero/absent until the loan
  // actually clears final sanction.
  sanctionedAmount?: number;
  disbursedAmount?: number;
  disbursementDate?: string | null;
  bankPledgeStatus?: string;
  ornaments?: Ornament[];
  approvals?: LoanApproval[];
  payments?: LoanPayment[];
  bankPledges?: BankPledgeRecord[];
  // Aadhaar eSign state (backend/internal/loan's indemnity-bond eSign flow —
  // see src/modules/loans/services/loanService.ts's startIndemnityBondEsign/checkIndemnityBondEsign).
  // Mirrors Setu's own SignatureStatus.Status verbatim: "" (never started),
  // "sign_initiated", "sign_complete", or "failed".
  indemnityBondSignStatus?: string;
  indemnityBondSignedUrl?: string;
};

// One top-up on a loan — mirrors web loanService.ts's LoanTopUpView
// (backend/internal/loan ListTopUps).
export type LoanTopUp = {
  id: number;
  amount: number;
  eligibleAmountAtTopUp: number;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  occurredOn: string;
  reference: string;
  // Pending/Rejected only when the tenant's "loan_topup" approval flow is on.
  status: "Active" | "Reversed" | "Pending" | "Rejected";
  // Pending stage value (loan_topup flow) while Pending; "Approved" /
  // "Rejected" once decided; "" for a top-up paid out without a chain.
  approvalStage?: string;
  settleInterest?: string;
  createdAt: string;
};

export type LoanRiskCounts = { loss: number; atRisk: number; safe: number };
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
  // One photo of the whole pledged lot ("/uploads/..."); required for TML businesses.
  overallPhotoUrl?: string;
  // Optional free text captured at creation — anything the standard fields
  // don't cover, carried through onto the printed Statement of Account.
  additionalInfo?: string;
  // How a scheme service charge is applied — "Deduct from loan" (WithheldFromPayout) or "Add to loan"
  // (AddedToPrincipal). Only sent when the scheme has a charge.
  serviceChargeMode?: "WithheldFromPayout" | "AddedToPrincipal";
  // The saved draft this loan came from, so the server discards it now that a real loan exists.
  draftId?: number;
};
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
// --- Sanction-chain approvals (backend/internal/loan/handler.go's Approve/
// ListApprovals, POST/GET /loans/:id/approve|approvals) ---------------------

// Which sanction stages a loan walks — and which permission acts at each —
// is per-tenant configuration now (src/common/services/approvalWorkflowService.ts, flow
// "loan_sanction"): the chain starts at the first enabled stage and the LAST
// enabled stage disburses. Stage keys are the chain's role keys ("R<roleId>",
// set on the web's Approval Workflow tab) or, on loans raised before that,
// LoanOperator / BranchManager / FinalSanction (key and pending value are
// identical for this flow).
export type SanctionStage = string;
// --- Edit Loan / Hard Delete (backend/internal/loan/handler.go's
// UpdateLoan/HardDeleteLoan) — mirrors frontend/modules/loans/services/
// loanService.ts's updateLoan/hardDeleteLoan exactly. Ornaments themselves
// go through addOrnament/updateOrnament/deleteOrnament above, one at a
// time, not through this. -------------------------------------------------

export type UpdateLoanInput = { schemeId?: number; principalAmount?: number };
// --- Indemnity bond Aadhaar eSign (Setu) ------------------------------------
// Mirrors src/modules/loans/services/loanService.ts's
// startIndemnityBondEsign/checkIndemnityBondEsign exactly — same backend
// endpoints (backend/internal/loan/handler.go's StartIndemnityBondEsign/
// CheckIndemnityBondEsign).

// Backend accepts gu only for businesses allowed Gujarati; it rejects otherwise.
export type BondLang = "en" | "ml" | "gu" | "ta";
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
export type IndemnityBondEsignCheck = {
  loan: Loan;
  status: string;
};
// GET /loans/:id/ledger (backend/internal/loan/ledger.go). The staff app builds
// its Payment Ledger locally from the loan's payments/top-ups; this is used for
// the server-computed "interest" / "penal" charge rows, which aren't in those.
// `kind` is open-ended — callers must ignore kinds they don't know.
export type LoanLedgerEntry = {
  key: string;
  kind: string;
  date: string;
  amount: number;
  balance: number | null;
  note?: string;
};

// --- Saved loan drafts (backend /loans/drafts) — a half-entered New Loan kept per employee. ---
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
export type LoanDraft = {
  id: number;
  branchId: number;
  branch?: { id: number; name: string };
  customerId?: number;
  customer?: { id: number; name: string; code: string };
  schemeId?: number;
  scheme?: { id: number; name: string };
  lockerId?: number;
  principalOverride?: number;
  overallPhotoUrl?: string;
  ornaments: { id: number; name: string; purity: string; grossWeight: number; quantity: number; imageUrl: string; imageName: string; imageUrls?: string[] | null; position: number }[];
  createdAt: string;
  updatedAt: string;
};
