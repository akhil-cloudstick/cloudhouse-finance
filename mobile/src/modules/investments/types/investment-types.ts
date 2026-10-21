export type InterestRateType = "Simple" | "Compound";
export type PayoutFrequency = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly";
export type InvestmentStatus = "Active" | "Matured" | "Closed" | "Renewed";
export type PayoutStatus = "Pending" | "Paid";
export type InvestmentEngine = "Schedule" | "Live";
// Display/document-generation label, not a separate calculation engine.
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
  // Live-engine only; zero/unused under Schedule.
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
  cashAmount?: number;
  upiAmount?: number;
  bankTransferAmount?: number;
  chequeAmount?: number;
  bankId?: number;
};
// The split only needs to sum to the total; a single mode with the full amount is valid.
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
