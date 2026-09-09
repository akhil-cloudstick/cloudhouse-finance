package employee

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the employee endpoints under the given group
// (expected to be something like r.Group("/api/v1/employees")). perms gates
// each verb by CRUD action against the "employees" resource.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PUT("/:id", perms.Update, h.Update)
	rg.DELETE("/:id", perms.Delete, h.Delete)
}
