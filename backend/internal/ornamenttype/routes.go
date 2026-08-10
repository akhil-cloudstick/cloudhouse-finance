package ornamenttype

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the ornament-type endpoints under the given group
// (expected to be something like r.Group("/api/v1/ornament-types")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("", h.List)
	rg.POST("", h.Create)
}
