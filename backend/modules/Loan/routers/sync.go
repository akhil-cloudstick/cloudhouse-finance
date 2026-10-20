package routers

import (
	"cloudhouse/backend/auth"
	loan "cloudhouse/backend/modules/Loan/controllers"

	"github.com/labstack/echo/v4"
)

var syncPath = "/api/v1/users/:user_id/sync"

func SyncRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("loans")
	e.GET(syncPath+"/pull", loan.SyncPull, auth.Staff(perms.Read)...)
	return e
}
