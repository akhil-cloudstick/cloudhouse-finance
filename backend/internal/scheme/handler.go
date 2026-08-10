package scheme

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
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
	InterestRate   float64 `json:"interestRate" binding:"required"`
	StartDate      string  `json:"startDate" binding:"required"` // RFC3339 / "2006-01-02"
	EndDate        string  `json:"endDate" binding:"required"`
	LTVPercent     float64 `json:"ltvPercent" binding:"required"`
	InterestMethod string  `json:"interestMethod"`
	PenalRate      float64 `json:"penalRate"`
	Conditions     string  `json:"conditions"`
	IsActive       bool    `json:"isActive"`
}

func parseDate(s string) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, s)
}

func (req schemeRequest) toInput() (CreateInput, error) {
	start, err := parseDate(req.StartDate)
	if err != nil {
		return CreateInput{}, errors.New("invalid startDate: expected YYYY-MM-DD")
	}
	end, err := parseDate(req.EndDate)
	if err != nil {
		return CreateInput{}, errors.New("invalid endDate: expected YYYY-MM-DD")
	}
	return CreateInput{
		Name:           req.Name,
		InterestRate:   req.InterestRate,
		StartDate:      start,
		EndDate:        end,
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
	case errors.Is(err, ErrInvalidDates), errors.Is(err, ErrInvalidLTV),
		errors.Is(err, ErrInvalidRate), errors.Is(err, ErrOutsideWindow),
		errors.Is(err, ErrInvalidWeight), errors.Is(err, ErrInvalidGoldRt):
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
	rec, err := h.svc.Create(input)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	rec, err := h.svc.List(c.Query("q"))
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
	rec, err := h.svc.Get(id)
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
	rec, err := h.svc.Update(id, input)
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
	if err := h.svc.Delete(id); err != nil {
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
