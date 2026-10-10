package routers

import "github.com/labstack/echo/v4"

func LockerModuleRoutes(e *echo.Echo) *echo.Echo {
	LockerRoutes(e)
	return e
}
