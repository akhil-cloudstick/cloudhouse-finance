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

	// Drafts — unsubmitted New Gold Loan forms (see LoanDraft). Mounted
	// before "/:id" for readability only; gin matches the static "drafts"
	// segment ahead of the parameter either way, exactly as it already does
	// for "/by-number/:loanNumber" and "/requests". Gated by the same "loans"
	// resource permissions: whoever may create a loan may draft one, and
	// DELETE is the only route on this group needing perms.Delete. Ownership
	// (a draft belongs to the employee who saved it) is enforced in the
	// service, not here.
	rg.POST("/drafts", perms.Create, h.SaveDraft)
	rg.GET("/drafts", perms.Read, h.ListDrafts)
	rg.GET("/drafts/:draftId", perms.Read, h.GetDraft)
	rg.PUT("/drafts/:draftId", perms.Update, h.UpdateDraft)
	rg.DELETE("/drafts/:draftId", perms.Delete, h.DeleteDraft)
	rg.GET("/by-number/:loanNumber", perms.Read, h.GetByLoanNumber)
	rg.GET("/interest-collected", perms.Read, h.GetInterestCollected)
	rg.GET("/:id", perms.Read, h.Get)

	rg.POST("/:id/ornaments", perms.Update, h.AddOrnament)
	rg.PUT("/ornaments/:ornamentId", perms.Update, h.UpdateOrnament)
	rg.POST("/ornaments/:ornamentId/purity-test", perms.Update, h.RecordPurityTest)
	rg.POST("/ornaments/:ornamentId/images", perms.Update, h.AddOrnamentImage)

	rg.POST("/:id/approve", perms.Update, h.Approve)
	rg.GET("/:id/approvals", perms.Read, h.ListApprovals)

	rg.POST("/:id/indemnity-bond/esign/start", perms.Update, h.StartIndemnityBondEsign)
	rg.GET("/:id/indemnity-bond/esign/status", perms.Read, h.CheckIndemnityBondEsign)

	rg.GET("/approval-limits/loan-operator", perms.Read, h.GetLoanOperatorApprovalLimit)
	rg.PUT("/approval-limits/loan-operator", perms.Update, h.SetLoanOperatorApprovalLimit)

	rg.POST("/:id/payments", perms.Update, h.RecordPayment)

	// Auction routes carry an ADDITIONAL role gate on top of the CRUD
	// permission. The permissions table is resource-grained, and "loans"
	// covers payments and ornaments too — so a Cashier or Loan Operator
	// legitimately holds loans:update in order to take payments. Auction
	// actions decide whether a customer permanently loses their pledged gold,
	// which is not the same authority. Both middlewares apply: the role must be
	// allowlisted AND hold the CRUD permission.
	//
	// Scoped deliberately to these routes only — a group-level guard would
	// strip Cashier access to payments, which share the same resource key.
	auctionRoles := platform.RequireAnyRole(
		"Administrator", "Management", "Branch Manager", "Auction Administrator",
	)

	rg.GET("/auctions/concluded", auctionRoles, perms.Read, h.ListConcludedAuctions)
	rg.GET("/auctions/decisions/pending", auctionRoles, perms.Read, h.ListPendingAuctionDecisions)

	rg.GET("/:id/auction", auctionRoles, perms.Read, h.GetAuction)
	rg.GET("/:id/auction/history", auctionRoles, perms.Read, h.GetAuctionHistory)
	rg.POST("/:id/auction/eligible", auctionRoles, perms.Update, h.MarkAuctionEligible)
	rg.POST("/:id/auction/notice", auctionRoles, perms.Update, h.IssueAuctionNotice)
	rg.POST("/:id/auction/schedule", auctionRoles, perms.Update, h.ScheduleAuction)
	rg.POST("/:id/auction/sale", auctionRoles, perms.Update, h.RecordAuctionSale)
	rg.POST("/:id/auction/settle", auctionRoles, perms.Update, h.SettleAuction)
	// Which roles may actually DECIDE is enforced in the service, because it
	// differs per escalation kind: an Auction Administrator may resolve a
	// part-payment decision but not a shortfall write-off.
	rg.POST("/:id/auction/decision", auctionRoles, perms.Update, h.ResolveAuctionDecision)

	rg.GET("/bank-pledges/history", perms.Read, h.ListBankPledgeHistory)
	rg.POST("/:id/bank-pledge", perms.Update, h.RecordBankPledge)
	rg.GET("/:id/bank-pledge/history", perms.Read, h.GetBankPledgeHistory)
	rg.PUT("/:id/bank-pledge/:pledgeId/release", perms.Update, h.ReleaseBankPledge)
	// Voiding rewrites cash history, so it is restricted to management roles —
	// an operator who mis-picked a cash treatment asks a manager to void it.
	rg.PUT("/:id/bank-pledge/:pledgeId/void",
		platform.RequireAnyRole("Administrator", "Management", "Branch Manager"),
		perms.Update, h.VoidBankPledge)

	rg.POST("/:id/extension-request", perms.Update, h.CreateExtensionRequest)
	rg.POST("/:id/release-request", perms.Update, h.CreateReleaseRequest)
	rg.GET("/requests", perms.Read, h.ListRequests)
	rg.PUT("/requests/:requestId/decide", perms.Update, h.DecideRequest)
	rg.PUT("/requests/:requestId/verify", perms.Update, h.VerifyReleaseChecklist)
	rg.POST("/requests/:requestId/approve", perms.Update, h.ApproveRequest)
	rg.POST("/:id/complete-release", perms.Update, h.CompleteRelease)
}
