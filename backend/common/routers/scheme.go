package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var schemePath = "/api/v1/users/:user_id/schemes"

func SchemeRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("schemes")
	e.POST(schemePath, common.CreateScheme, auth.Staff(perms.Create)...)
	e.GET(schemePath, common.ListSchemes, auth.Staff(perms.Read)...)
	e.GET(schemePath+"/active", common.ListActiveSchemes, auth.Staff(perms.Read)...)
	e.GET(schemePath+"/inactive", common.ListInactiveSchemes, auth.Staff(perms.Read)...)
	e.GET(schemePath+"/:id", common.GetSchemeById, auth.Staff(perms.Read)...)
	e.PATCH(schemePath+"/:id/update", common.UpdateScheme, auth.Staff(perms.Update)...)
	e.DELETE(schemePath+"/:id/delete", common.DeleteScheme, auth.Staff(perms.Delete)...)
	e.POST(schemePath+"/:id/toggle-active", common.ToggleSchemeActive, auth.Staff(perms.Update)...)
	e.POST(schemePath+"/:id/calculate", common.CalculateScheme, auth.Staff(perms.Read)...)
	return e
}
