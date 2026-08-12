package scheme

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
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

func (req schemeRequest) toInput() (CreateInput, error) {
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
	}, nil
}

func idParam(c *gin.Context) (uint, error) {
	v, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return 0, errors.New("invalid id")
	}
	return uint(v), nil
}

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrInvalidDuration), errors.Is(err, ErrInvalidLTV),
		errors.Is(err, ErrInvalidRate),
		errors.Is(err, ErrInvalidWeight), errors.Is(err, ErrInvalidGoldRt),
		errors.Is(err, ErrBranchReq), errors.Is(err, ErrBranchInvalid):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (h *Handler) Create(c *gin.Context) {
	var req schemeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input, err := req.toInput()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.BranchID = platform.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := h.svc.Create(input)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	rec, err := h.svc.List(c.Query("q"), platform.GetBranchScope(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// ListActive mirrors customer.Handler.List's pagination convention: plain
// array when `limit` is absent (unchanged for existing callers), {items,
// hasMore} envelope when present (the paginated SearchableSelect in
// NewLoan.tsx).
func (h *Handler) ListActive(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	if limit <= 0 {
		rec, err := h.svc.ListActive(c.Query("q"), 0, 0)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, rec)
		return
	}

	rec, err := h.svc.ListActive(c.Query("q"), limit+1, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	c.JSON(http.StatusOK, gin.H{"items": rec, "hasMore": hasMore})
}

func (h *Handler) ListInactive(c *gin.Context) {
	rec, err := h.svc.ListInactive()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Get(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Update(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req schemeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input, err := req.toInput()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.BranchID = platform.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := h.svc.Update(id, input, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Delete(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Delete(id, platform.GetBranchScope(c)); err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ToggleActive(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.ToggleActive(id)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

type calculateRequest struct {
	GoldWeight float64 `json:"goldWeight" binding:"required"`
	GoldRate   float64 `json:"goldRate" binding:"required"`
}

func (h *Handler) Calculate(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req calculateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, err := h.svc.Calculate(id, req.GoldWeight, req.GoldRate)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
