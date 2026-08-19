package scheme

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// schemeRequest is the JSON body accepted by create/update.
type schemeRequest struct {
	Name           string  `json:"name" binding:"required"`
	BranchID       uint    `json:"branchId"`
	InterestRate   float64 `json:"interestRate" binding:"required"`
	DurationMonths int     `json:"durationMonths" binding:"required"`
	LTVPercent     float64 `json:"ltvPercent" binding:"required"`
	InterestMethod string  `json:"interestMethod"`
	PenalRate      float64 `json:"penalRate"`
	Conditions     string  `json:"conditions"`
	IsActive       bool    `json:"isActive"`
}

func (req schemeRequest) toInput() CreateInput {
	return CreateInput{
		Name:           req.Name,
		BranchID:       req.BranchID,
		InterestRate:   req.InterestRate,
		DurationMonths: req.DurationMonths,
		LTVPercent:     req.LTVPercent,
		InterestMethod: req.InterestMethod,
		PenalRate:      req.PenalRate,
		Conditions:     req.Conditions,
		IsActive:       req.IsActive,
	}
}

func (h *Handler) Create(c *gin.Context) {
	var req schemeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	input := req.toInput()
	input.BranchID = platform.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := h.svc.Create(input)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	rec, err := h.svc.List(c.Query("q"), platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// ListActive mirrors customer.Handler.List's pagination convention: plain
// array when `limit` is absent (unchanged for existing callers), {items,
// hasMore} envelope when present (the paginated SearchableSelect in
// NewLoan.tsx) — both now sit under the outer {success, data} envelope.
func (h *Handler) ListActive(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	branchID := platform.GetBranchScope(c)

	if limit <= 0 {
		rec, err := h.svc.ListActive(c.Query("q"), branchID, 0, 0)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, rec)
		return
	}

	rec, err := h.svc.ListActive(c.Query("q"), branchID, limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore})
}

func (h *Handler) ListInactive(c *gin.Context) {
	rec, err := h.svc.ListInactive()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Get(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Update(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req schemeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	input := req.toInput()
	input.BranchID = platform.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := h.svc.Update(id, input, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Delete(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if err := h.svc.Delete(id, platform.GetBranchScope(c)); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Scheme deleted successfully")
}

func (h *Handler) ToggleActive(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.ToggleActive(id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type calculateRequest struct {
	GoldWeight float64 `json:"goldWeight" binding:"required"`
	GoldRate   float64 `json:"goldRate" binding:"required"`
}

func (h *Handler) Calculate(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req calculateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	result, err := h.svc.Calculate(id, req.GoldWeight, req.GoldRate)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, result)
}
