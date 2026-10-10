package routers

import (
	"cloudhouse/backend/auth"
	cash "cloudhouse/backend/modules/Cash/controllers"

	"github.com/labstack/echo/v4"
)

var cashPath = "/api/v1/users/:user_id/cash"

func CashRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("cash")
	e.POST(cashPath+"/opening-balance", cash.SetOpeningBalance, auth.Staff(perms.Create)...)
	e.GET(cashPath+"/opening-balance", cash.GetOpeningBalance, auth.Staff(perms.Read)...)
	e.GET(cashPath+"/summary", cash.GetCashSummary, auth.Staff(perms.Read)...)
	return e
}
