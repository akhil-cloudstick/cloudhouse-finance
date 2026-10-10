import { apiRequestEnveloped as apiRequest, API_BASE_URL, apiUrl } from "@/common/services/httpClient";
import type { ReportFilters, ReportResult, DisbursementRow, DisbursementTotals, LoanStatusRow, LoanStatusTotals, InterestCollectionRow, InterestCollectionTotals, OutstandingPrincipalRow, OutstandingPrincipalTotals, PaymentCollectionRow, PaymentCollectionTotals, GoldWeightRow, GoldWeightTotals, PacketRow, PacketTotals, BankPledgeRow, BankPledgeTotals, LoanExtensionRow, LoanExtensionTotals, GoldReleaseRow, GoldReleaseTotals, AuctionRow, AuctionTotals, ExpenseCashflowRow, ExpenseCashflowTotals, KYCRow, KYCTotals, GoldRateHistoryRow, GoldRateHistoryTotals, EmployeePerformanceRow, EmployeePerformanceTotals, CommunicationHistoryRow, CommunicationHistoryTotals, PersonalLoanRow, PersonalLoanTotals, DepositRegisterRow, DepositRegisterTotals, InterestPayoutRegisterRow, InterestPayoutRegisterTotals, MaturityRegisterRow, MaturityRegisterTotals, StatementRow, BalanceSheetTotals, ProfitLossTotals, FormGStatement } from "@/modules/reports/types/reports-types";

function fetchReport<Row, Totals>(path: string, filters: ReportFilters) {
  return apiRequest<ReportResult<Row, Totals>>(`/reports/${path}`, {
    params: {
      from: filters.from,
      to: filters.to,
      branch_id: filters.branchId,
      page: filters.page,
      page_size: filters.pageSize,
      status: filters.status,
      trigger_type: filters.triggerType,
      q: filters.q,
    },
  });
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
  fetchReport<StatementRow, BalanceSheetTotals>("balance-sheet", f);

export const getProfitAndLoss = (f: ReportFilters) =>
  fetchReport<StatementRow, ProfitLossTotals>("profit-loss", f);

export const getFormG = (f: ReportFilters) =>
  apiRequest<FormGStatement>("/reports/form-g", {
    params: { from: f.from, to: f.to, branch_id: f.branchId },
  });

// A report export (xlsx/pdf), downloaded straight to a file rather than through apiRequest.
export function reportExportUrl(key: string, query: URLSearchParams): string {
  return apiUrl(`/reports/export/${key}?${query.toString()}`);
}
