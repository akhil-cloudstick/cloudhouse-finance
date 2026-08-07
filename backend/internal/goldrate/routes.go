package goldrate

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the gold-rate endpoints under the given group
// (expected to be something like r.Group("/api/v1/gold-rates")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.POST("", h.Publish)
	rg.GET("", h.List)
	rg.GET("/latest", h.Latest)
	rg.GET("/:id", h.Get)
}
