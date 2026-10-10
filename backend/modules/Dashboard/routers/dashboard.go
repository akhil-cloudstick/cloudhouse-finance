package routers

import (
	"cloudhouse/backend/auth"
	dashboard "cloudhouse/backend/modules/Dashboard/controllers"

	"github.com/labstack/echo/v4"
)

var dashboardPath = "/api/v1/users/:user_id/dashboard"

func DashboardRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("loans")
	e.GET(dashboardPath+"/needs-attention", dashboard.GetNeedsAttention, auth.Staff(perms.Read)...)
	e.GET(dashboardPath+"/summary", dashboard.GetDashboardSummary, auth.Staff(perms.Read)...)
	e.GET(dashboardPath+"/activity", dashboard.GetDashboardActivity, auth.Staff(perms.Read)...)
	e.GET(dashboardPath+"/snapshots", dashboard.ListSnapshots, auth.Staff(perms.Read)...)
	e.GET(dashboardPath+"/snapshots/latest", dashboard.GetLatestSnapshot, auth.Staff(perms.Read)...)
	return e
}
