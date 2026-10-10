package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var goldRatePath = "/api/v1/users/:user_id/gold-rates"

func GoldRateRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("goldrates")
	e.POST(goldRatePath, common.PublishGoldRate, auth.Staff(perms.Create)...)
	e.GET(goldRatePath, common.ListGoldRates, auth.Staff(perms.Read)...)
	e.GET(goldRatePath+"/latest", common.GetLatestGoldRate, auth.Staff(perms.Read)...)
	e.GET(goldRatePath+"/:id", common.GetGoldRateById, auth.Staff(perms.Read)...)
	return e
}
