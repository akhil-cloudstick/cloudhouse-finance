package routers

import (
	"cloudhouse/backend/auth"
	locker "cloudhouse/backend/modules/Locker/controllers"

	"github.com/labstack/echo/v4"
)

var lockerPath = "/api/v1/users/:user_id/lockers"

func LockerRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("lockers")
	e.POST(lockerPath, locker.CreateLocker, auth.Staff(perms.Create)...)
	e.GET(lockerPath, locker.ListLockers, auth.Staff(perms.Read)...)
	e.GET(lockerPath+"/:id", locker.GetLockerById, auth.Staff(perms.Read)...)
	e.PATCH(lockerPath+"/:id/update", locker.UpdateLocker, auth.Staff(perms.Update)...)
	e.DELETE(lockerPath+"/:id/delete", locker.DeleteLocker, auth.Staff(perms.Delete)...)
	return e
}
