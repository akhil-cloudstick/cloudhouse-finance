import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError } from "@/common/services/httpClient";
import { branchHeader } from "@/common/services/branchSelection";
import { printPdfJob } from "@/common/utils/print";
import type { InvestmentStatus, BackendInvestmentPlan, CreatePlanInput, BackendInvestment, BackendInvestmentTransaction, BackendInvestmentPayout, CreateInvestmentInput, InvestmentLedgerRow, MaturityAction, AddCashInput, WithdrawInput } from "@/modules/investments/types/investment-types";

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

/* Resolves "INV-00003" to its numeric id — lets a ledger reference link to
 * #investment/INV-00003 (see LedgerRefLink's "investment" kind). */
export async function resolveInvestmentNumber(number: string): Promise<number> {
  return (await apiFetch<{ id: number }>(`/investments/by-number/${encodeURIComponent(number)}`)).id;
}

export async function getInvestmentLedger(id: number): Promise<InvestmentLedgerRow[]> {
  return (await apiFetch<{ items: InvestmentLedgerRow[] | null }>(`/investments/${id}/ledger`)).items || [];
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
  split: { cashAmount: number; upiAmount: number; bankTransferAmount: number; chequeAmount: number },
  bankId?: number
): Promise<BackendInvestmentPayout> {
  return apiFetch<BackendInvestmentPayout>(`/investments/${investmentId}/payouts/${payoutId}/pay`, {
    method: "POST",
    body: JSON.stringify({ ...split, bankId }),
  });
}

export function matureInvestment(
  investmentId: number,
  input: { action: MaturityAction; planId?: number; principalAmount?: number }
): Promise<BackendInvestment> {
  return apiFetch<BackendInvestment>(`/investments/${investmentId}/mature`, { method: "POST", body: JSON.stringify(input) });
}

export function listInvestmentsForCustomer(customerId: number): Promise<BackendInvestment[]> {
  return apiFetch<BackendInvestment[]>(`/customers/${customerId}/investments`);
}

export function addCashToInvestment(investmentId: number, input: AddCashInput): Promise<BackendInvestment> {
  return apiFetch<BackendInvestment>(`/investments/${investmentId}/add-cash`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function withdrawFromInvestment(investmentId: number, input: WithdrawInput): Promise<BackendInvestment> {
  return apiFetch<BackendInvestment>(`/investments/${investmentId}/withdraw`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export const INVESTMENT_TRANSACTIONS_PAGE_SIZE = 20;

/* `page` is 0-based, mirrors getInvestmentSchedulePage. */
export function getInvestmentTransactionsPage(
  investmentId: number,
  page: number
): Promise<{ items: BackendInvestmentTransaction[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    limit: String(INVESTMENT_TRANSACTIONS_PAGE_SIZE),
    offset: String(page * INVESTMENT_TRANSACTIONS_PAGE_SIZE),
  });
  return apiFetch<{ items: BackendInvestmentTransaction[]; hasMore: boolean }>(`/investments/${investmentId}/transactions?${params}`);
}

/* Fetches a PDF blob at the given investment endpoint path — shared helper
 * behind fetchInvestmentBondPdf and fetchInvestmentStatementPdf below. */
async function fetchInvestmentPdf(investmentId: number, path: string): Promise<Blob> {
  const token = typeof window !== "undefined" ? getAuthToken() : null;
  const res = await apiRawFetch(`/investments/${investmentId}/${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body — fall back to statusText */
    }
    throw new ApiError(message, res.status);
  }
  return res.blob();
}

/* Fetches GET /investments/:id/bond/pdf as a blob — shared by
 * printInvestmentBondPdf and printInvestmentStatementPdf below (straight to
 * the print dialog), mirroring loanService.ts's downloadIndemnityBondPDF/
 * downloadReleaseAgreementPDF print flow. Available for every investment
 * regardless of ProductType. */
async function fetchInvestmentBondPdf(investmentId: number): Promise<Blob> {
  return fetchInvestmentPdf(investmentId, "bond/pdf");
}

/* Fetches GET /investments/:id/statement/pdf as a blob — the investor
 * account statement (terms + full transaction/payout history). */
async function fetchInvestmentStatementPdf(investmentId: number): Promise<Blob> {
  return fetchInvestmentPdf(investmentId, "statement/pdf");
}

/* Sends the Debenture Subscription Agreement straight to the browser's
 * print dialog — same printPdfBlob flow as loanService.ts's
 * downloadIndemnityBondPDF/downloadReleaseAgreementPDF. */
export async function printInvestmentBondPdf(investmentId: number): Promise<void> {
  return printPdfJob(() => fetchInvestmentBondPdf(investmentId));
}

/* Sends the investment's account statement straight to the browser's print
 * dialog — same printPdfBlob flow as printInvestmentBondPdf above. */
export async function printInvestmentStatementPdf(investmentId: number): Promise<void> {
  return printPdfJob(() => fetchInvestmentStatementPdf(investmentId));
}

