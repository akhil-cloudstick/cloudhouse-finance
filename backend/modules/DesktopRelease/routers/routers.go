package routers

import (
	"cloudhouse/backend/auth"
	desktopRelease "cloudhouse/backend/modules/DesktopRelease/controllers"

	"github.com/labstack/echo/v4"
)

var desktopReleasePath = "/api/v1/superadmin/users/:user_id/desktop-releases"

// DesktopReleaseModuleRoutes wires the superadmin "Rebuild" buttons.
func DesktopReleaseModuleRoutes(e *echo.Echo) *echo.Echo {
	e.POST(desktopReleasePath, desktopRelease.TriggerRelease, auth.SuperAdmin()...)
	e.GET(desktopReleasePath, desktopRelease.ListReleaseJobs, auth.SuperAdmin()...)
	e.GET(desktopReleasePath+"/history", desktopRelease.ListReleaseHistory, auth.SuperAdmin()...)
	e.POST(desktopReleasePath+"/:id/cancel", desktopRelease.CancelReleaseJob, auth.SuperAdmin()...)
	return e
}
