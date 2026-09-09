package goldrate

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the gold-rate endpoints under the given group
// (expected to be something like r.Group("/api/v1/gold-rates")). perms
// gates each verb by CRUD action against the "goldrates" resource.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Publish)
	rg.GET("", perms.Read, h.List)
	rg.GET("/latest", perms.Read, h.Latest)
	rg.GET("/:id", perms.Read, h.Get)
}
