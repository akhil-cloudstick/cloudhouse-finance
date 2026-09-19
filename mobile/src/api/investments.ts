import { apiRequestEnveloped as apiRequest } from "./client";
import { Investment, InvestmentPlan, InvestmentTransaction, InvestmentPayout, InvestmentStatus } from "../types/investment";

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

export type CreateInvestmentInput = {
  branchId: number;
  customerId: number;
  planId: number;
  principalAmount: number;
};

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

// The 4-field split (cash/upi/bankTransfer/cheque) only needs to sum to the
// total — a single mode with the full amount is a valid, first-class case
// (see platform.ValidateSplit/DeriveMethod), so mobile builds this from a
// plain ChipSelect mode picker rather than a full multi-mode split UI.
export type PaymentMode = "Cash" | "UPI" | "Bank Transfer" | "Cheque";
export type SplitAmounts = { cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number };

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
  input: { amount: number; occurredOn?: string; reference?: string } & SplitAmounts
) {
  return apiRequest<Investment>(`/investments/${investmentId}/add-cash`, { method: "POST", body: input });
}

export function withdrawFromInvestment(
  investmentId: number,
  input: { interestAmount: number; principalAmount: number; occurredOn?: string; reference?: string } & SplitAmounts
) {
  return apiRequest<Investment>(`/investments/${investmentId}/withdraw`, { method: "POST", body: input });
}

export type MaturityAction = "Close" | "Renew";

export function matureInvestment(
  investmentId: number,
  input: { action: MaturityAction; planId?: number; principalAmount?: number }
) {
  return apiRequest<Investment>(`/investments/${investmentId}/mature`, { method: "POST", body: input });
}

export function markPayoutPaid(investmentId: number, payoutId: number, split: SplitAmounts) {
  return apiRequest<InvestmentPayout>(`/investments/${investmentId}/payouts/${payoutId}/pay`, {
    method: "POST",
    body: split,
  });
}

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

export function createInvestmentPlan(input: CreatePlanInput) {
  return apiRequest<InvestmentPlan>("/investment-plans", { method: "POST", body: input });
}

export function updateInvestmentPlan(id: number, input: CreatePlanInput) {
  return apiRequest<InvestmentPlan>(`/investment-plans/${id}`, { method: "PUT", body: input });
}
