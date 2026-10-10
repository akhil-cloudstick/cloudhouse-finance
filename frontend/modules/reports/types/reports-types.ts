

/* Frontend service for backend/internal/reports (see handler.go/routes.go/
 * export.go). Every JSON list endpoint shares the same request/response
 * shape: common Filter query params in, {rows, totals, totalCount} out
 * (reports.Result) — so one generic fetch helper + one function per
 * endpoint is enough, rather than hand-rolling 16 near-identical bodies. */

export type ReportFilters = {
  from?: string; // "YYYY-MM-DD"
  to?: string; // "YYYY-MM-DD"
  branchId?: number;
  page?: number;
  pageSize?: number;
  // Per-report extra filters.
  status?: string; // /reports/loans/status
  triggerType?: string; // /reports/communication-history
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
export type PersonalLoanRow = {
  loanId: number; loanNumber: string; openedDate: string; customerName: string; branchName: string;
  frequency: string; principalAmount: number; disbursedAmount: number; outstandingAmount: number; status: string;
};
export type PersonalLoanTotals = {
  count: number; totalPrincipal: number; totalDisbursed: number; totalOutstanding: number;
};
/* ---- Investment reports (internal/investment) ---- */

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
/* InvestorLedgerRow/Totals mirror backend/internal/reports/model.go's
 * InvestorLedgerRow/InvestorLedgerTotals — a single-investor statement
 * (every investment for one customer), not a date-scoped register, so it
 * doesn't go through fetchReport/ReportFilters like the three registers
 * above. See getInvestorLedger below. */
export type InvestorLedgerRow = {
  investmentId: number; investmentNumber: string; planName: string; principalAmount: number;
  totalInterestPaid: number; startDate: string; maturityDate: string; status: string;
};
export type InvestorLedgerTotals = { count: number; totalPrincipal: number; totalInterestPaid: number };
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
/* ---- Form G (Kerala Money-Lenders Rules 1964, Rule 15(3)) ----
 * Not a repeated-row report — a single fixed-layout statement — so it does
 * not use ReportResult<Row,Totals>/fetchReport like every report above; see
 * backend/internal/reports/formg.go for the full field-by-field rationale. */

export type FormGBranch = { name: string; address: string };
export type FormGLoanCategory = { label: string; persons: number; amount: number; remarks: string };
export type FormGDeposits = {
  openingCount: number; openingAmount: number;
  duringCount: number; duringAmount: number;
  repaidCount: number; repaidAmount: number;
  closingCount: number; closingAmount: number;
};
export type FormGFinancialPosition = {
  maxOutstanding: number;
  maxOutstandingDate?: string | null;
  assetsValue: number;
  liabilitiesValue: number;
  excessAssetsOverLiabilities: number;
  excessLiabilitiesOverAssets: number;
};
export type FormGStatement = {
  periodLabel: string;
  lenderName: string;
  lenderAddress: string;
  branches: FormGBranch[];
  section1Advanced: FormGLoanCategory[];
  section2Redeemed: FormGLoanCategory[];
  section3Deposits: FormGDeposits;
  section4FinancialPosition: FormGFinancialPosition;
};
/* Manual overrides for the figures this system has no ledger for (public
 * deposits, balance-sheet assets/liabilities) — sent ONLY on export, never
 * persisted; see backend/internal/reports/formg.go's FormGOverrides
 * doc comment for the full mechanism this mirrors. */
export type FormGOverrides = {
  depositOpeningCount?: number; depositOpeningAmount?: number;
  depositDuringCount?: number; depositDuringAmount?: number;
  depositRepaidCount?: number; depositRepaidAmount?: number;
  depositClosingCount?: number; depositClosingAmount?: number;
  assetsValue?: number;
  liabilitiesValue?: number;
};
/* Both statements print one row per line the way a real Ind AS Division
 * III (NBFC) statement lays it out — Label already carries the "I."/"(1)"/
 * "(a)" prefix verbatim; style/indent are display hints only. */
export type StatementStyle = "" | "header" | "total";
export type BalanceSheetRow = { label: string; amount: number; style: StatementStyle; indent: number };
export type BalanceSheetTotals = { totalAssets: number; totalLiabilities: number; totalEquity: number };
export type ProfitLossRow = { label: string; amount: number; style: StatementStyle; indent: number };
export type ProfitLossTotals = { totalIncome: number; totalExpenses: number; profitForPeriod: number };
/* Report export keys, matching backend/internal/reports/export.go's
 * reportRows switch exactly (note "loans/status" list path vs
 * "loans-status" export key — the export key list is a *different* set of
 * strings from the list-endpoint path segments). */
export type ReportKey =
  | "disbursement" | "personal-loans" | "loans-status" | "interest-collection" | "outstanding-principal"
  | "payment-collection" | "gold-weight" | "packets" | "bank-pledge" | "loan-extensions"
  | "gold-release" | "auctions" | "expense-cashflow" | "kyc" | "gold-rate-history"
  | "employee-performance" | "communication-history" | "balance-sheet" | "profit-loss" | "form-g"
  | "investments-deposit-register" | "investments-interest-payout-register" | "investments-maturity-register";
