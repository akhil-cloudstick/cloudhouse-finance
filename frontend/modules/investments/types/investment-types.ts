import type { SplitAmounts } from "@/common/components/SplitPaymentInput";

export type InterestRateType = "Simple" | "Compound";
/* Daily/Weekly/Quarterly only apply to Engine "Live" plans/investments —
 * see backend/internal/investment/model_plan.go's PayoutFrequency* doc
 * comment. A "Schedule" (legacy) plan/investment stays restricted to
 * Monthly/Yearly. */
export type PayoutFrequency = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly";
export type InvestmentStatus = "Active" | "Matured" | "Closed" | "Renewed";
export type PayoutStatus = "Pending" | "Paid";
/* Engine is the discriminator between the original precomputed-schedule
 * product ("Schedule") and the new running-balance product ("Live") — see
 * backend/internal/investment/model_plan.go's Engine* doc comment.
 * Snapshotted from Plan onto Investment at creation time. */
export type Engine = "Schedule" | "Live";
// ProductType is a display/document-generation label, NOT a separate
// calculation engine — a Bond plan uses the exact same Engine/rate/
// frequency/tenure math as a Deposit plan, it's just branded and worded as
// a bond, and generates a Debenture Subscription Agreement PDF (see
// investmentService.ts's printInvestmentBondPdf below) that a Deposit
// plan doesn't. See backend/internal/investment/model_plan.go's
// ProductType* doc comment.
export type ProductType = "Deposit" | "Bond";
/* Mirrors backend/internal/investment/model_plan.go's InvestmentPlan
 * exactly (only the fields the frontend needs). */
export type BackendInvestmentPlan = {
  id: number;
  name: string;
  interestRateType: InterestRateType;
  interestRatePercent: number;
  payoutFrequency: PayoutFrequency;
  tenureMonths: number;
  minPrincipal: number;
  isActive: boolean;
  engine: Engine;
  productType: ProductType;
};
export type CreatePlanInput = {
  name: string;
  interestRateType: InterestRateType;
  interestRatePercent: number;
  payoutFrequency: PayoutFrequency;
  tenureMonths: number;
  minPrincipal: number;
  isActive: boolean;
  engine: Engine;
  productType: ProductType;
};
/* Mirrors backend/internal/investment/model_investment.go's Investment
 * exactly (only the fields the frontend needs). */
export type BackendInvestment = {
  id: number;
  investmentNumber: string;
  branchId: number;
  customerId: number;
  customer: { id: number; name: string; code: string; phone: string };
  planId: number;
  plan: BackendInvestmentPlan;
  principalAmount: number;
  interestRateType: InterestRateType;
  interestRatePercent: number;
  payoutFrequency: PayoutFrequency;
  tenureMonths: number;
  startDate: string;
  maturityDate: string;
  status: InvestmentStatus;
  totalInterestPaid: number;
  closedAt: string | null;
  renewedFromInvestmentId: number | null;
  renewedToInvestmentId: number | null;
  createdAt: string;

  engine: Engine;
  /* Meaningful only when engine === "Live" — see model_investment.go's
   * field doc comments. Zero/absent for a "Schedule" investment. */
  outstandingPrincipal: number;
  accruedInterest: number;
  interestWithdrawn: number;
  outstandingInterest: number;
  lastAccrualDate: string | null;
};
/* One append-only ledger row (Add Cash deposit, or Withdraw of Interest/
 * Principal/Both) against an Engine "Live" investment — mirrors
 * backend/internal/investment/model_transaction.go's InvestmentTransaction.
 * This is the Live-engine replacement for BackendInvestmentPayout's
 * precomputed schedule row. */
export type InvestmentTransactionType = "Deposit" | "Withdrawal";
export type BackendInvestmentTransaction = {
  id: number;
  investmentId: number;
  type: InvestmentTransactionType;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  principalBefore: number;
  principalAfter: number;
  interestBefore: number;
  interestAfter: number;
  occurredOn: string;
  recordedByEmployeeId: number | null;
  reference: string;
  cashMovementId: number | null;
  createdAt: string;
};
/* Mirrors backend/internal/investment/model_payout.go's InvestmentPayout
 * exactly. */
export type BackendInvestmentPayout = {
  id: number;
  investmentId: number;
  sequenceNo: number;
  dueDate: string;
  amount: number;
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
  isPrincipalReturn: boolean;
  status: PayoutStatus;
  paidAt: string | null;
  paidByEmployeeId: number | null;
};
export type CreateInvestmentInput = {
  branchId: number;
  customerId: number;
  planId: number;
  principalAmount: number;
  startDate?: string; // RFC3339, optional — defaults to now on the backend
  /* How the investor paid the deposit, and the bank account a UPI/Bank
   * Transfer/Cheque share landed in. Omitted = all Cash. */
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
};
/* One row of GET /investments/:id/ledger — deposit = credit (money in),
 * payout/withdrawal = debit; runningBalance is the principal still owed to
 * the investor after the row. Oldest first. */
export type InvestmentLedgerRow = {
  id: string;
  date: string;
  description: string;
  type: string;
  method: string;
  reference: string;
  debitOrCredit: "debit" | "credit";
  amount: number;
  principalAmount: number;
  interestAmount: number;
  runningBalance: number;
};
export type MaturityAction = "Close" | "Renew";
/* --- Live engine: Add Cash / Withdraw / Transactions --- */

export type AddCashInput = SplitAmounts & {
  amount: number;
  occurredOn?: string; // RFC3339, optional — defaults to now on the backend
  reference?: string;
  /* Branch bank account a UPI/Bank Transfer/Cheque share landed in. */
  bankId?: number;
};
export type WithdrawInput = SplitAmounts & {
  /* Either can be 0 — this pair IS the "withdraw from Interest / Principal /
   * Both" choice; see BackendInvestmentTransaction's doc comment. */
  interestAmount: number;
  principalAmount: number;
  occurredOn?: string;
  reference?: string;
  /* Branch bank account a UPI/Bank Transfer/Cheque share leaves from. */
  bankId?: number;
};
