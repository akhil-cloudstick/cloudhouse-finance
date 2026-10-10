package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	billingRouters "cloudhouse/backend/modules/Billing/routers"
	cashRouters "cloudhouse/backend/modules/Cash/routers"
	customerAppRouters "cloudhouse/backend/modules/CustomerApp/routers"
	dashboardRouters "cloudhouse/backend/modules/Dashboard/routers"
	investmentRouters "cloudhouse/backend/modules/Investment/routers"
	loanRouters "cloudhouse/backend/modules/Loan/routers"
	lockerRouters "cloudhouse/backend/modules/Locker/routers"
	packetRouters "cloudhouse/backend/modules/Packet/routers"
	personalLoanRouters "cloudhouse/backend/modules/PersonalLoan/routers"
	reminderRouters "cloudhouse/backend/modules/Reminder/routers"
	reportsRouters "cloudhouse/backend/modules/Reports/routers"
	superAdminRouters "cloudhouse/backend/modules/SuperAdmin/routers"
	webApp "cloudhouse/backend/modules/WebApp/controllers"
	"log"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func InitRoutes(e *echo.Echo) *echo.Echo {
	e.HideBanner = true
	e.HTTPErrorHandler = common.ErrorHandler
	e.Use(middleware.Recover())
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogMethod:   true,
		LogURI:      true,
		LogStatus:   true,
		LogLatency:  true,
		HandleError: true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			if v.Status >= 400 {
				log.Printf("%d %s %s %s", v.Status, v.Method, v.URI, v.Latency.Round(time.Millisecond))
			}
			return nil
		},
	}))
	e.Use(auth.CORS(config.Env.FrontendOrigin))
	e.Use(auth.CarryRequestHost())
	CommonRoutes(e)
	cashRouters.CashModuleRoutes(e)
	loanRouters.LoanModuleRoutes(e)
	dashboardRouters.DashboardModuleRoutes(e)
	lockerRouters.LockerModuleRoutes(e)
	packetRouters.PacketModuleRoutes(e)
	reminderRouters.ReminderModuleRoutes(e)
	personalLoanRouters.PersonalLoanModuleRoutes(e)
	investmentRouters.InvestmentModuleRoutes(e)
	reportsRouters.ReportsModuleRoutes(e)
	billingRouters.BillingModuleRoutes(e)
	customerAppRouters.CustomerAppModuleRoutes(e)
	superAdminRouters.SuperAdminModuleRoutes(e)
	e.RouteNotFound("/api/v1/users/:user_id/*", echo.NotFoundHandler, auth.Staff()...)
	e.RouteNotFound("/api/v1/customers/:customer_id/*", echo.NotFoundHandler, auth.Customer()...)
	e.RouteNotFound("/api/v1/superadmin/users/:user_id/*", echo.NotFoundHandler, auth.SuperAdmin()...)
	webApp.RegisterWhatsAppProxy(e, config.Env.WhatsAppOrigin)
	webApp.Register(e, config.Env.FrontendDir)
	return e
}
