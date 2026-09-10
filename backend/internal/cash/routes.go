package cash

import (
	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// RegisterMovementRoutes mounts the cash-movement endpoints under the given
// group (expected to be something like r.Group("/api/v1/cash-movements")).
// perms gates each verb by CRUD action against the "cash" resource
// (cash-movements/expenses/opening-balance/summary all share one "cash"
// resource key, per the permission plan).
func RegisterMovementRoutes(rg *gin.RouterGroup, h *MovementHandler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Record)
	rg.GET("", perms.Read, h.List)
	rg.GET("/export", perms.Read, h.Export)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PATCH("/:id/status", perms.Update, h.SetStatus)
}

// RegisterExpenseRoutes mounts the expense endpoints under the given group
// (expected to be something like r.Group("/api/v1/expenses")).
func RegisterExpenseRoutes(rg *gin.RouterGroup, h *ExpenseHandler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Record)
	rg.GET("", perms.Read, h.List)
	rg.GET("/export", perms.Read, h.Export)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PATCH("/:id/approve", perms.Update, h.Approve)
	rg.PATCH("/:id/reject", perms.Update, h.Reject)
}

// RegisterCashRoutes mounts the opening-balance and summary endpoints under
// the given group (expected to be r.Group("/api/v1/cash")).
func RegisterCashRoutes(rg *gin.RouterGroup, ob *OpeningBalanceHandler, summary *SummaryHandler, perms platform.CRUDMiddlewares) {
	rg.POST("/opening-balance", perms.Create, ob.Set)
	rg.GET("/opening-balance", perms.Read, ob.Get)
	rg.GET("/summary", perms.Read, summary.Get)
}
