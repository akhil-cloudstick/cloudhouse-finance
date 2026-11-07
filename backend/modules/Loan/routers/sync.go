package routers

import (
	"cloudhouse/backend/auth"
	loan "cloudhouse/backend/modules/Loan/controllers"
	syncmirror "cloudhouse/backend/modules/Sync/controllers"

	"github.com/labstack/echo/v4"
)

var syncPath = "/api/v1/users/:user_id/sync"

func SyncRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("loans")
	e.GET(syncPath+"/pull", loan.SyncPull, auth.Staff(perms.Read)...)
	e.GET(syncPath+"/ids", loan.SyncIDs, auth.Staff(perms.Read)...)
	e.GET(syncPath+"/tables", syncmirror.SyncTables, auth.Staff(perms.Read)...)
	e.GET(syncPath+"/table/:name", syncmirror.SyncTableRows, auth.Staff(perms.Read)...)
	e.GET(syncPath+"/table/:name/ids", syncmirror.SyncTableIDs, auth.Staff(perms.Read)...)
	e.GET(syncPath+"/children/:name", syncmirror.SyncChildRows, auth.Staff(perms.Read)...)
	return e
}
