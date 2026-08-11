package loan

import (
	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// RegisterRoutes mounts the loan endpoints under the given group (expected
// to be something like r.Group("/api/v1/loans")). perms gates each verb by
// CRUD action against the "loans" resource. Sub-resources (ornaments,
// approvals, payments, auctions, bank-pledges) all live under the same
// "loans" resource key for now — they're all facets of a loan record.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	rg.GET("/by-number/:loanNumber", perms.Read, h.GetByLoanNumber)
	rg.GET("/interest-collected", perms.Read, h.GetInterestCollected)
	rg.GET("/:id", perms.Read, h.Get)

	rg.POST("/:id/ornaments", perms.Update, h.AddOrnament)
	rg.PUT("/ornaments/:ornamentId", perms.Update, h.UpdateOrnament)
	rg.POST("/ornaments/:ornamentId/purity-test", perms.Update, h.RecordPurityTest)
	rg.POST("/ornaments/:ornamentId/images", perms.Update, h.AddOrnamentImage)

	rg.POST("/:id/approve", perms.Update, h.Approve)
	rg.GET("/:id/approvals", perms.Read, h.ListApprovals)

	rg.POST("/:id/payments", perms.Update, h.RecordPayment)

	rg.GET("/:id/auction", perms.Read, h.GetAuction)
	rg.POST("/:id/auction/eligible", perms.Update, h.MarkAuctionEligible)
	rg.POST("/:id/auction/notice", perms.Update, h.IssueAuctionNotice)
	rg.POST("/:id/auction/schedule", perms.Update, h.ScheduleAuction)
	rg.POST("/:id/auction/sale", perms.Update, h.RecordAuctionSale)
	rg.POST("/:id/auction/settle", perms.Update, h.SettleAuction)

	rg.POST("/:id/bank-pledge", perms.Update, h.RecordBankPledge)
	rg.PUT("/:id/bank-pledge/:pledgeId/release", perms.Update, h.ReleaseBankPledge)

	rg.POST("/:id/extension-request", perms.Update, h.CreateExtensionRequest)
	rg.POST("/:id/release-request", perms.Update, h.CreateReleaseRequest)
	rg.GET("/requests", perms.Read, h.ListRequests)
	rg.PUT("/requests/:requestId/decide", perms.Update, h.DecideRequest)
	rg.PUT("/requests/:requestId/verify", perms.Update, h.VerifyReleaseChecklist)
	rg.POST("/requests/:requestId/approve", perms.Update, h.ApproveReleaseRequest)
	rg.POST("/:id/complete-release", perms.Update, h.CompleteRelease)
}
