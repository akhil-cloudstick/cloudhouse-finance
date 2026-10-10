package routers

import "github.com/labstack/echo/v4"

func LoanModuleRoutes(e *echo.Echo) *echo.Echo {
	CustomerLoanRoutes(e)
	CustomerProfileRoutes(e)
	LoanRoutes(e)
	return e
}
