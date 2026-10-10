package routers

import "github.com/labstack/echo/v4"

func PacketModuleRoutes(e *echo.Echo) *echo.Echo {
	PacketRoutes(e)
	return e
}
