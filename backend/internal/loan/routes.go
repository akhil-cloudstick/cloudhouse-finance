package loan

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the loan endpoints under the given group (expected
// to be something like r.Group(ctx, "/api/v1/loans")). perms gates every route by
// the "can view/create/update/delete loan" set — ornaments, approvals, payments,
// requests and auctions are all facets of a loan record and share that
// permission group. bankPledgePerms gates only the bank-pledge sub-routes
// with their own "can view/create/update/delete bank pledge" set (a
// distinct module in the permission catalogue, even though the routes are
// physically mounted here alongside everything else loan-shaped).
// hardDeletePerm gates ONLY the hard-delete route, independently of the
// ordinary "can delete loan" grant above — see authz.Catalogue's own
// comment on "can hard delete loan" for why this is deliberately separate.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares, bankPledgePerms platform.CRUDMiddlewares, hardDeletePerm gin.HandlerFunc) {
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
	// Gold-value risk assessment — see Service.ListLoanRiskAssessment's own
	// doc comment. Read-gated: it shows nothing derived from data the loan
	// list screen doesn't already expose, just a different lens on it.
	rg.GET("/risk-assessment", perms.Read, h.ListRiskAssessment)
	rg.GET("/:id", perms.Read, h.Get)
	// Editable even after final sanction — see Service.UpdateLoan's own doc
	// comment for exactly what this does and doesn't change.
	rg.PATCH("/:id", perms.Update, h.UpdateLoan)
	// Customer-facing account statement PDF. Read-gated: it shows nothing
	// the loan detail screen does not already show.
	rg.GET("/:id/statement", perms.Read, h.Statement)

	rg.POST("/:id/ornaments", perms.Update, h.AddOrnament)
	rg.PUT("/ornaments/:ornamentId", perms.Update, h.UpdateOrnament)
	rg.DELETE("/ornaments/:ornamentId", perms.Update, h.DeleteOrnament)
	rg.POST("/ornaments/:ornamentId/purity-test", perms.Update, h.RecordPurityTest)
	rg.POST("/ornaments/:ornamentId/images", perms.Update, h.AddOrnamentImage)

	rg.POST("/:id/approve", perms.Update, h.Approve)
	rg.GET("/:id/approvals", perms.Read, h.ListApprovals)

	rg.POST("/:id/indemnity-bond/esign/start", perms.Update, h.StartIndemnityBondEsign)
	rg.GET("/:id/indemnity-bond/esign/status", perms.Read, h.CheckIndemnityBondEsign)
	rg.GET("/:id/indemnity-bond/pdf", perms.Read, h.DownloadIndemnityBondPDF)
	// Pre-submission preview (New Loan's own "Pledge Agreement" button) —
	// gated the same as Create since it's only reachable from that page,
	// which already requires "can create loan" to render at all.
	rg.POST("/indemnity-bond/preview-pdf", perms.Create, h.PreviewIndemnityBondPDF)

	rg.GET("/approval-limits/loan-operator", perms.Read, h.GetLoanOperatorApprovalLimit)
	rg.PUT("/approval-limits/loan-operator", perms.Update, h.SetLoanOperatorApprovalLimit)

	rg.POST("/:id/payments", perms.Update, h.RecordPayment)

	// Auctions are gated by the same "can view/create/update/delete loan" set
	// as every other loan sub-resource — the house role-permission standard
	// deliberately collapses what used to be a hardcoded role allowlist
	// (Administrator/Management/Branch Manager/Auction Administrator) into
	// this one on/off grant per role, editable from the permissions admin
	// screen instead of a code change.
	rg.GET("/auctions/concluded", perms.Read, h.ListConcludedAuctions)
	rg.GET("/auctions/decisions/pending", perms.Read, h.ListPendingAuctionDecisions)

	rg.GET("/:id/auction", perms.Read, h.GetAuction)
	rg.GET("/:id/auction/history", perms.Read, h.GetAuctionHistory)
	rg.POST("/:id/auction/eligible", perms.Update, h.MarkAuctionEligible)
	rg.POST("/:id/auction/notice", perms.Update, h.IssueAuctionNotice)
	rg.POST("/:id/auction/schedule", perms.Update, h.ScheduleAuction)
	rg.POST("/:id/auction/sale", perms.Update, h.RecordAuctionSale)
	rg.POST("/:id/auction/settle", perms.Update, h.SettleAuction)
	// Which roles may actually DECIDE is enforced in the service, because it
	// differs per escalation kind: an Auction Administrator may resolve a
	// part-payment decision but not a shortfall write-off.
	rg.POST("/:id/auction/decision", perms.Update, h.ResolveAuctionDecision)

	// Bank pledge routes are gated by their own "can view/create/update/delete bank
	// change bank pledge" pair, a distinct module in the permission
	// catalogue from ordinary loan viewing/editing — including void, which
	// used to carry an extra hardcoded role allowlist; that authority is now
	// just "can update bank pledge" for the role, same as create/release.
	rg.GET("/bank-pledges/history", bankPledgePerms.Read, h.ListBankPledgeHistory)
	rg.POST("/:id/bank-pledge", bankPledgePerms.Update, h.RecordBankPledge)
	rg.GET("/:id/bank-pledge/history", bankPledgePerms.Read, h.GetBankPledgeHistory)
	rg.PUT("/:id/bank-pledge/:pledgeId/release", bankPledgePerms.Update, h.ReleaseBankPledge)
	rg.PUT("/:id/bank-pledge/:pledgeId/void", bankPledgePerms.Update, h.VoidBankPledge)

	rg.POST("/:id/extension-request", perms.Update, h.CreateExtensionRequest)
	rg.POST("/:id/release-request", perms.Update, h.CreateReleaseRequest)
	rg.GET("/requests", perms.Read, h.ListRequests)
	rg.PUT("/requests/:requestId/decide", perms.Update, h.DecideRequest)
	rg.PUT("/requests/:requestId/verify", perms.Update, h.VerifyReleaseChecklist)
	rg.POST("/requests/:requestId/release-payment", perms.Update, h.RecordReleasePayment)
	rg.POST("/requests/:requestId/approve", perms.Update, h.ApproveRequest)
	rg.POST("/:id/complete-release", perms.Update, h.CompleteRelease)

	// Hard delete — see Service.HardDeleteLoan's own doc comment for the
	// full cascade. Gated by its own dedicated permission, not perms.Delete.
	rg.DELETE("/:id/hard-delete", hardDeletePerm, h.HardDeleteLoan)
}
