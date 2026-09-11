package reports

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler wires HTTP requests to Service, binding the common from/to/
// branch_id/page/page_size query params (see Filter) plus each report's own
// extra filter param.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// parseFilter reads the query params every report endpoint shares. branch_id
// falls back to platform.GetBranchScope(c) when the caller doesn't supply
// one explicitly, so a non-Administrator's own branch scope is still
// enforced even if the frontend forgets to pass branch_id.
func parseFilter(c *gin.Context) (Filter, error) {
	var f Filter
	if v := c.Query("from"); v != "" {
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return Filter{}, err
		}
		f.From = &t
	}
	if v := c.Query("to"); v != "" {
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return Filter{}, err
		}
		f.To = &t
	}
	if v := c.Query("branch_id"); v != "" {
		id, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return Filter{}, err
		}
		branchID := uint(id)
		f.BranchID = &branchID
	} else {
		f.BranchID = platform.GetBranchScope(c)
	}
	f.Page = 1
	if v := c.Query("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			f.Page = n
		}
	}
	f.PageSize = 10
	if v := c.Query("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			f.PageSize = n
		}
	}
	return f, nil
}

func badRequest(c *gin.Context, err error) {
	httpx.Fail(c, http.StatusBadRequest, err.Error())
}

func serverError(c *gin.Context, err error) {
	httpx.FailErr(c, err)
}

// respond applies pagination (JSON list endpoints only — export endpoints
// call the service directly and skip this) and writes the common envelope,
// itself wrapped in the outer {success, data} envelope.
func respond[T any](c *gin.Context, rows []T, totals any, f Filter) {
	page, total := Paginate(rows, f)
	httpx.Success(c, http.StatusOK, Result{Rows: page, Totals: totals, TotalCount: total})
}

func (h *Handler) Disbursement(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.Disbursement(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) DepositRegister(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.DepositRegister(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) InterestPayoutRegister(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.InterestPayoutRegister(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) MaturityRegister(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.MaturityRegister(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

// InvestorLedger returns one investor's full statement — requires a
// customer_id query param (a detail view, not a date-scoped register).
func (h *Handler) InvestorLedger(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := strconv.ParseUint(c.Query("customer_id"), 10, 64)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.InvestorLedger(ctx, uint(customerID))
	if err != nil {
		serverError(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, Result{Rows: rows, Totals: totals, TotalCount: len(rows)})
}

func (h *Handler) LoansStatus(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.LoanStatus(ctx, f, c.Query("status"))
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) InterestCollection(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.InterestCollection(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) OutstandingPrincipal(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.OutstandingPrincipal(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) PaymentCollection(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.PaymentCollection(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) GoldWeight(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.GoldWeight(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) Packets(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.Packets(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) BankPledge(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.BankPledge(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) LoanExtensions(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.LoanExtensions(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) GoldRelease(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.GoldRelease(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) Auctions(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.Auctions(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) ExpenseCashflow(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.ExpenseCashflow(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) KYC(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.KYC(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) GoldRateHistory(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.GoldRateHistory(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) EmployeePerformance(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.EmployeePerformance(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) PersonalLoans(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.PersonalLoans(ctx, f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) TradeSheet(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.TradeSheet(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) BalanceSheet(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.BalanceSheet(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) CommunicationHistory(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.CommunicationHistory(ctx, f, c.Query("trigger_type"))
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}
