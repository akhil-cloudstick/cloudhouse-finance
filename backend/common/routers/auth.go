package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var authPath = "/api/v1/auth"

func AuthRoutes(e *echo.Echo) *echo.Echo {
	e.POST(authPath+"/login", common.Login)
	e.POST(authPath+"/forgot-password", common.ForgotPassword)
	e.POST(authPath+"/verify-reset-code", common.VerifyResetCode)
	e.POST(authPath+"/reset-password", common.ResetPassword)
	e.GET(authPath+"/me", common.GetMe, auth.AuthMiddleware())
	e.POST(authPath+"/qr/issue", common.QRIssue, auth.AuthMiddleware())
	e.POST(authPath+"/qr/redeem", common.QRRedeem)
	return e
}
