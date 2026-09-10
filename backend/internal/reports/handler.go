package reports

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
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
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.Disbursement(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) LoansStatus(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.LoanStatus(f, c.Query("status"))
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) InterestCollection(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.InterestCollection(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) OutstandingPrincipal(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.OutstandingPrincipal(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) PaymentCollection(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.PaymentCollection(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) GoldWeight(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.GoldWeight(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) Packets(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.Packets(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) BankPledge(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.BankPledge(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) LoanExtensions(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.LoanExtensions(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) GoldRelease(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.GoldRelease(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) Auctions(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.Auctions(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) ExpenseCashflow(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.ExpenseCashflow(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) KYC(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.KYC(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) GoldRateHistory(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.GoldRateHistory(f)
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}

func (h *Handler) EmployeePerformance(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.EmployeePerformance(f)
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
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}
	rows, totals, err := h.svc.CommunicationHistory(f, c.Query("trigger_type"))
	if err != nil {
		serverError(c, err)
		return
	}
	respond(c, rows, totals, f)
}
