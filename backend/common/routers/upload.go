package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var uploadPath = "/api/v1/users/:user_id/uploads"

func UploadRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("uploads")
	e.POST(uploadPath, common.UploadFile, auth.Staff(perms.Create)...)
	return e
}
