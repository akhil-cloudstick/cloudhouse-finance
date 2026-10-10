package routers

import (
	"cloudhouse/backend/auth"
	cash "cloudhouse/backend/modules/Cash/controllers"

	"github.com/labstack/echo/v4"
)

var cashSourcePath = "/api/v1/users/:user_id/cash-sources"

func CashSourceRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("cash")
	e.GET(cashSourcePath, cash.ListCashSources, auth.Staff(perms.Read)...)
	e.POST(cashSourcePath, cash.CreateCashSource, auth.Staff(perms.Create)...)
	e.GET(cashSourcePath+"/:id", cash.GetCashSourceById, auth.Staff(perms.Read)...)
	e.GET(cashSourcePath+"/:id/ledger", cash.GetCashSourceLedger, auth.Staff(perms.Read, perms.ExportQuery)...)
	return e
}
