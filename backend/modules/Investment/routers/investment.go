package routers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	investment "cloudhouse/backend/modules/Investment/controllers"

	"github.com/labstack/echo/v4"
)

var investmentPath = "/api/v1/users/:user_id/investments"

func InvestmentRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("investments")
	e.POST(investmentPath, investment.CreateInvestment, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Create)...)
	e.GET(investmentPath, investment.ListInvestments, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	e.GET(investmentPath+"/by-number/:number", investment.GetInvestmentByNumber, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	e.GET(investmentPath+"/:id", investment.GetInvestmentById, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	e.GET(investmentPath+"/:id/ledger", investment.GetInvestmentLedger, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	e.GET(investmentPath+"/:id/schedule", investment.GetInvestmentSchedule, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	e.GET(investmentPath+"/:id/bond/pdf", investment.DownloadInvestmentBond, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	e.GET(investmentPath+"/:id/statement/pdf", investment.DownloadInvestmentStatement, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read, perms.Export)...)
	e.POST(investmentPath+"/:id/payouts/:payout_id/pay", investment.PayInvestmentPayout, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Update)...)
	e.POST(investmentPath+"/:id/mature", investment.MatureInvestment, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Update)...)
	e.POST(investmentPath+"/:id/add-cash", investment.AddInvestmentCash, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Update)...)
	e.POST(investmentPath+"/:id/withdraw", investment.WithdrawInvestment, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Update)...)
	e.GET(investmentPath+"/:id/transactions", investment.ListInvestmentTransactions, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	return e
}

func InvestmentCustomerRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("investments")
	e.GET("/api/v1/users/:user_id/customers/:id/investments", investment.ListInvestmentsForCustomer, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	return e
}
