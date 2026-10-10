package routers

import "github.com/labstack/echo/v4"

func CustomerAppModuleRoutes(e *echo.Echo) *echo.Echo {
	CustomerAuthRoutes(e)
	return e
}
