package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var devicePath = "/api/v1/users/:user_id/devices"

func DeviceRoutes(e *echo.Echo) *echo.Echo {
	e.POST(devicePath, common.RegisterDevice, auth.Staff()...)
	return e
}
