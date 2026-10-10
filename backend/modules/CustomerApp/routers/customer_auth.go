package routers

import (
	"cloudhouse/backend/auth"
	customerApp "cloudhouse/backend/modules/CustomerApp/controllers"

	"github.com/labstack/echo/v4"
)

var customerAuthPath = "/api/v1/customer/auth"

func CustomerAuthRoutes(e *echo.Echo) *echo.Echo {
	e.POST(customerAuthPath+"/request-otp", customerApp.RequestOTP)
	e.POST(customerAuthPath+"/verify-otp", customerApp.VerifyOTP)
	e.POST(customerAuthPath+"/device-login", customerApp.DeviceLogin)
	e.POST(customerAuthPath+"/register-device", customerApp.RegisterDevice, auth.CustomerAuthMiddleware(), auth.PinTenantConn())
	e.POST(customerAuthPath+"/refresh", customerApp.RefreshCustomerToken, auth.CustomerAuthMiddleware(), auth.PinTenantConn())
	return e
}
