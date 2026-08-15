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

// backend/internal/loan/model.go's LoanApproval (266-284) — one row per
// decision at a sanction-chain stage.
export type LoanApproval = {
  id: number;
  loanId: number;
  stage: string; // SanctionStage* — "LoanOperator" | "BranchManager" | "AuthorizedManagement" | "FinalSanction"
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
  reference?: string;
  processingFeeApplied: number;
  penalInterestApplied: number;
  interestApplied: number;
  principalApplied: number;
  runningBalance: number;
  processingFee: number;
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
};

// backend/internal/loan/model.go's LoanRequest (523+) — Extension or Release.
export type LoanRequest = {
  id: number;
  loanId: number;
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
  settlementAmount: number;
  remarks?: string;
  requestedAt: string;
  decidedAt?: string | null;
  decidedByEmployeeId?: number | null;
  createdAt: string;
};

export type Loan = {
  id: number;
  loanNumber: string;
  branchId: number;
  customerId: number;
  customer?: { id: number; name: string; phone: string };
  status: string;
  openedDate: string;
  dueDate: string;
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
  bankPledgeStatus?: string;
  ornaments?: Ornament[];
  approvals?: LoanApproval[];
  payments?: LoanPayment[];
  bankPledges?: BankPledgeRecord[];
};
