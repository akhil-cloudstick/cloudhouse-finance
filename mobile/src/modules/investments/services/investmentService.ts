import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Investment, InvestmentPlan, InvestmentTransaction, InvestmentPayout, InvestmentStatus, type CreateInvestmentInput, type PaymentMode, type SplitAmounts, type MaturityAction, type CreatePlanInput } from "@/modules/investments/types/investment-types";

export function listInvestmentPlans(activeOnly?: boolean) {
  return apiRequest<InvestmentPlan[]>("/investment-plans", { params: activeOnly ? { activeOnly: true } : undefined });
}

// Page-scoped list — same 0-based offset/{items,hasMore} convention as the
// rest of this app's mobile list screens (web's own listInvestmentsPage
// uses a 1-based `page` instead).
export function listInvestmentsPage(params: {
  q?: string;
  status?: InvestmentStatus;
  customerId?: number;
  limit: number;
  offset: number;
}) {
  return apiRequest<{ items: Investment[]; hasMore: boolean; total: number }>("/investments", { params });
}

export function getInvestment(id: number) {
  return apiRequest<Investment>(`/investments/${id}`);
}

export function createInvestment(input: CreateInvestmentInput) {
  return apiRequest<Investment>("/investments", { method: "POST", body: input });
}

export function getInvestmentSchedulePage(id: number, limit: number, offset: number) {
  return apiRequest<{ items: InvestmentPayout[]; hasMore: boolean }>(`/investments/${id}/schedule`, {
    params: { limit, offset },
  });
}

export function getInvestmentTransactionsPage(id: number, limit: number, offset: number) {
  return apiRequest<{ items: InvestmentTransaction[]; hasMore: boolean }>(`/investments/${id}/transactions`, {
    params: { limit, offset },
  });
}

export function splitForMode(mode: PaymentMode, amount: number): SplitAmounts {
  return {
    cashAmount: mode === "Cash" ? amount : 0,
    upiAmount: mode === "UPI" ? amount : 0,
    bankTransferAmount: mode === "Bank Transfer" ? amount : 0,
    chequeAmount: mode === "Cheque" ? amount : 0,
  };
}

export function addCashToInvestment(
  investmentId: number,
  input: { amount: number; occurredOn?: string; reference?: string; bankId?: number } & SplitAmounts
) {
  return apiRequest<Investment>(`/investments/${investmentId}/add-cash`, { method: "POST", body: input });
}

export function withdrawFromInvestment(
  investmentId: number,
  input: { interestAmount: number; principalAmount: number; occurredOn?: string; reference?: string; bankId?: number } & SplitAmounts
) {
  return apiRequest<Investment>(`/investments/${investmentId}/withdraw`, { method: "POST", body: input });
}

export function matureInvestment(
  investmentId: number,
  input: { action: MaturityAction; planId?: number; principalAmount?: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number }
) {
  return apiRequest<Investment>(`/investments/${investmentId}/mature`, { method: "POST", body: input });
}

export function markPayoutPaid(investmentId: number, payoutId: number, split: SplitAmounts, bankId?: number) {
  return apiRequest<InvestmentPayout>(`/investments/${investmentId}/payouts/${payoutId}/pay`, {
    method: "POST",
    body: { ...split, bankId },
  });
}

export function createInvestmentPlan(input: CreatePlanInput) {
  return apiRequest<InvestmentPlan>("/investment-plans", { method: "POST", body: input });
}

export function updateInvestmentPlan(id: number, input: CreatePlanInput) {
  return apiRequest<InvestmentPlan>(`/investment-plans/${id}`, { method: "PUT", body: input });
}

// Paged + searchable plan list (GET /investment-plans?limit=&offset=&q=) —
// opt-in pagination server-side returns {items, hasMore, total}. Used by the
// Investment Plans sheet (10 per page, `q` matches the plan name).
export function listInvestmentPlansPage(params: { q?: string; activeOnly?: boolean; limit: number; offset: number }) {
  return apiRequest<{ items: InvestmentPlan[] | null; hasMore: boolean; total?: number }>("/investment-plans", { params });
}

// The unpaid interest months of a scheduled investment, oldest first (web's getPendingInterest).
export function getPendingInterest(investmentId: number) {
  return apiRequest<{ items: InvestmentPayout[] | null }>(`/investments/${investmentId}/pending-interest`).then((r) => r.items ?? []);
}

// Pays several months of interest together: the amount is applied to the oldest unpaid months in order and the
// payment breakdown (mode split + bank) is spread over them. The amount must be a whole number of months.
export function payInterestMonths(
  investmentId: number,
  input: { amount: number; cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number; bankId?: number }
) {
  return apiRequest<{ items: InvestmentPayout[] | null }>(`/investments/${investmentId}/pay-interest`, { method: "POST", body: input }).then((r) => r.items ?? []);
}
