package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var publicPath = "/api/v1/public"

var brandingPath = "/api/v1/users/:user_id/branding"

func PublicRoutes(e *echo.Echo) *echo.Echo {
	e.GET(publicPath+"/branding", common.GetPublicBrandingByHost)
	e.GET(publicPath+"/branding/:code", common.GetPublicBranding)
	e.GET(publicPath+"/branding/:code/logo", common.GetPublicLogo)
	e.GET(publicPath+"/connect/:code", common.RedeemConnectCode)
	return e
}

func BrandingRoutes(e *echo.Echo) *echo.Echo {
	e.GET(brandingPath, common.GetMyBranding, auth.Staff()...)
	e.POST(brandingPath+"/connect-code", common.IssueConnectCode, auth.Staff()...)
	return e
}
