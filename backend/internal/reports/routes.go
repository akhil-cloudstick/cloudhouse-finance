package reports

import (
	"strings"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/tenant"
)

// RegisterRoutes mounts every report's JSON listing endpoint plus the
// shared :key/export endpoint, under rg (expected to be
// r.Group(ctx, "/api/v1/reports")), gated by "can view report" — reports has no
// write side, so perms only ever carries a Read gate (see
// platform.CRUDPermissions, which leaves Create/Update/Delete nil for the
// "reports" resource).
//
// tenantRepo gates the Personal Loans and Investments reports specifically —
// same optional-module rule as the pages/API routes those product lines
// mount elsewhere (see internal/app/app.go): a business without the module
// should not see its reports exist either, not just be unable to open the
// page they're reached from.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares, tenantRepo *tenant.Repository) {
	rg.Use(perms.Read)

	personalLoansGate := platform.RequireTenantModule(tenantRepo, tenant.ModulePersonalLoans)
	investmentsGate := platform.RequireTenantModule(tenantRepo, tenant.ModuleInvestments)

	rg.GET("/disbursement", h.Disbursement)
	rg.GET("/personal-loans", personalLoansGate, h.PersonalLoans)
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
	rg.GET("/investments/deposit-register", investmentsGate, h.DepositRegister)
	rg.GET("/investments/interest-payout-register", investmentsGate, h.InterestPayoutRegister)
	rg.GET("/investments/maturity-register", investmentsGate, h.MaturityRegister)
	rg.GET("/investments/investor-ledger", investmentsGate, h.InvestorLedger)
	rg.GET("/balance-sheet", h.BalanceSheet)
	rg.GET("/profit-loss", h.ProfitAndLoss)

	// Export lives under its own static "/export" prefix rather than
	// "/:key/export" — gin's routing tree cannot mix a wildcard segment
	// with the static "loans"/"gold-weight"/etc. segments registered above
	// at the same level, so a top-level ":key" wildcard would panic at
	// startup. :key matches each report's URL segment above (e.g.
	// "disbursement", "loans-status" for the /loans/status report — see
	// reportRows in export.go for the exact key list). Since one route
	// serves every key, the module gate has to run INSIDE the handler
	// rather than as route-registration middleware — exportModuleGate below
	// does that by inspecting :key before Export runs.
	rg.GET("/export/:key", exportModuleGate(personalLoansGate, investmentsGate), h.Export)
}

// exportModuleGate wraps the shared export handler with the same per-report
// module checks the JSON endpoints get, keyed off the :key param the JSON
// routes don't need (each of those is its own static path). Falls through
// (no gate) for every key outside the two closed prefixes below — every
// other report has no optional-module restriction.
func exportModuleGate(personalLoansGate, investmentsGate gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.Param("key")
		switch {
		case key == "personal-loans":
			personalLoansGate(c)
		case strings.HasPrefix(key, "investments-"):
			investmentsGate(c)
		}
	}
}
