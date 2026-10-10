package routers

import "github.com/labstack/echo/v4"

func SuperAdminModuleRoutes(e *echo.Echo) *echo.Echo {
	SuperAdminRoutes(e)
	return e
}
