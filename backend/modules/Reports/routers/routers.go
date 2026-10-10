package routers

import "github.com/labstack/echo/v4"

func ReportsModuleRoutes(e *echo.Echo) *echo.Echo {
	ReportRoutes(e)
	return e
}
