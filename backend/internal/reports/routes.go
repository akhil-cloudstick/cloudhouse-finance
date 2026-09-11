package reports

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts every report's JSON listing endpoint plus the
// shared :key/export endpoint, under rg (expected to be
// r.Group(ctx, "/api/v1/reports")), gated by "can view report" — reports has no
// write side, so perms only ever carries a Read gate (see
// platform.CRUDPermissions, which leaves Create/Update/Delete nil for the
// "reports" resource).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.Use(perms.Read)

	rg.GET("/disbursement", h.Disbursement)
	rg.GET("/personal-loans", h.PersonalLoans)
	rg.GET("/loans/status", h.LoansStatus)
	rg.GET("/interest-collection", h.InterestCollection)
	rg.GET("/outstanding-principal", h.OutstandingPrincipal)
	rg.GET("/payment-collection", h.PaymentCollection)
	rg.GET("/gold-weight", h.GoldWeight)
	rg.GET("/packets", h.Packets)
	rg.GET("/bank-pledge", h.BankPledge)
	rg.GET("/loan-extensions", h.LoanExtensions)
	rg.GET("/gold-release", h.GoldRelease)
	rg.GET("/auctions", h.Auctions)
	rg.GET("/expense-cashflow", h.ExpenseCashflow)
	rg.GET("/kyc", h.KYC)
	rg.GET("/gold-rate-history", h.GoldRateHistory)
	rg.GET("/employee-performance", h.EmployeePerformance)
	rg.GET("/communication-history", h.CommunicationHistory)
	rg.GET("/form-g", h.FormG)
	rg.GET("/investments/deposit-register", h.DepositRegister)
	rg.GET("/investments/interest-payout-register", h.InterestPayoutRegister)
	rg.GET("/investments/maturity-register", h.MaturityRegister)
	rg.GET("/investments/investor-ledger", h.InvestorLedger)
	rg.GET("/trade-sheet", h.TradeSheet)
	rg.GET("/balance-sheet", h.BalanceSheet)

	// Export lives under its own static "/export" prefix rather than
	// "/:key/export" — gin's routing tree cannot mix a wildcard segment
	// with the static "loans"/"gold-weight"/etc. segments registered above
	// at the same level, so a top-level ":key" wildcard would panic at
	// startup. :key matches each report's URL segment above (e.g.
	// "disbursement", "loans-status" for the /loans/status report — see
	// reportRows in export.go for the exact key list).
	rg.GET("/export/:key", h.Export)
}
