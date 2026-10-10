

export type InterestType = "Flat" | "Percentage";
export type Frequency = "Daily" | "Weekly" | "Monthly";
// "Pending Approval" = waiting in the business's personal_loan approval
// chain (nothing disbursed, no schedule yet); "Rejected" = turned down there.
export type PersonalLoanStatus = "Active" | "Pending" | "Closed" | "Renewed" | "Defaulted" | "Pending Approval" | "Rejected";
/* Mirrors backend/internal/personalloan/handler.go's createRequest exactly. */
export type CreatePersonalLoanInput = {
  branchId: number;
  customerId: number;
  principalAmount: number;
  interestType: InterestType;
  interestValue: number;
  frequency: Frequency;
  tenureCount: number;
  /* When true, disburses the full principal now with no interest withheld
   * upfront — the customer owes principal + the full interest back instead
   * of today's default (interest withheld upfront, principal-only
   * repayment). Defaults to false server-side when omitted. */
  fullDisbursement?: boolean;
  /* Omit or 0 to default to the loan's own effective interest rate — see
   * backend CreateInput.PenalInterestRate's doc comment. */
  penalInterestRate?: number;
  /* Omit or 0 for no grace period. */
  gracePeriodDays?: number;
  /* How the disbursed amount is handed over, and the bank account a UPI/Bank
   * Transfer/Cheque share leaves from. Omitted = all Cash. */
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
};
/* Mirrors backend/internal/personalloan/model_loan.go's PersonalLoan
 * exactly (only the fields the frontend needs). */
export type BackendPersonalLoan = {
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
  fullDisbursement: boolean;
  frequency: Frequency;
  tenureCount: number;
  installmentAmount: number;
  outstandingAmount: number;
  totalPaid: number;
  status: PersonalLoanStatus;
  // The pending stage value ("PendingBranchManager", …) while status is
  // "Pending Approval"; "Approved"/"Rejected" once decided; "" when created
  // with no approval chain.
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
/* Mirrors backend/internal/personalloan/model_installment.go's
 * PersonalLoanInstallment exactly. */
export type BackendPersonalLoanInstallment = {
  id: number;
  personalLoanId: number;
  sequenceNo: number;
  dueDate: string;
  amount: number;
  status: "Pending" | "Paid" | "PartiallyPaid";
  paidAmount: number;
};
/* Mirrors backend/internal/personalloan/model_payment.go's
 * PersonalLoanPayment exactly. */
export type BackendPersonalLoanPayment = {
  id: number;
  personalLoanId: number;
  amount: number;
  paidOn: string;
  receivedByEmployeeId: number | null;
  /* Derived/display-only — the single mode's name when exactly one split
   * amount below is non-zero, "Split" when more than one is. */
  method: string;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  reference: string;
  description: string;
  runningBalance: number;
  installmentId: number | null;
  // Which bank the UPI/Bank Transfer/Cheque portion landed in — see
  // backend PersonalLoanPayment.BankID's doc comment. Nil for a Cash-only
  // payment.
  bankId?: number | null;
  bankRef?: { id: number; name: string } | null;
  createdAt: string;

  // Ledger-row fields (backend/internal/personalloan/ledger.go): one row per
  // disbursement / charge / payment mode-share / rollover.
  key: string;
  kind: "disbursement" | "charge" | "penal" | "payment" | "rollover";
  date: string;
  refNo: string;
  particulars: string;
  mode: string;
  bankName?: string;
  debit: number;
  credit: number;
  balance: number;
};
/* One decision in the personal_loan approval chain — stage is the stage KEY
 * ("BranchManager"/"Management"); the final enabled stage disburses. The
 * acting employee/role come from the JWT. */
export type PersonalLoanApprovalInput = { stage: string; action: "Approved" | "Rejected"; remarks?: string };
/* Audit trail of the approval chain (backend workflow.ApprovalAction). */
export type PersonalLoanApprovalRecord = {
  flow: string;
  entityId: number;
  stage: string;
  action: string;
  actorEmployeeId: number;
  actorRole: string;
  remarks: string;
  createdAt: string;
};
/* Mirrors backend/internal/personalloan/model_history.go's
 * PersonalLoanHistory exactly. */
export type BackendPersonalLoanHistory = {
  id: number;
  personalLoanId: number;
  event: "loan_created" | "penal_applied" | "loan_renewed";
  detail: string;
  amount: number;
  relatedLoanId: number | null;
  occurredAt: string;
  createdAt: string;
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
export type RenewResult = { oldLoan: BackendPersonalLoan; newLoan: BackendPersonalLoan };
