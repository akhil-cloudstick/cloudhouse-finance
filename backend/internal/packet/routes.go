package packet

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the packet endpoints under the given group
// (expected to be something like r.Group("/api/v1/packets")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("", h.List)
	rg.GET("/by-code/:code", h.GetByCode)
	rg.GET("/:id", h.Get)
	rg.GET("/:id/movements", h.ListMovements)
	rg.POST("/:id/movements", h.RecordMovement)
}
