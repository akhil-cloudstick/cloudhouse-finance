

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
  q?: string; // free-text search (sent as `q`)
};
export type ReportResult<Row, Totals> = {
  rows: Row[];
  totals: Totals;
  totalCount: number;
};
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
/* ---- Reports added after the original 16 (web parity with
 * src/modules/reports/services/reportsService.ts). ---- */

export type PersonalLoanRow = {
  loanId: number; loanNumber: string; openedDate: string; customerName: string; branchName: string;
  frequency: string; principalAmount: number; disbursedAmount: number; outstandingAmount: number; status: string;
};
export type PersonalLoanTotals = {
  count: number; totalPrincipal: number; totalDisbursed: number; totalOutstanding: number;
};
export type DepositRegisterRow = {
  investmentId: number; investmentNumber: string; customerName: string; planName: string;
  principalAmount: number; interestRate: number; startDate: string; maturityDate: string;
  branchName: string; status: string;
};
export type DepositRegisterTotals = { count: number; totalPrincipal: number };
export type InterestPayoutRegisterRow = {
  investmentId: number; investmentNumber: string; customerName: string; sequenceNo: number;
  dueDate: string; amount: number; status: string; paidAt: string | null;
};
export type InterestPayoutRegisterTotals = { count: number; totalDue: number; totalPaid: number; totalPending: number };
export type MaturityRegisterRow = {
  investmentId: number; investmentNumber: string; customerName: string; branchName: string;
  principalAmount: number; maturityDate: string; status: string;
};
export type MaturityRegisterTotals = { active: number; matured: number; closed: number; renewed: number; count: number };
/* Balance Sheet / P&L print one row per statement line (Ind AS Division
 * III) — label carries its "I."/"(1)"/"(a)" prefix; style/indent are
 * display hints only. */
export type StatementStyle = "" | "header" | "total";
export type StatementRow = { label: string; amount: number; style: StatementStyle; indent: number };
export type BalanceSheetTotals = { totalAssets: number; totalLiabilities: number; totalEquity: number };
export type ProfitLossTotals = { totalIncome: number; totalExpenses: number; profitForPeriod: number };
/* Form G (Kerala Money-Lenders Rules 1964, Rule 15(3)) — a single
 * fixed-layout statement, not {rows, totals}; see
 * backend/internal/reports/formg.go. */
export type FormGLoanCategory = { label: string; persons: number; amount: number; remarks: string };
export type FormGStatement = {
  periodLabel: string;
  lenderName: string;
  lenderAddress: string;
  branches: { name: string; address: string }[];
  section1Advanced: FormGLoanCategory[];
  section2Redeemed: FormGLoanCategory[];
  section3Deposits: {
    openingCount: number; openingAmount: number;
    duringCount: number; duringAmount: number;
    repaidCount: number; repaidAmount: number;
    closingCount: number; closingAmount: number;
  };
  section4FinancialPosition: {
    maxOutstanding: number;
    maxOutstandingDate?: string | null;
    assetsValue: number;
    liabilitiesValue: number;
    excessAssetsOverLiabilities: number;
    excessLiabilitiesOverAssets: number;
  };
};
