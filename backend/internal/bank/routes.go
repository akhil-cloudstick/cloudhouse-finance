package bank

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the bank endpoints under the given group (expected
// to be something like r.Group("/api/v1/banks")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("", h.List)
	rg.POST("", h.Create)
}
