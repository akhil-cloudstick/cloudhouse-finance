package routers

import "github.com/labstack/echo/v4"

func ReminderModuleRoutes(e *echo.Echo) *echo.Echo {
	ReminderRoutes(e)
	return e
}
