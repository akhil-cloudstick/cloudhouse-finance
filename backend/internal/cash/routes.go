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
	rg.PATCH("/:id/approve", h.Approve)
	rg.PATCH("/:id/reject", h.Reject)
}

// RegisterCashRoutes mounts the opening-balance and summary endpoints under
// the given group (expected to be r.Group("/api/v1/cash")).
func RegisterCashRoutes(rg *gin.RouterGroup, ob *OpeningBalanceHandler, summary *SummaryHandler) {
	rg.POST("/opening-balance", ob.Set)
	rg.GET("/opening-balance", ob.Get)
	rg.GET("/summary", summary.Get)
}
