package investment

import (
	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// RegisterRoutes mounts the investment endpoints under the given group
// (expected to be r.Group("/api/v1/investments")). perms gates each verb by
// CRUD action against the "investments" resource (see
// platform.CRUDPermissions) — mirrors personalloan.RegisterRoutes. Marking
// a payout paid and applying a maturity decision are both state-changing
// actions on an existing investment, so they gate on perms.Update, matching
// how personal loans gate RecordPayment/Renew.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	rg.GET("/:id", perms.Read, h.Get)
	rg.GET("/:id/schedule", perms.Read, h.Schedule)
	rg.POST("/:id/payouts/:payoutId/pay", perms.Update, h.MarkPayoutPaid)
	rg.POST("/:id/mature", perms.Update, h.Mature)
}

// RegisterPlanRoutes mounts the investment-plan endpoints under the given
// group (expected to be r.Group("/api/v1/investment-plans")), gated by the
// same "investments" resource permissions as RegisterRoutes.
func RegisterPlanRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.CreatePlan)
	rg.GET("", perms.Read, h.ListPlans)
	rg.GET("/:id", perms.Read, h.GetPlan)
	rg.PUT("/:id", perms.Update, h.UpdatePlan)
}
