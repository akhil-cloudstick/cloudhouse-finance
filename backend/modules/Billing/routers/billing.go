package routers

import (
	"cloudhouse/backend/auth"
	billing "cloudhouse/backend/modules/Billing/controllers"

	"github.com/labstack/echo/v4"
)

var billingPath = "/api/v1/users/:user_id/billing"

func BillingRoutes(e *echo.Echo) *echo.Echo {
	e.GET(billingPath+"/status", billing.GetBillingStatus, auth.Staff(auth.RequirePermission("can manage billing"))...)
	e.POST(billingPath+"/subscribe", billing.Subscribe, auth.Staff(auth.RequirePermission("can manage billing"))...)
	e.POST(billingPath+"/confirm", billing.ConfirmSubscription, auth.Staff(auth.RequirePermission("can manage billing"))...)
	return e
}

func BillingWebhookRoutes(e *echo.Echo) *echo.Echo {
	e.POST("/api/v1/webhooks/razorpay", billing.RazorpayWebhook)
	return e
}
