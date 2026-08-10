package loan

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the loan endpoints under the given group (expected
// to be something like r.Group("/api/v1/loans")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.POST("", h.Create)
	rg.GET("", h.List)
	rg.GET("/:id", h.Get)

	rg.POST("/:id/ornaments", h.AddOrnament)
	rg.PUT("/ornaments/:ornamentId", h.UpdateOrnament)
	rg.POST("/ornaments/:ornamentId/purity-test", h.RecordPurityTest)
	rg.POST("/ornaments/:ornamentId/images", h.AddOrnamentImage)

	rg.POST("/:id/approve", h.Approve)

	rg.POST("/:id/payments", h.RecordPayment)

	rg.POST("/:id/auction", h.RecordAuction)

	rg.POST("/:id/bank-pledge", h.RecordBankPledge)
	rg.PUT("/:id/bank-pledge/:pledgeId/release", h.ReleaseBankPledge)
}
