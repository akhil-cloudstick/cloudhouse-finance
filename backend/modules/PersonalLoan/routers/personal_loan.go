package routers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	personalLoan "cloudhouse/backend/modules/PersonalLoan/controllers"

	"github.com/labstack/echo/v4"
)

var personalLoanPath = "/api/v1/users/:user_id/personal-loans"

func PersonalLoanRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("personalloans")
	e.POST(personalLoanPath, personalLoan.CreatePersonalLoan, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Create)...)
	e.GET(personalLoanPath, personalLoan.ListPersonalLoans, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	e.GET(personalLoanPath+"/by-number/:number", personalLoan.GetPersonalLoanByNumber, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	e.GET(personalLoanPath+"/:id", personalLoan.GetPersonalLoanById, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	e.GET(personalLoanPath+"/:id/schedule", personalLoan.GetPersonalLoanSchedule, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	e.GET(personalLoanPath+"/:id/payments", personalLoan.ListPersonalLoanPayments, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	e.GET(personalLoanPath+"/:id/history", personalLoan.GetPersonalLoanHistory, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	e.GET(personalLoanPath+"/:id/bond", personalLoan.DownloadPersonalLoanBond, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	e.POST(personalLoanPath+"/:id/payments", personalLoan.RecordPersonalLoanPayment, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Update)...)
	e.PATCH(personalLoanPath+"/:id/payments/:payment_id", personalLoan.EditPersonalLoanPayment, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read, auth.RequirePermission("can edit ledger entry"))...)
	e.DELETE(personalLoanPath+"/:id/payments/:payment_id", personalLoan.DeletePersonalLoanPayment, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read, auth.RequirePermission("can delete ledger entry"))...)
	e.DELETE(personalLoanPath+"/:id", personalLoan.DeletePersonalLoan, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read, auth.RequirePermission("can delete ledger entry"))...)
	e.PATCH(personalLoanPath+"/:id/disbursement", personalLoan.EditPersonalLoanDisbursement, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read, auth.RequirePermission("can edit ledger entry"))...)
	e.POST(personalLoanPath+"/:id/renewal-preview", personalLoan.PreviewPersonalLoanRenewal, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Update)...)
	e.POST(personalLoanPath+"/:id/renew", personalLoan.RenewPersonalLoan, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Update)...)
	e.POST(personalLoanPath+"/:id/approve", personalLoan.ApprovePersonalLoan, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Update)...)
	e.GET(personalLoanPath+"/:id/approvals", personalLoan.ListPersonalLoanApprovals, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	return e
}

func PersonalLoanCustomerRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("personalloans")
	e.GET("/api/v1/users/:user_id/customers/:id/personal-loans", personalLoan.ListPersonalLoansForCustomer, auth.Staff(auth.RequireTenantModule(commonModels.ModulePersonalLoans), perms.Read)...)
	return e
}
