package investment

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// --- Plans ---

type planRequest struct {
	Name                string  `json:"name"`
	InterestRateType    string  `json:"interestRateType"`
	InterestRatePercent float64 `json:"interestRatePercent"`
	PayoutFrequency     string  `json:"payoutFrequency"`
	TenureMonths        int     `json:"tenureMonths"`
	MinPrincipal        float64 `json:"minPrincipal"`
	IsActive            bool    `json:"isActive"`
}

func (h *Handler) CreatePlan(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req planRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.CreatePlan(ctx, PlanInput{
		Name:                req.Name,
		InterestRateType:    req.InterestRateType,
		InterestRatePercent: req.InterestRatePercent,
		PayoutFrequency:     req.PayoutFrequency,
		TenureMonths:        req.TenureMonths,
		MinPrincipal:        req.MinPrincipal,
		IsActive:            req.IsActive,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) UpdatePlan(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req planRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.UpdatePlan(ctx, id, PlanInput{
		Name:                req.Name,
		InterestRateType:    req.InterestRateType,
		InterestRatePercent: req.InterestRatePercent,
		PayoutFrequency:     req.PayoutFrequency,
		TenureMonths:        req.TenureMonths,
		MinPrincipal:        req.MinPrincipal,
		IsActive:            req.IsActive,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) ListPlans(c *gin.Context) {
	ctx := platform.RequestContext(c)
	activeOnly := c.Query("activeOnly") == "true"
	recs, err := h.svc.ListPlans(ctx, activeOnly)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

func (h *Handler) GetPlan(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.GetPlan(ctx, id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// --- Investments ---

type createRequest struct {
	BranchID        uint    `json:"branchId"`
	CustomerID      uint    `json:"customerId"`
	PlanID          uint    `json:"planId"`
	PrincipalAmount float64 `json:"principalAmount"`
	StartDate       string  `json:"startDate"` // RFC3339, optional
}

func (h *Handler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	employeeID, _, _ := platform.ActorFromContext(c)
	branchID := platform.EnforceBranchOnWrite(c, req.BranchID)

	var startDate time.Time
	if req.StartDate != "" {
		if t, err := time.Parse(time.RFC3339, req.StartDate); err == nil {
			startDate = t
		}
	}

	rec, err := h.svc.CreateInvestment(ctx, CreateInput{
		BranchID:            branchID,
		CustomerID:          req.CustomerID,
		PlanID:              req.PlanID,
		PrincipalAmount:     req.PrincipalAmount,
		StartDate:           startDate,
		CreatedByEmployeeID: employeeID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

// List returns one page of investments as the {items, hasMore, total}
// envelope, branch-scoped, optionally filtered by customerId/status and
// searched by investment number or customer name (q) — mirrors
// personalloan.Handler.List.
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID := platform.GetBranchScope(c)
	var customerID *uint
	if v := c.Query("customerId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			cid := uint(id)
			customerID = &cid
		}
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	recs, hasMore, total, err := h.svc.List(ctx, ListInput{
		BranchID:   branchID,
		CustomerID: customerID,
		Status:     c.Query("status"),
		Query:      c.Query("q"),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": recs, "hasMore": hasMore, "total": total})
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

func (h *Handler) Schedule(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	recs, hasMore, err := h.svc.GetSchedule(ctx, id, platform.GetBranchScope(c), limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": recs, "hasMore": hasMore})
}

// MarkPayoutPaid marks one due payout of an investment as paid.
func (h *Handler) MarkPayoutPaid(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	payoutID, err := httpx.IDParam(c, "payoutId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	employeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.MarkPayoutPaid(ctx, id, payoutID, platform.GetBranchScope(c), employeeID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type matureRequest struct {
	Action          string  `json:"action"` // "Close" | "Renew"
	PlanID          uint    `json:"planId"`
	PrincipalAmount float64 `json:"principalAmount"`
}

// Mature applies an admin's maturity decision (Close or Renew) to a Matured
// investment.
func (h *Handler) Mature(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req matureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	employeeID, _, _ := platform.ActorFromContext(c)
	var renewIn *RenewInput
	if req.Action == MaturityActionRenew {
		renewIn = &RenewInput{
			PlanID:              req.PlanID,
			PrincipalAmount:     req.PrincipalAmount,
			CreatedByEmployeeID: employeeID,
		}
	}
	rec, err := h.svc.MatureInvestment(ctx, id, platform.GetBranchScope(c), req.Action, renewIn)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// ListInvestmentsForCustomer returns a customer's investments — mounted
// under /customers/:id/investments, mirrors
// personalloan.Handler.ListLoansForCustomer.
func (h *Handler) ListInvestmentsForCustomer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	// Ownership check BEFORE the list query: the customer must resolve
	// inside the caller's own business. Without it this answers 200 with
	// an empty list for another business's customer id, where every
	// sibling /customers/:id/* route refuses.
	if err := h.svc.EnsureCustomerExists(ctx, id); err != nil {
		httpx.FailErr(c, err)
		return
	}
	recs, _, _, err := h.svc.List(ctx, ListInput{BranchID: platform.GetBranchScope(c), CustomerID: &id, Limit: 1000})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}
