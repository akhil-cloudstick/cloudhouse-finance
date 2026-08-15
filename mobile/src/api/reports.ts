import { apiRequest } from "./client";

// Thin wrapper mirroring frontend/lib/reportsApi.ts's endpoints, backed by
// backend/internal/reports (handler.go/routes.go/model.go). Every JSON list
// endpoint shares the same request/response shape: common Filter query
// params in, {rows, totals, totalCount} out (reports.Result) — so one
// generic fetch helper + one function per endpoint is enough here too.

export type ReportFilters = {
  from?: string; // "YYYY-MM-DD"
  to?: string; // "YYYY-MM-DD"
  branchId?: number;
  page?: number;
  pageSize?: number;
  status?: string; // /reports/loans/status
  triggerType?: string; // /reports/communication-history
};

export type ReportResult<Row, Totals> = {
  rows: Row[];
  totals: Totals;
  totalCount: number;
};

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
    },
  });
}

/* ---- Row/Totals shapes (mirror backend/internal/reports/model.go). ---- */

export type DisbursementRow = {
  loanId: number; loanNumber: string; openedDate: string; amount: number;
  branchName: string; customerName: string; schemeName: string;
};
export type DisbursementTotals = { count: number; totalAmount: number };

export type LoanStatusRow = {
  loanId: number; loanNumber: string; customerName: string; branchName: string;
  status: string; outstanding: number; dueDate: string;
};
export type LoanStatusTotals = {
  active: number; closed: number; dueSoon: number; overdue: number; defaulted: number; other: number; count: number;
};

export type InterestCollectionRow = {
  loanId: number; loanNumber: string; paidOn: string; interestApplied: number; penalApplied: number; branchName: string;
};
export type InterestCollectionTotals = { totalInterest: number; totalPenal: number; total: number };

export type OutstandingPrincipalRow = { branchName: string; loanCount: number; outstanding: number };
export type OutstandingPrincipalTotals = { totalOutstanding: number; totalLoans: number };

export type PaymentCollectionRow = {
  paymentId: number; loanNumber: string; paidOn: string; amount: number; type: string; branchName: string; employeeName: string;
};
export type PaymentCollectionTotals = { totalAmount: number; count: number };

export type GoldWeightRow = {
  ornamentId: number; loanNumber: string; customerName: string; name: string; purity: string;
  grossWeight: number; netWeight: number; goldValue: number;
};
export type GoldWeightTotals = { totalGrossWeight: number; totalNetWeight: number; totalGoldValue: number };

export type PacketRow = {
  packetId: number; code: string; loanNumber: string; status: string; lockerCode?: string | null; movementCount: number;
};
export type PacketTotals = { count: number; inLocker: number; bankPledged: number; released: number };

export type BankPledgeRow = {
  recordId: number; loanNumber: string; bankName: string; pledgedAmount: number;
  pledgeDate: string; releaseDate?: string | null; status: string;
};
export type BankPledgeTotals = { outstandingLiability: number; count: number };

export type LoanExtensionRow = {
  requestId: number; loanNumber: string; requestedAt: string; months?: number | null; newDueDate?: string | null; status: string;
};
export type LoanExtensionTotals = { count: number };

export type GoldReleaseRow = {
  requestId: number; loanNumber: string; customerName: string; requestedAt: string; settlementAmount: number; status: string;
};
export type GoldReleaseTotals = { count: number; totalSettlement: number };

export type AuctionRow = {
  recordId: number; loanNumber: string; stage: string; auctionDate?: string | null; saleAmount: number; settlementStatus: string;
};
export type AuctionTotals = { count: number; totalSaleAmount: number };

export type ExpenseCashflowRow = {
  date: string; branchName: string; collections: number; disbursements: number; cashExpenses: number;
};
export type ExpenseCashflowTotals = {
  totalCollections: number; totalDisbursements: number; totalExpenses: number; netCashflow: number;
};

export type KYCRow = {
  customerId: number; code: string; name: string; phone: string; kycStatus: string; panStatus: string; aadhaarStatus: string;
};
export type KYCTotals = { count: number; verified: number; pending: number };

export type GoldRateHistoryRow = { date: string; k24: number; setBy: string };
export type GoldRateHistoryTotals = { count: number };

export type EmployeePerformanceRow = {
  employeeId: number; name: string; role: string; branchName: string;
  loansProcessed: number; collectionsAmount: number; remindersSent: number; approvals: number;
};
export type EmployeePerformanceTotals = { totalLoansProcessed: number; totalCollections: number };

export type CommunicationHistoryRow = {
  id: number; recipientName: string; recipientPhone: string; channel: string; triggerType: string; status: string; sentAt: string;
};
export type CommunicationHistoryTotals = { count: number; sent: number; failed: number };

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
