package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

func AuthzRoutes(e *echo.Echo) *echo.Echo {
	e.GET("/api/v1/users/:user_id/employees/:id/permissions/by-employee", common.GetPermissionsByEmployee, auth.Staff()...)
	e.GET("/api/v1/users/:user_id/employees/:id/permissions", common.GetPermissionMatrix, auth.Staff(auth.RequirePermission("can view role and permission module"))...)
	e.PATCH("/api/v1/users/:user_id/employees/:id/permissions/:role_id", common.UpdatePermissions, auth.Staff(auth.RequirePermission("can update role"))...)
	e.PATCH("/api/v1/users/:user_id/employees/:id/permissions/:role_id/set-all", common.SetAllPermissions, auth.Staff(auth.RequirePermission("can update role"))...)
	e.GET("/api/v1/users/:user_id/roles", common.ListRoles, auth.Staff(auth.RequirePermission("can view role and permission module"))...)
	e.POST("/api/v1/users/:user_id/roles", common.CreateRole, auth.Staff(auth.RequirePermission("can create role"))...)
	e.PATCH("/api/v1/users/:user_id/roles/:id", common.UpdateRole, auth.Staff(auth.RequirePermission("can update role"))...)
	e.DELETE("/api/v1/users/:user_id/roles/:id/delete", common.DeleteRole, auth.Staff(auth.RequirePermission("can delete role"))...)
	return e
}
