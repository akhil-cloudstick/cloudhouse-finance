import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";

export type InterestRateType = "Simple" | "Compound";
export type PayoutFrequency = "Monthly" | "Yearly";
export type InvestmentStatus = "Active" | "Matured" | "Closed" | "Renewed";
export type PayoutStatus = "Pending" | "Paid";

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
};

export type CreatePlanInput = {
  name: string;
  interestRateType: InterestRateType;
  interestRatePercent: number;
  payoutFrequency: PayoutFrequency;
  tenureMonths: number;
  minPrincipal: number;
  isActive: boolean;
};

export function createInvestmentPlan(input: CreatePlanInput): Promise<BackendInvestmentPlan> {
  return apiFetch<BackendInvestmentPlan>("/investment-plans", { method: "POST", body: JSON.stringify(input) });
}

export function updateInvestmentPlan(id: number, input: CreatePlanInput): Promise<BackendInvestmentPlan> {
  return apiFetch<BackendInvestmentPlan>(`/investment-plans/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/* activeOnly=true is what the New Investment picker uses (only plans still
 * open for new money) — the plan admin screen passes false to also show
 * retired plans, since existing investments still reference them. */
export function listInvestmentPlans(activeOnly?: boolean): Promise<BackendInvestmentPlan[]> {
  const qs = activeOnly ? "?activeOnly=true" : "";
  return apiFetch<BackendInvestmentPlan[]>(`/investment-plans${qs}`);
}

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
};

export function createInvestment(input: CreateInvestmentInput): Promise<BackendInvestment> {
  return apiFetch<BackendInvestment>("/investments", { method: "POST", body: JSON.stringify(input) });
}

export const INVESTMENTS_TABLE_PAGE_SIZE = 10;

/* Paginated, searched, filtered list — backs the Investments list page.
 * `page` is 1-based; the backend responds with an {items, hasMore, total}
 * envelope (see backend/internal/investment/handler.go's List) — mirrors
 * personalLoanService.ts's listPersonalLoansPage exactly. */
export function listInvestmentsPage(params: {
  page: number;
  q?: string;
  status?: InvestmentStatus | "All";
  customerId?: number;
  pageSize?: number;
}): Promise<{ items: BackendInvestment[]; hasMore: boolean; total: number }> {
  const pageSize = params.pageSize || INVESTMENTS_TABLE_PAGE_SIZE;
  const query = new URLSearchParams({
    limit: String(pageSize),
    offset: String((params.page - 1) * pageSize),
  });
  if (params.q) query.set("q", params.q);
  if (params.status && params.status !== "All") query.set("status", params.status);
  if (params.customerId) query.set("customerId", String(params.customerId));
  return apiFetch<{ items: BackendInvestment[]; hasMore: boolean; total: number }>(`/investments?${query}`);
}

export function getInvestment(id: number): Promise<BackendInvestment> {
  return apiFetch<BackendInvestment>(`/investments/${id}`);
}

export const INVESTMENT_PAGE_SIZE = 20;

/* Unpaginated in practice (limit 20 comfortably covers a Monthly/12mo or
 * Yearly/multi-year schedule) — backs InvestmentDetail's schedule table.
 * `page` is 0-based, mirrors getPersonalLoanSchedulePage. */
export function getInvestmentSchedulePage(id: number, page: number): Promise<{ items: BackendInvestmentPayout[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(INVESTMENT_PAGE_SIZE), offset: String(page * INVESTMENT_PAGE_SIZE) });
  return apiFetch<{ items: BackendInvestmentPayout[]; hasMore: boolean }>(`/investments/${id}/schedule?${params}`);
}

export function markPayoutPaid(
  investmentId: number,
  payoutId: number,
  split: { cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number }
): Promise<BackendInvestmentPayout> {
  return apiFetch<BackendInvestmentPayout>(`/investments/${investmentId}/payouts/${payoutId}/pay`, {
    method: "POST",
    body: JSON.stringify(split),
  });
}

export type MaturityAction = "Close" | "Renew";

export function matureInvestment(
  investmentId: number,
  input: { action: MaturityAction; planId?: number; principalAmount?: number }
): Promise<BackendInvestment> {
  return apiFetch<BackendInvestment>(`/investments/${investmentId}/mature`, { method: "POST", body: JSON.stringify(input) });
}

export function listInvestmentsForCustomer(customerId: number): Promise<BackendInvestment[]> {
  return apiFetch<BackendInvestment[]>(`/customers/${customerId}/investments`);
}
