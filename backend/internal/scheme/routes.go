package scheme

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the loan-scheme endpoints under the given group
// (expected to be something like r.Group("/api/v1/schemes")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.POST("", h.Create)
	rg.GET("", h.List)
	rg.GET("/active", h.ListActive)
	rg.GET("/inactive", h.ListInactive)
	rg.GET("/:id", h.Get)
	rg.PUT("/:id", h.Update)
	rg.DELETE("/:id", h.Delete)
	rg.POST("/:id/toggle-active", h.ToggleActive)
	rg.POST("/:id/calculate", h.Calculate)
}
