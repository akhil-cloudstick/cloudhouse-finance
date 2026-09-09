package ornamenttype

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the ornament-type endpoints under the given group
// (expected to be something like r.Group("/api/v1/ornament-types")). perms
// gates each verb by CRUD action against the "ornamenttypes" resource.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.GET("", perms.Read, h.List)
	rg.POST("", perms.Create, h.Create)
}
