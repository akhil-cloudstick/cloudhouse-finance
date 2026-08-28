package authz

import (
	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// RegisterRoutes mounts the standard's 3-endpoint permissions API (§7) plus
// role CRUD, under rg (expected to be r.Group("/api/v1/employees")) —
// employeeGroup must already carry AuthMiddleware (all these routes need at
// least a valid token; ByEmployee is auth-only, the rest also require the
// role-and-permission permission).
func RegisterRoutes(employeeGroup *gin.RouterGroup, roleGroup *gin.RouterGroup, h *Handler, checker platform.PermissionChecker) {
	view := platform.RequirePermission(checker, "can view role and permission")
	createRole := platform.RequirePermission(checker, "can create role")
	// Grant editing used to have its own "can change role permission"; that
	// permission is gone with the rest of the "can change ..." set, so editing
	// a role's grants is now part of updating the role itself.
	updateRole := platform.RequirePermission(checker, "can update role")
	deleteRole := platform.RequirePermission(checker, "can delete role")

	// Uses ":id" (not ":employee_id") to match the wildcard name
	// internal/employee's own routes.go already registered at this same
	// "/employees/:..." tree position — gin's router panics at startup if
	// two different param names appear at the same path segment.
	employeeGroup.GET("/:id/permissions/by-employee", h.ByEmployee)
	employeeGroup.GET("/:id/permissions", view, h.Matrix)
	employeeGroup.PATCH("/:id/permissions/:role_id", updateRole, h.UpdatePermissions)
	employeeGroup.PATCH("/:id/permissions/:role_id/set-all", updateRole, h.SetAll)

	roleGroup.GET("", view, h.ListRoles)
	roleGroup.POST("", createRole, h.CreateRole)
	roleGroup.PATCH("/:id", updateRole, h.UpdateRole)
	roleGroup.DELETE("/:id", deleteRole, h.DeleteRole)
}
