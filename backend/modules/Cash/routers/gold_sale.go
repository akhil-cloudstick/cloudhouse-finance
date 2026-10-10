package routers

import (
	"cloudhouse/backend/auth"
	cash "cloudhouse/backend/modules/Cash/controllers"

	"github.com/labstack/echo/v4"
)

var goldSalePath = "/api/v1/users/:user_id/gold-sales"

func GoldSaleRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("cash")
	e.POST(goldSalePath, cash.RecordGoldSale, auth.Staff(perms.Create)...)
	e.GET(goldSalePath, cash.ListGoldSales, auth.Staff(perms.Read)...)
	e.GET(goldSalePath+"/:id", cash.GetGoldSaleById, auth.Staff(perms.Read)...)
	return e
}
