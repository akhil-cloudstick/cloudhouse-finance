package branch

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the branch endpoints under the given group
// (expected to be something like r.Group("/api/v1/branches")). perms gates
// each verb by CRUD action against the "branches" resource.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	// Registered before "/:id" for readability only — gin matches the static
	// segment regardless of order. Answers "which branches may I switch
	// between", which the scoped list above cannot: see Handler.Switchable.
	rg.GET("/switchable", perms.Read, h.Switchable)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PUT("/:id", perms.Update, h.Update)
	rg.DELETE("/:id", perms.Delete, h.Delete)
}
