package routers

import (
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

func UploadServeRoutes(e *echo.Echo) *echo.Echo {
	e.GET("/uploads/:key", common.ServeUpload)
	return e
}
