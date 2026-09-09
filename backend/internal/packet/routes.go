package packet

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the packet endpoints under the given group
// (expected to be something like r.Group("/api/v1/packets")). perms gates
// each verb by CRUD action against the "packets" resource.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.GET("", perms.Read, h.List)
	rg.GET("/by-code/:code", perms.Read, h.GetByCode)
	rg.GET("/:id", perms.Read, h.Get)
	rg.GET("/:id/movements", perms.Read, h.ListMovements)
	rg.POST("/:id/movements", perms.Update, h.RecordMovement)
}
