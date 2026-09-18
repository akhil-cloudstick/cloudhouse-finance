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
  // CashMovement.transactionGroupId in types/cash.ts.
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
  // voidBankPledge() cancelled a mis-recorded pledge (see api/bankPledges.ts).
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
  // services/loanService.ts's RequestView flattening).
  loan?: Loan;
  type: "Extension" | "Release";
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: string;
  detail?: string;
  requestedExtensionMonths?: number | null;
  newDueDate?: string | null;
  approvalStage?: string; // Release only — "PendingManager" | "PendingManagement" | "Approved" | "Rejected"
  paymentVerified: boolean;
  packetVerified: boolean;
  bankPledgeVerified: boolean;
  customerConfirmed: boolean;
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
export type AuctionRecord = {
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
export type CustomerAuctionRow = AuctionRecord & { loanNumber: string };

export type Loan = {
  id: number;
  loanNumber: string;
  branchId: number;
  branch?: { id: number; name: string };
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
  // see api/loans.ts's startIndemnityBondEsign/checkIndemnityBondEsign).
  // Mirrors Setu's own SignatureStatus.Status verbatim: "" (never started),
  // "sign_initiated", "sign_complete", or "failed".
  indemnityBondSignStatus?: string;
  indemnityBondSignedUrl?: string;
};
