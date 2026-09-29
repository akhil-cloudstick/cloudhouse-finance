package packet

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// loanNoLongerMovableStatuses mirrors loan.bankPledgeIneligibleStatuses'
// rationale but for packet movement specifically: once a loan lands in one
// of these, its gold has either been sold (Auctioned/AuctionedBalanceDue)
// or already handed back to the customer (Closed) — nothing about where
// it physically sits is staff's to change by hand any more.
var loanNoLongerMovableStatuses = map[string]bool{
	loan.StatusAuctioned:           true,
	loan.StatusAuctionedBalanceDue: true,
	loan.StatusClosed:              true,
	loan.StatusRejected:            true,
}

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var f Filter
	if v := c.Query("loanId"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LoanID = uint(n)
		}
	}
	f.BranchID = platform.GetBranchScope(c)
	if v := c.Query("lockerId"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LockerID = uint(n)
		}
	}
	f.Status = c.Query("status")
	f.Q = strings.TrimSpace(c.Query("q"))

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		f.Limit, f.Offset = limit+1, offset
		rec, total, err := h.svc.List(ctx, f)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		return
	}

	recs, _, err := h.svc.List(ctx, f)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

func (h *Handler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(ctx, id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) GetByCode(c *gin.Context) {
	ctx := platform.RequestContext(c)
	rec, err := h.svc.GetByCode(ctx, c.Param("code"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) ListMovements(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	recs, err := h.svc.ListMovements(ctx, id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

type movementRequest struct {
	ToStatus   string `json:"toStatus" binding:"required"`
	LockerID   *uint  `json:"lockerId"`
	EmployeeID uint   `json:"employeeId"`
	Remarks    string `json:"remarks"`
}

func (h *Handler) RecordMovement(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req movementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	p, err := h.svc.Get(ctx, id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if loanNoLongerMovableStatuses[p.Loan.Status] {
		httpx.FailErr(c, ErrLoanNoLongerMovable)
		return
	}
	rec, err := h.svc.RecordMovement(ctx, id, req.ToStatus, req.LockerID, req.EmployeeID, req.Remarks)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}
