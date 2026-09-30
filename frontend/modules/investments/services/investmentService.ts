import { apiFetchEnveloped as apiFetch, API_BASE, getAuthToken, ApiError } from "@/common/services/httpClient";
import type { SplitAmounts } from "@/common/components/ui/SplitPaymentInput";
import { printPdfBlob } from "@/common/utils/print";

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

/* Resolves "INV-00003" to its numeric id — lets a ledger reference link to
 * #investment/INV-00003 (see LedgerRefLink's "investment" kind). */
export async function resolveInvestmentNumber(number: string): Promise<number> {
  return (await apiFetch<{ id: number }>(`/investments/by-number/${encodeURIComponent(number)}`)).id;
}

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

/* --- Live engine: Add Cash / Withdraw / Transactions --- */

export type AddCashInput = SplitAmounts & {
  amount: number;
  occurredOn?: string; // RFC3339, optional — defaults to now on the backend
  reference?: string;
};

export function addCashToInvestment(investmentId: number, input: AddCashInput): Promise<BackendInvestment> {
  return apiFetch<BackendInvestment>(`/investments/${investmentId}/add-cash`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type WithdrawInput = SplitAmounts & {
  /* Either can be 0 — this pair IS the "withdraw from Interest / Principal /
   * Both" choice; see BackendInvestmentTransaction's doc comment. */
  interestAmount: number;
  principalAmount: number;
  occurredOn?: string;
  reference?: string;
};

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
  const res = await fetch(`${API_BASE}/investments/${investmentId}/${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  const blob = await fetchInvestmentBondPdf(investmentId);
  printPdfBlob(blob);
}

/* Sends the investment's account statement straight to the browser's print
 * dialog — same printPdfBlob flow as printInvestmentBondPdf above. */
export async function printInvestmentStatementPdf(investmentId: number): Promise<void> {
  const blob = await fetchInvestmentStatementPdf(investmentId);
  printPdfBlob(blob);
}

