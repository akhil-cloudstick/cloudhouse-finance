// Mirrors backend/internal/investment's JSON shapes / frontend/modules/
// src/modules/investments/services/investmentService.ts's BackendInvestment etc. —
// investor deposits, a separate product from borrower loans.
export type InterestRateType = "Simple" | "Compound";
export type PayoutFrequency = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly";
export type InvestmentStatus = "Active" | "Matured" | "Closed" | "Renewed";
export type PayoutStatus = "Pending" | "Paid";
export type InvestmentEngine = "Schedule" | "Live";
// Display/document-generation label, not a separate calculation engine —
// see backend/internal/investment/model_plan.go's ProductType* doc comment
// and frontend investmentService.ts's identical ProductType.
export type InvestmentProductType = "Deposit" | "Bond";

export type InvestmentPlan = {
  id: number;
  name: string;
  interestRateType: InterestRateType;
  interestRatePercent: number;
  payoutFrequency: PayoutFrequency;
  tenureMonths: number;
  minPrincipal: number;
  isActive: boolean;
  engine: InvestmentEngine;
  productType: InvestmentProductType;
};

export type Investment = {
  id: number;
  investmentNumber: string;
  branchId: number;
  customerId: number;
  customer: { id: number; name: string; code: string; phone: string };
  planId: number;
  plan: InvestmentPlan;
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
  engine: InvestmentEngine;
  // Live-engine only — running balance fields (zero/unused under Schedule).
  outstandingPrincipal: number;
  accruedInterest: number;
  interestWithdrawn: number;
  outstandingInterest: number;
  lastAccrualDate: string | null;
};

export type InvestmentTransactionType = "Deposit" | "Withdrawal";

export type InvestmentTransaction = {
  id: number;
  investmentId: number;
  type: InvestmentTransactionType;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  principalBefore: number;
  principalAfter: number;
  interestBefore: number;
  interestAfter: number;
  occurredOn: string;
  reference: string;
  createdAt: string;
};

export type InvestmentPayout = {
  id: number;
  investmentId: number;
  sequenceNo: number;
  dueDate: string;
  amount: number;
  isPrincipalReturn: boolean;
  status: PayoutStatus;
  paidAt: string | null;
};

export type CreateInvestmentInput = {
  branchId: number;
  customerId: number;
  planId: number;
  principalAmount: number;
  // How the investor's money reached the branch, and the bank account a UPI / Bank Transfer share landed in.
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
};
// The 4-field split (cash/upi/bankTransfer/cheque) only needs to sum to the
// total — a single mode with the full amount is a valid, first-class case
// (see platform.ValidateSplit/DeriveMethod), so mobile builds this from a
// plain ChipSelect mode picker rather than a full multi-mode split UI.
export type PaymentMode = "Cash" | "UPI" | "Bank Transfer" | "Cheque";
export type SplitAmounts = { cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number };
export type MaturityAction = "Close" | "Renew";
export type CreatePlanInput = {
  name: string;
  interestRateType: InvestmentPlan["interestRateType"];
  interestRatePercent: number;
  payoutFrequency: InvestmentPlan["payoutFrequency"];
  tenureMonths: number;
  minPrincipal: number;
  isActive: boolean;
  engine: InvestmentPlan["engine"];
  productType: InvestmentPlan["productType"];
};
