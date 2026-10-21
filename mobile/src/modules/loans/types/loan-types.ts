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
  images?: { id: number; imageUrl: string }[];
  // Set once handed back by a (partial) release; unset while still pledged.
  releasedAt?: string | null;
};

// riskLevel computed server-side: Loss (gold value < principal), AtRisk (under 10% margin), Safe.
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

// One row per decision at a sanction-chain stage.
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

export type LoanPayment = {
  id: number;
  loanId: number;
  amount: number;
  type: string; // PaymentType* — "Interest" | "Principal" | "Partial" | "Full Settlement" | "Adjustment" | "Waiver" | "Auction Sale" | "Auction Write-Off"
  paidOn: string;
  receivedByEmployeeId: number;
  description?: string;
  method?: string;
  // method is derived from these: the single mode's name if only one is non-zero, else "Split".
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
  // Links this payment to the CashMovement row(s) it produced.
  cashTransactionGroupId?: string;
  createdAt: string;
};

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
  status: string; // "Active" | "Released" | "Voided"
  // Only set once status is "Voided" — the reason staff gave when cancelling a mis-recorded pledge.
  voidReason?: string;
  voidedAt?: string | null;
};

// Extension or Release.
export type LoanRequest = {
  id: number;
  loanId: number;
  // Preloaded so the Requests list can show loan number/customer name without a per-row lookup.
  loan?: Loan;
  type: "Extension" | "Release";
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: string;
  detail?: string;
  requestedExtensionMonths?: number | null;
  newDueDate?: string | null;
  // Pending stage of the approval flow, or "Approved"/"Rejected" once decided.
  approvalStage?: string;
  // Release only; `locked` (set by the first release payment) freezes customerSawGold and hides Reject.
  isPartial?: boolean;
  ornamentSelections?: { ornamentId: number }[];
  customerSawGold?: boolean;
  paymentRecorded?: boolean;
  locked?: boolean;
  verificationNotes?: string;
  charges: number;
  // How much of `charges` has already been posted onto the loan as a real payment.
  chargesApplied: number;
  settlementAmount: number;
  // "Record Payment" step on the Manager-stage release review screen.
  recordedDiscount: number;
  recordedPayment: number;
  paymentDueDate?: string | null;
  remarks?: string;
  requestedAt: string;
  decidedAt?: string | null;
  decidedByEmployeeId?: number | null;
  createdAt: string;
};

// Only the fields the customer-profile Auction History table renders.
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

// Customer-scoped sub-table endpoints return each base row plus a flattened `loanNumber`.
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
  // Extended beyond list/detail needs for the print flows: address/dob for the pledge agreement, pan for KYC.
  customer?: { id: number; name: string; phone: string; code?: string; address?: string; dob?: string; pan?: string };
  schemeId: number;
  scheme?: { id: number; name: string; interestRate: number; ltvPercent: number };
  schemeLtvPercent?: number;
  // Frozen from the scheme at creation. "WithheldFromPayout" pays out principal − serviceChargeAmount at disbursement.
  serviceChargeMode?: string;
  serviceChargeAmount?: number;
  schemePenalRate?: number;
  schemeInterestMethod?: string;
  status: string;
  openedDate: string;
  dueDate: string;
  // Free text captured at creation, carried through onto the printed Statement of Account.
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
  // Derived read-time flags, never a persisted status — /loans list `status=Defaulted` filter never matches; bucket client-side.
  isDefaulted?: boolean;
  isOverdue?: boolean;
  isDueSoon?: boolean;
  daysOverdue?: number;
  // "" once Approved/Rejected past the sanction chain.
  approvalStage: string;
  approvalWarning?: string;
  // Set only when the sanction chain rejected the loan (status "Rejected").
  rejectedByName?: string;
  rejectedAt?: string | null;
  rejectionRemarks?: string;
  // Frozen at final sanction, distinct from principalAmount which can still change pre-approval.
  sanctionedAmount?: number;
  disbursedAmount?: number;
  disbursementDate?: string | null;
  bankPledgeStatus?: string;
  ornaments?: Ornament[];
  approvals?: LoanApproval[];
  payments?: LoanPayment[];
  bankPledges?: BankPledgeRecord[];
  // Mirrors Setu's SignatureStatus.Status: "" (never started), "sign_initiated", "sign_complete", or "failed".
  indemnityBondSignStatus?: string;
  indemnityBondSignedUrl?: string;
};

// One top-up on a loan.
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
  // "" for a top-up paid out without an approval chain.
  approvalStage?: string;
  settleInterest?: string;
  createdAt: string;
};

export type LoanRiskCounts = { loss: number; atRisk: number; safe: number };

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
  additionalInfo?: string;
  // Only sent when the scheme has a charge.
  serviceChargeMode?: "WithheldFromPayout" | "AddedToPrincipal";
  // The saved draft this loan came from, so the server discards it now that a real loan exists.
  draftId?: number;
};
// Callable regardless of the loan's sanction stage; used by the Edit Loan sheet's per-ornament rows.
export type OrnamentRequestInput = {
  name: string;
  purity: string;
  grossWeight: number;
  deductionWeight?: number;
  quantity?: number;
  remarks?: string;
};

// Which sanction stages a loan walks is per-tenant config: chain starts at the first enabled
// stage, the last enabled stage disburses. Keys are role keys ("R<roleId>") or, for older loans,
// LoanOperator / BranchManager / FinalSanction.
export type SanctionStage = string;
// Ornaments themselves go through addOrnament/updateOrnament/deleteOrnament above, not through this.
export type UpdateLoanInput = { schemeId?: number; principalAmount?: number };

// Backend accepts gu only for businesses allowed Gujarati; it rejects otherwise.
export type BondLang = "en" | "ml" | "gu" | "ta";
// How the signing URL reaches the customer besides always being returned to the caller.
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
// Used for server-computed "interest"/"penal" charge rows not in the local payments/top-ups ledger.
// `kind` is open-ended — callers must ignore kinds they don't know.
export type LoanLedgerEntry = {
  key: string;
  kind: string;
  date: string;
  amount: number;
  balance: number | null;
  note?: string;
};

// A half-entered New Loan kept per employee.
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
