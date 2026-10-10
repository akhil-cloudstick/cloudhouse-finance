package routers

import (
	"cloudhouse/backend/auth"
	loan "cloudhouse/backend/modules/Loan/controllers"

	"github.com/labstack/echo/v4"
)

var customerProfilePath = "/api/v1/users/:user_id/customers"

func CustomerProfileRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("customers")
	loanPerms := auth.CRUDPermissions("loans")
	e.GET(customerProfilePath+"/:id/profile360", loan.GetCustomer360, auth.Staff(perms.Read)...)
	e.GET(customerProfilePath+"/:id/loans", loan.ListLoansForCustomer, auth.Staff(perms.Read)...)
	e.GET(customerProfilePath+"/:id/ornaments", loan.ListOrnamentsForCustomer, auth.Staff(perms.Read)...)
	e.GET(customerProfilePath+"/:id/payments", loan.ListPaymentsForCustomer, auth.Staff(perms.Read)...)
	e.GET(customerProfilePath+"/:id/bank-pledges", loan.ListBankPledgesForCustomer, auth.Staff(perms.Read)...)
	e.GET(customerProfilePath+"/:id/auction-history", loan.ListAuctionHistoryForCustomer, auth.Staff(perms.Read, auth.RequirePermission("can view auction module"))...)
	e.GET("/api/v1/users/:user_id/schemes/:id/statement", loan.SchemeStatement, auth.Staff(loanPerms.Read, loanPerms.Export)...)
	return e
}
