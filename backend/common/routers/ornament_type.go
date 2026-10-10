package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var ornamentTypePath = "/api/v1/users/:user_id/ornament-types"

func OrnamentTypeRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("ornamenttypes")
	e.GET(ornamentTypePath, common.ListOrnamentTypes, auth.Staff(perms.Read)...)
	e.POST(ornamentTypePath, common.CreateOrnamentType, auth.Staff(perms.Create)...)
	return e
}
