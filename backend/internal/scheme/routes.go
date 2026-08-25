package scheme

import (
	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// RegisterRoutes mounts the loan-scheme endpoints under the given group
// (expected to be something like r.Group("/api/v1/schemes")). perms gates
// each verb by CRUD action against the "schemes" resource.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	rg.GET("/active", perms.Read, h.ListActive)
	rg.GET("/inactive", perms.Read, h.ListInactive)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PUT("/:id", perms.Update, h.Update)
	rg.DELETE("/:id", perms.Delete, h.Delete)
	rg.POST("/:id/toggle-active", perms.Update, h.ToggleActive)
	rg.POST("/:id/calculate", perms.Read, h.Calculate)
}
