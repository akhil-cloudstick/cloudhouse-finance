package routers

import "github.com/labstack/echo/v4"

func PersonalLoanModuleRoutes(e *echo.Echo) *echo.Echo {
	PersonalLoanCustomerRoutes(e)
	PersonalLoanRoutes(e)
	return e
}
