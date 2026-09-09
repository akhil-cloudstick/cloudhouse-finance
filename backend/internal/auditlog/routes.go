package auditlog

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the read-only audit log endpoint under the given
// group (expected to be r.Group("/audit-log")). Gated by "can view audit
// log" only — see platform.CRUDPermissions's "audit-log" special case,
// which mirrors "reports": there is nothing to create, update or delete
// here, entries are written internally by the domains that produce them.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.GET("", perms.Read, h.List)
}
