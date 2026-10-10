package routers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	reports "cloudhouse/backend/modules/Reports/controllers"

	"github.com/labstack/echo/v4"
)

var reportPath = "/api/v1/users/:user_id/reports"

func ReportRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("reports")
	e.GET(reportPath+"/disbursement", reports.DisbursementReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/personal-loans", reports.PersonalLoansReport, auth.Staff(perms.Read, auth.RequireTenantModule(commonModels.ModulePersonalLoans))...)
	e.GET(reportPath+"/loans/status", reports.LoansStatusReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/interest-collection", reports.InterestCollectionReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/outstanding-principal", reports.OutstandingPrincipalReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/payment-collection", reports.PaymentCollectionReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/gold-weight", reports.GoldWeightReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/packets", reports.PacketsReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/bank-pledge", reports.BankPledgeReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/loan-extensions", reports.LoanExtensionsReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/gold-release", reports.GoldReleaseReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/auctions", reports.AuctionsReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/expense-cashflow", reports.ExpenseCashflowReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/kyc", reports.KYCReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/gold-rate-history", reports.GoldRateHistoryReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/employee-performance", reports.EmployeePerformanceReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/communication-history", reports.CommunicationHistoryReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/form-g", reports.FormGReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/investments/deposit-register", reports.DepositRegisterReport, auth.Staff(perms.Read, auth.RequireTenantModule(commonModels.ModuleInvestments))...)
	e.GET(reportPath+"/investments/interest-payout-register", reports.InterestPayoutRegisterReport, auth.Staff(perms.Read, auth.RequireTenantModule(commonModels.ModuleInvestments))...)
	e.GET(reportPath+"/investments/maturity-register", reports.MaturityRegisterReport, auth.Staff(perms.Read, auth.RequireTenantModule(commonModels.ModuleInvestments))...)
	e.GET(reportPath+"/investments/investor-ledger", reports.InvestorLedgerReport, auth.Staff(perms.Read, auth.RequireTenantModule(commonModels.ModuleInvestments))...)
	e.GET(reportPath+"/balance-sheet", reports.BalanceSheetReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/profit-loss", reports.ProfitAndLossReport, auth.Staff(perms.Read)...)
	e.GET(reportPath+"/export/:key", reports.ExportReport, auth.Staff(perms.Read, auth.RequireReportExportModule())...)
	return e
}
