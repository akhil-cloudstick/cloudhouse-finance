package puritystandard

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the purity-standard endpoints under the given
// group (expected to be r.Group("/api/v1/purity-standards")). perms gates
// each verb by CRUD action against the "puritystandards" resource (see
// platform.CRUDPermissions).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.GET("", perms.Read, h.List)
	rg.POST("", perms.Create, h.Create)
}
