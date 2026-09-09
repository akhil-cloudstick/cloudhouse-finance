package bank

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the bank endpoints under the given group (expected
// to be something like r.Group("/api/v1/banks")). perms gates each verb by
// CRUD action against the "banks" resource (see platform.CRUDPermissions).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.GET("", perms.Read, h.List)
	rg.POST("", perms.Create, h.Create)
}
