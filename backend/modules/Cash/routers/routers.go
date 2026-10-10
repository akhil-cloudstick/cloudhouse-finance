package routers

import "github.com/labstack/echo/v4"

func CashModuleRoutes(e *echo.Echo) *echo.Echo {
	CashRoutes(e)
	CashSourceRoutes(e)
	CategoryRoutes(e)
	ExpenseCategoryLedgerRoutes(e)
	ExpenseCategoryRoutes(e)
	ExpenseRoutes(e)
	GoldSaleRoutes(e)
	MovementRoutes(e)
	return e
}
