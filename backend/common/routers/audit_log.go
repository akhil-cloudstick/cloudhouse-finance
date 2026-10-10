package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var auditLogPath = "/api/v1/users/:user_id/audit-log"

func AuditLogRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("audit-log")
	e.GET(auditLogPath, common.ListAuditLogs, auth.Staff(perms.Read)...)
	return e
}
