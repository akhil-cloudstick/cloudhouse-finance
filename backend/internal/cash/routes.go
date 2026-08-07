package cash

import "github.com/gin-gonic/gin"

// RegisterMovementRoutes mounts the cash-movement endpoints under the given
// group (expected to be something like r.Group("/api/v1/cash-movements")).
func RegisterMovementRoutes(rg *gin.RouterGroup, h *MovementHandler) {
	rg.POST("", h.Record)
	rg.GET("", h.List)
	rg.GET("/:id", h.Get)
	rg.PATCH("/:id/status", h.SetStatus)
}

// RegisterExpenseRoutes mounts the expense endpoints under the given group
// (expected to be something like r.Group("/api/v1/expenses")).
func RegisterExpenseRoutes(rg *gin.RouterGroup, h *ExpenseHandler) {
	rg.POST("", h.Record)
	rg.GET("", h.List)
	rg.GET("/:id", h.Get)
}
