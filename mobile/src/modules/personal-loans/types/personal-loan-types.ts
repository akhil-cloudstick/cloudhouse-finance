

// Mirrors src/modules/personal-loans/services/personalLoanService.ts's
// types exactly (backend/internal/personalloan's models) — an unsecured,
// no-KYC loan product separate from the Gold Loan module.
export type InterestType = "Flat" | "Percentage";
export type Frequency = "Daily" | "Weekly" | "Monthly";
// "Pending Approval" / "Rejected" only when the tenant's "personal_loan"
// approval flow is on: nothing is disbursed (and there is no schedule) until
// its final stage approves the loan. "Pending" is unrelated — a penal-cycle
// state of an already-disbursed loan.
export type PersonalLoanStatus = "Active" | "Pending" | "Closed" | "Renewed" | "Defaulted" | "Pending Approval" | "Rejected";
export type PersonalLoan = {
  id: number;
  loanNumber: string;
  branchId: number;
  customerId: number;
  customer: { id: number; name: string; code: string; phone: string };
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  interestAmount: number;
  disbursedAmount: number;
  frequency: Frequency;
  tenureCount: number;
  installmentAmount: number;
  outstandingAmount: number;
  totalPaid: number;
  status: PersonalLoanStatus;
  // Pending stage value (personal_loan flow) while "Pending Approval";
  // "Approved" / "Rejected" once decided; "" when created without a chain.
  approvalStage?: string;
  openedDate: string;
  disbursedAt: string;
  closedAt: string | null;
  renewedFromLoanId: number | null;
  renewedToLoanId: number | null;
  penalInterestRate: number;
  penalFlatAmount: number;
  gracePeriodDays: number;
  penalCycleCount: number;
  totalPenalInterestCharged: number;
  lastPenalAppliedAt: string | null;
  createdAt: string;
};
export type PersonalLoanInstallment = {
  id: number;
  personalLoanId: number;
  sequenceNo: number;
  dueDate: string;
  amount: number;
  status: "Pending" | "Paid" | "PartiallyPaid";
  paidAmount: number;
};
export type PersonalLoanPayment = {
  id: number;
  personalLoanId: number;
  amount: number;
  paidOn: string;
  receivedByEmployeeId: number | null;
  method: string;
  reference: string;
  description: string;
  runningBalance: number;
  installmentId: number | null;
  createdAt: string;
};
export type CreatePersonalLoanInput = {
  branchId: number;
  customerId: number;
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
  // Omit or 0 to default to the loan's own effective interest rate — see
  // backend CreateInput.PenalInterestRate's doc comment.
  penalInterestRate?: number;
  // Omit or 0 for no grace period.
  gracePeriodDays?: number;
  // true: hand over the full principal now (no interest withheld upfront);
  // the customer then owes Principal + Interest. Default false.
  fullDisbursement?: boolean;
};
export type RenewInput = {
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
};
export type RenewalPreview = {
  rollover: number;
  interestAmount: number;
  disbursedAmount: number;
  shortfall: boolean;
};
export type RenewResult = { oldLoan: PersonalLoan; newLoan: PersonalLoan };
// --- Approval chain (tenant's "personal_loan" flow) ---------------------------

export type PersonalLoanApproval = {
  id: number;
  flow: string;
  entityId: number;
  stage: string;
  action: "Approved" | "Rejected";
  actorEmployeeId: number;
  actorRole: string;
  remarks: string;
  createdAt: string;
};

export type PersonalLoanBondLang = "en" | "ml";
