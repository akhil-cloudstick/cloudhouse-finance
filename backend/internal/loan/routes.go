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
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares, bankPledgePerms platform.CRUDMiddlewares, hardDeletePerm gin.HandlerFunc, auctionView gin.HandlerFunc, topUpPerm gin.HandlerFunc) {
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
	rg.GET("/next-number", perms.Read, h.NextNumber)
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
	rg.GET("/:id/statement", perms.Read, perms.Export, h.Statement)
	// Single-loan payment ledger drill-down — the universal-ledger pattern's
	// loan-scoped counterpart of cash's /transactions/bank|customer|branch
	// routes, but querying LoanPayment rows for this one loan rather than
	// cross-entity CashMovement rows. Read-gated like Statement above.
	rg.GET("/:id/ledger", perms.Read, h.GetLedger)

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
	rg.GET("/:id/release-agreement/pdf", perms.Read, h.DownloadReleaseAgreementPDF)
	// Pre-submission preview (New Loan's own "Pledge Agreement" button) —
	// gated the same as Create since it's only reachable from that page,
	// which already requires "can create loan" to render at all.
	rg.POST("/indemnity-bond/preview-pdf", perms.Create, h.PreviewIndemnityBondPDF)


	rg.POST("/:id/payments", perms.Update, h.RecordPayment)

	// Top-up is a mutation on an existing loan resource, not a new one — no
	// new catalogue entry, same "can update loan" permission as payments.
	// Its own "can top up loan" grant — deliberately not "can update loan".
	rg.POST("/:id/topup", perms.Read, topUpPerm, h.TopUpLoan)
	rg.GET("/:id/topups", perms.Read, h.ListTopUps)
	// Which stage (if any) a Pending top-up needs is per-tenant configuration
	// (workflow.FlowLoanTopUp); the stage permission is checked in the service.
	rg.POST("/topups/:topUpId/approve", perms.Update, h.ApproveTopUp)

	// Auctions ride on the loan permission set like every other loan
	// sub-resource, plus "can view auction module" (auctionView) so a role can
	// see loans without seeing auction cases. Each step is additionally
	// service-checked against its own Auction Workflow permission.
	rg.GET("/auctions/concluded", perms.Read, auctionView, h.ListConcludedAuctions)
	rg.GET("/auctions/decisions/pending", perms.Read, auctionView, h.ListPendingAuctionDecisions)

	rg.GET("/:id/auction", perms.Read, auctionView, h.GetAuction)
	rg.GET("/:id/auction/history", perms.Read, auctionView, h.GetAuctionHistory)
	rg.POST("/:id/auction/eligible", perms.Update, auctionView, h.MarkAuctionEligible)
	rg.POST("/:id/auction/notice", perms.Update, auctionView, h.IssueAuctionNotice)
	rg.POST("/:id/auction/schedule", perms.Update, auctionView, h.ScheduleAuction)
	rg.POST("/:id/auction/sale", perms.Update, auctionView, h.RecordAuctionSale)
	rg.POST("/:id/auction/settle", perms.Update, auctionView, h.SettleAuction)
	// Which roles may actually DECIDE is enforced in the service, because it
	// differs per escalation kind: an Auction Administrator may resolve a
	// part-payment decision but not a shortfall write-off.
	rg.POST("/:id/auction/decision", perms.Update, auctionView, h.ResolveAuctionDecision)

	// Bank pledge routes are gated by their own "can view/create/update/delete bank
	// change bank pledge" pair, a distinct module in the permission
	// catalogue from ordinary loan viewing/editing — including void, which
	// used to carry an extra hardcoded role allowlist; that authority is now
	// just "can update bank pledge" for the role, same as create/release.
	rg.GET("/bank-pledges/history", bankPledgePerms.Read, h.ListBankPledgeHistory)
	rg.POST("/:id/bank-pledge", bankPledgePerms.Create, h.RecordBankPledge)
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
	rg.GET("/requests/:requestId/partial-release-receipt/pdf", perms.Read, h.DownloadPartialReleaseReceiptPDF)

	// Hard delete — see Service.HardDeleteLoan's own doc comment for the
	// full cascade. Gated by its own dedicated permission, not perms.Delete.
	rg.DELETE("/:id/hard-delete", hardDeletePerm, h.HardDeleteLoan)
}
