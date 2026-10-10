package routers

import "github.com/labstack/echo/v4"

func BillingModuleRoutes(e *echo.Echo) *echo.Echo {
	BillingRoutes(e)
	BillingWebhookRoutes(e)
	return e
}
