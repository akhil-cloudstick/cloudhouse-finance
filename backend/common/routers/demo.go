package routers

import (
	"cloudhouse/backend/auth"
	"cloudhouse/backend/demo"

	"github.com/labstack/echo/v4"
)

var demoPath = "/api/v1/users/:user_id/demo"

func DemoRoutes(e *echo.Echo) *echo.Echo {
	e.POST(demoPath+"/reset", demo.ResetDemo, auth.Staff(auth.RequireTenantModule("demo_reset"), auth.RequireSystemRole())...)
	return e
}
