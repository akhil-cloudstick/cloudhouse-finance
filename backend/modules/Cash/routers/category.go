package routers

import (
	"cloudhouse/backend/auth"
	cash "cloudhouse/backend/modules/Cash/controllers"

	"github.com/labstack/echo/v4"
)

var categoryPath = "/api/v1/users/:user_id/categories"

func CategoryRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("cash")
	e.GET(categoryPath, cash.ListCategories, auth.Staff(perms.Read)...)
	e.POST(categoryPath, cash.CreateCategory, auth.Staff(perms.Create)...)
	return e
}
