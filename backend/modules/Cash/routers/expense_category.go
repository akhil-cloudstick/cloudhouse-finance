package routers

import (
	"cloudhouse/backend/auth"
	cash "cloudhouse/backend/modules/Cash/controllers"

	"github.com/labstack/echo/v4"
)

var expenseCategoryPath = "/api/v1/users/:user_id/expense-categories"

func ExpenseCategoryRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("cash")
	e.GET(expenseCategoryPath, cash.ListExpenseCategories, auth.Staff(perms.Read)...)
	e.POST(expenseCategoryPath, cash.CreateExpenseCategory, auth.Staff(perms.Create)...)
	return e
}

func ExpenseCategoryLedgerRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("cash")
	e.GET(expenseCategoryPath+"/:id/ledger", cash.GetExpenseCategoryLedger, auth.Staff(perms.Read, perms.ExportQuery, cash.LedgerFocus())...)
	e.GET("/api/v1/users/:user_id/banks/:id/ledger", cash.GetBankLedger, auth.Staff(perms.Read, perms.ExportQuery, cash.LedgerFocus())...)
	return e
}
