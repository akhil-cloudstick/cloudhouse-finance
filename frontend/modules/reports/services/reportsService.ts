import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken, ApiError } from "@/common/services/httpClient";
import { branchHeader } from "@/common/services/branchSelection";
import type { ReportFilters, ReportResult, DisbursementRow, DisbursementTotals, LoanStatusRow, LoanStatusTotals, PersonalLoanRow, PersonalLoanTotals, DepositRegisterRow, DepositRegisterTotals, InterestPayoutRegisterRow, InterestPayoutRegisterTotals, MaturityRegisterRow, MaturityRegisterTotals, InvestorLedgerRow, InvestorLedgerTotals, InterestCollectionRow, InterestCollectionTotals, OutstandingPrincipalRow, OutstandingPrincipalTotals, PaymentCollectionRow, PaymentCollectionTotals, GoldWeightRow, GoldWeightTotals, PacketRow, PacketTotals, BankPledgeRow, BankPledgeTotals, LoanExtensionRow, LoanExtensionTotals, GoldReleaseRow, GoldReleaseTotals, AuctionRow, AuctionTotals, ExpenseCashflowRow, ExpenseCashflowTotals, KYCRow, KYCTotals, GoldRateHistoryRow, GoldRateHistoryTotals, EmployeePerformanceRow, EmployeePerformanceTotals, CommunicationHistoryRow, CommunicationHistoryTotals, FormGStatement, FormGOverrides, BalanceSheetRow, BalanceSheetTotals, ProfitLossRow, ProfitLossTotals, ReportKey } from "@/modules/reports/types/reports-types";

function buildQuery(filters: ReportFilters): string {
  const qs = new URLSearchParams();
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.branchId) qs.set("branch_id", String(filters.branchId));
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.pageSize) qs.set("page_size", String(filters.pageSize));
  if (filters.status) qs.set("status", filters.status);
  if (filters.triggerType) qs.set("trigger_type", filters.triggerType);
  return qs.toString();
}

function fetchReport<Row, Totals>(path: string, filters: ReportFilters): Promise<ReportResult<Row, Totals>> {
  const qs = buildQuery(filters);
  return apiFetch<ReportResult<Row, Totals>>(`/reports/${path}${qs ? `?${qs}` : ""}`);
}

/* GET /reports/investments/investor-ledger?customer_id=X — every investment
 * belonging to one investor, for the "View Statement" action on
 * InvestmentDetail.tsx (frontend/modules/investments). Bypasses fetchReport
 * since it's keyed by customer, not a date range. */
export function getInvestorLedger(customerId: number): Promise<ReportResult<InvestorLedgerRow, InvestorLedgerTotals>> {
  return apiFetch<ReportResult<InvestorLedgerRow, InvestorLedgerTotals>>(`/reports/investments/investor-ledger?customer_id=${customerId}`);
}

export const getFormG = (f: ReportFilters): Promise<FormGStatement> => {
  const qs = buildQuery(f);
  return apiFetch<FormGStatement>(`/reports/form-g${qs ? `?${qs}` : ""}`);
};

function buildFormGOverridesQuery(o: FormGOverrides): URLSearchParams {
  const qs = new URLSearchParams();
  const set = (key: string, v?: number) => { if (v !== undefined && v !== null && v !== 0) qs.set(key, String(v)); };
  set("deposit_opening_count", o.depositOpeningCount);
  set("deposit_opening_amount", o.depositOpeningAmount);
  set("deposit_during_count", o.depositDuringCount);
  set("deposit_during_amount", o.depositDuringAmount);
  set("deposit_repaid_count", o.depositRepaidCount);
  set("deposit_repaid_amount", o.depositRepaidAmount);
  set("deposit_closing_count", o.depositClosingCount);
  set("deposit_closing_amount", o.depositClosingAmount);
  set("assets_value", o.assetsValue);
  set("liabilities_value", o.liabilitiesValue);
  return qs;
}

/* Downloads GET /reports/export/form-g?format=xlsx|pdf, folding the manual
 * overrides in as extra query params — mirrors exportReport below but
 * form-g needs the extra overrides on top of the shared filters. */
export async function exportFormG(format: "xlsx" | "pdf", filters: ReportFilters, overrides: FormGOverrides): Promise<void> {
  const { page: _page, pageSize: _pageSize, ...rest } = filters;
  const qs = buildQuery(rest);
  const params = new URLSearchParams(qs);
  params.set("format", format);
  const overrideParams = buildFormGOverridesQuery(overrides);
  overrideParams.forEach((v, k) => params.set(k, v));

  const token = typeof window !== "undefined" ? getAuthToken() : null;
  const res = await apiRawFetch(`/reports/export/form-g?${params.toString()}`, {
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

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `form-g.${format}`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/* ---- One function per report endpoint (path segments per routes.go). ---- */

export const getDisbursement = (f: ReportFilters) =>
  fetchReport<DisbursementRow, DisbursementTotals>("disbursement", f);

export const getLoansStatus = (f: ReportFilters) =>
  fetchReport<LoanStatusRow, LoanStatusTotals>("loans/status", f);

export const getInterestCollection = (f: ReportFilters) =>
  fetchReport<InterestCollectionRow, InterestCollectionTotals>("interest-collection", f);

export const getOutstandingPrincipal = (f: ReportFilters) =>
  fetchReport<OutstandingPrincipalRow, OutstandingPrincipalTotals>("outstanding-principal", f);

export const getPaymentCollection = (f: ReportFilters) =>
  fetchReport<PaymentCollectionRow, PaymentCollectionTotals>("payment-collection", f);

export const getGoldWeight = (f: ReportFilters) =>
  fetchReport<GoldWeightRow, GoldWeightTotals>("gold-weight", f);

export const getPackets = (f: ReportFilters) =>
  fetchReport<PacketRow, PacketTotals>("packets", f);

export const getBankPledge = (f: ReportFilters) =>
  fetchReport<BankPledgeRow, BankPledgeTotals>("bank-pledge", f);

export const getLoanExtensions = (f: ReportFilters) =>
  fetchReport<LoanExtensionRow, LoanExtensionTotals>("loan-extensions", f);

export const getGoldRelease = (f: ReportFilters) =>
  fetchReport<GoldReleaseRow, GoldReleaseTotals>("gold-release", f);

export const getAuctions = (f: ReportFilters) =>
  fetchReport<AuctionRow, AuctionTotals>("auctions", f);

export const getExpenseCashflow = (f: ReportFilters) =>
  fetchReport<ExpenseCashflowRow, ExpenseCashflowTotals>("expense-cashflow", f);

export const getKYC = (f: ReportFilters) =>
  fetchReport<KYCRow, KYCTotals>("kyc", f);

export const getGoldRateHistory = (f: ReportFilters) =>
  fetchReport<GoldRateHistoryRow, GoldRateHistoryTotals>("gold-rate-history", f);

export const getEmployeePerformance = (f: ReportFilters) =>
  fetchReport<EmployeePerformanceRow, EmployeePerformanceTotals>("employee-performance", f);

export const getCommunicationHistory = (f: ReportFilters) =>
  fetchReport<CommunicationHistoryRow, CommunicationHistoryTotals>("communication-history", f);

export const getPersonalLoans = (f: ReportFilters) =>
  fetchReport<PersonalLoanRow, PersonalLoanTotals>("personal-loans", f);

export const getDepositRegister = (f: ReportFilters) =>
  fetchReport<DepositRegisterRow, DepositRegisterTotals>("investments/deposit-register", f);

export const getInterestPayoutRegister = (f: ReportFilters) =>
  fetchReport<InterestPayoutRegisterRow, InterestPayoutRegisterTotals>("investments/interest-payout-register", f);

export const getMaturityRegister = (f: ReportFilters) =>
  fetchReport<MaturityRegisterRow, MaturityRegisterTotals>("investments/maturity-register", f);

export const getBalanceSheet = (f: ReportFilters) =>
  fetchReport<BalanceSheetRow, BalanceSheetTotals>("balance-sheet", f);

export const getProfitAndLoss = (f: ReportFilters) =>
  fetchReport<ProfitLossRow, ProfitLossTotals>("profit-loss", f);

/* Downloads GET /reports/export/:key?format=xlsx|pdf as a blob and triggers
 * a browser save, matching the object-URL + anchor-click pattern used for
 * other binary downloads in this app. Exports always fetch the full
 * (unpaginated) filtered result server-side, so page/pageSize are omitted
 * even if present on the passed-in filters. */
export async function exportReport(key: ReportKey, format: "xlsx" | "pdf", filters: ReportFilters): Promise<void> {
  const { page: _page, pageSize: _pageSize, ...rest } = filters;
  const qs = buildQuery(rest);
  const params = new URLSearchParams(qs);
  params.set("format", format);

  const token = getAuthToken();
  const res = await apiRawFetch(`/reports/export/${key}?${params.toString()}`, {
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

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `${key}.${format}`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
