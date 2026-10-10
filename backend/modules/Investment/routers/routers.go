package routers

import "github.com/labstack/echo/v4"

func InvestmentModuleRoutes(e *echo.Echo) *echo.Echo {
	InvestmentCustomerRoutes(e)
	InvestmentPlanRoutes(e)
	InvestmentRoutes(e)
	return e
}
