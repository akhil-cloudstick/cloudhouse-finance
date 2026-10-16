package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var businessProfilePath = "/api/v1/users/:user_id/business-profile"

func BusinessProfileRoutes(e *echo.Echo) *echo.Echo {
	view := auth.RequirePermission("can view business profile module")
	update := auth.RequirePermission("can update business profile")
	e.GET(businessProfilePath, common.GetBusinessProfile, auth.Staff(view)...)
	e.PATCH(businessProfilePath+"/update", common.UpdateBusinessProfile, auth.Staff(view, update)...)
	return e
}
