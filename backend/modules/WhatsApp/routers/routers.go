package routers

import "github.com/labstack/echo/v4"

func WhatsAppModuleRoutes(e *echo.Echo) *echo.Echo {
	WhatsAppRoutes(e)
	return e
}
