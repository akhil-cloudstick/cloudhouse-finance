package cash

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterMovementRoutes mounts the cash-movement endpoints under the given
// group (expected to be something like r.Group(ctx, "/api/v1/cash-movements")).
// perms gates each verb by CRUD action against the "cash" resource
// (cash-movements/expenses/opening-balance/summary all share one "cash"
// resource key, per the permission plan).
func RegisterMovementRoutes(rg *gin.RouterGroup, h *MovementHandler, perms platform.CRUDMiddlewares, branchLedger gin.HandlerFunc) {
	rg.POST("", perms.Create, h.Record)
	rg.GET("", perms.Read, h.List)
	rg.GET("/export", perms.Read, perms.Export, h.Export)
	// Party Transactions drill-down — reuses the same can_view_cash
	// permission as every other read here (it's a drill-down of data the
	// user can already see on the Cash page, not a new resource).
	rg.GET("/transactions/bank/:bankId", perms.Read, perms.ExportQuery, h.ListByBank)
	rg.GET("/transactions/bank/:bankId/export", perms.Read, perms.Export, h.ExportByBank)
	rg.GET("/transactions/customer/:customerId", perms.Read, perms.ExportQuery, h.ListByCustomer)
	rg.GET("/transactions/customer/:customerId/export", perms.Read, perms.Export, h.ExportByCustomer)
	rg.GET("/transactions/branch/:id", branchLedger, perms.ExportQuery, h.ListByBranch)
	rg.GET("/transactions/branch/:id/export", branchLedger, perms.Export, h.ExportByBranch)
	// Cash Ledger — the Cash-mode-only sub-ledger drill-down (see
	// MovementHandler.GetCashLedger's doc comment). Registered before /:id so
	// the literal "cash-ledger" segment isn't swallowed by that param route.
	rg.GET("/cash-ledger", perms.Read, perms.ExportQuery, h.GetCashLedger)
	// Generic per-payment-mode ledger drill-down (see
	// MovementHandler.GetModeLedger's doc comment) — ?mode=UPI|Bank
	// Transfer|Cheque|Cash, optionally &bankId=. Also registered before /:id.
	rg.GET("/mode-ledger", perms.Read, perms.ExportQuery, h.GetModeLedger)
	// Distinct loan numbers already recorded as a "Loan" cash source — the
	// Add Cash Loan Number picker. Registered before /:id.
	rg.GET("/loan-sources", perms.Read, h.ListLoanSources)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PATCH("/:id/status", perms.Update, h.SetStatus)
}

// RegisterExpenseRoutes mounts the expense endpoints under the given group
// (expected to be something like r.Group(ctx, "/api/v1/expenses")).
func RegisterExpenseRoutes(rg *gin.RouterGroup, h *ExpenseHandler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Record)
	rg.GET("", perms.Read, h.List)
	rg.GET("/export", perms.Read, perms.Export, h.Export)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PATCH("/:id/approve", perms.Update, h.Approve)
	rg.PATCH("/:id/reject", perms.Update, h.Reject)
}

// RegisterCashSourceRoutes mounts the cash-source lookup-list endpoints
// under the given group (expected to be r.Group(ctx, "/api/v1/cash-sources"))
// — backs AddCashModal.tsx's "Source of Cash" picker. Shares the "cash"
// resource permission, same as every other Cash & Expenses endpoint.
func RegisterCashSourceRoutes(rg *gin.RouterGroup, h *CashSourceHandler, perms platform.CRUDMiddlewares) {
	rg.GET("", perms.Read, h.List)
	rg.POST("", perms.Create, h.Create)
	rg.GET("/:id", perms.Read, h.Get)
	// A loan source's own ledger (principal → draws → repayments).
	rg.GET("/:id/ledger", perms.Read, perms.ExportQuery, h.GetLedger)
}

// RegisterExpenseCategoryRoutes mounts the expense-category lookup-list
// endpoints under the given group (expected to be r.Group(ctx,
// "/api/v1/expense-categories")) — backs ExpenseModal.tsx's Category picker.
func RegisterExpenseCategoryRoutes(rg *gin.RouterGroup, h *ExpenseCategoryHandler, perms platform.CRUDMiddlewares) {
	rg.GET("", perms.Read, h.List)
	rg.POST("", perms.Create, h.Create)
}

// RegisterCashRoutes mounts the opening-balance and summary endpoints under
// the given group (expected to be r.Group(ctx, "/api/v1/cash")).
func RegisterCashRoutes(rg *gin.RouterGroup, ob *OpeningBalanceHandler, summary *SummaryHandler, perms platform.CRUDMiddlewares) {
	rg.POST("/opening-balance", perms.Create, ob.Set)
	rg.GET("/opening-balance", perms.Read, ob.Get)
	rg.GET("/summary", perms.Read, summary.Get)
}

// RegisterGoldSaleRoutes mounts the gold-sale endpoints under the given
// group (expected to be something like r.Group(ctx, "/api/v1/gold-sales")).
// Shares the "cash" resource permission, same as every other Cash & Expenses
// endpoint above.
func RegisterGoldSaleRoutes(rg *gin.RouterGroup, h *GoldSaleHandler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Record)
	rg.GET("", perms.Read, h.List)
	rg.GET("/:id", perms.Read, h.Get)
}
