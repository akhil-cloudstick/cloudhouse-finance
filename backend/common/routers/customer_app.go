package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var customerAppPath = "/api/v1/customers/:customer_id"

func CustomerAppRoutes(e *echo.Echo) *echo.Echo {
	e.GET(customerAppPath+"/gold-rate/latest", common.GetLatestGoldRate, auth.Customer()...)
	e.GET(customerAppPath+"/gold-rate/history", common.ListGoldRates, auth.Customer()...)
	e.GET(customerAppPath+"/profile", common.CustomerGetProfile, auth.Customer()...)
	e.POST(customerAppPath+"/profile/verify-pan", common.CustomerVerifyPAN, auth.Customer()...)
	e.POST(customerAppPath+"/profile/aadhaar/start", common.CustomerStartAadhaarVerify, auth.Customer()...)
	e.GET(customerAppPath+"/profile/aadhaar/status", common.CustomerCheckAadhaarVerify, auth.Customer()...)
	e.GET(customerAppPath+"/notifications", common.ListNotifications, auth.Customer()...)
	e.POST(customerAppPath+"/notifications/:id/ack", common.AckNotification, auth.Customer()...)
	e.POST(customerAppPath+"/notifications/:id/read", common.ReadNotification, auth.Customer()...)
	e.GET("/api/v1/customer/ws", common.ConnectNotificationSocket, auth.CustomerAuthMiddleware())
	return e
}
