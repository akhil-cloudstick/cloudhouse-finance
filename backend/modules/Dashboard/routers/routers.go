package routers

import "github.com/labstack/echo/v4"

func DashboardModuleRoutes(e *echo.Echo) *echo.Echo {
	DashboardRoutes(e)
	return e
}
