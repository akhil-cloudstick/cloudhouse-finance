package goldrate

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

// publishRequest is the JSON body accepted by POST /gold-rates. Only the
// 24K benchmark is published — see this package's doc comment.
type publishRequest struct {
	Date  string  `json:"date"` // optional, "YYYY-MM-DD" — defaults to today
	K24   float64 `json:"k24" binding:"required"`
	SetBy string  `json:"setBy" binding:"required"`
}

func (req publishRequest) toInput() (PublishInput, error) {
	var date time.Time
	if req.Date != "" {
		parsed, err := time.Parse("2006-01-02", req.Date)
		if err != nil {
			return PublishInput{}, httpx.NewBadRequest("invalid date: expected YYYY-MM-DD")
		}
		date = parsed
	}
	return PublishInput{Date: date, K24: req.K24, SetBy: req.SetBy}, nil
}

func (h *Handler) Publish(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req publishRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	input, err := req.toInput()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Publish(ctx, input)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.List(ctx, limit+1, offset)
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

	rec, _, err := h.svc.List(ctx, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Latest(c *gin.Context) {
	ctx := platform.RequestContext(c)
	rec, err := h.svc.Latest(ctx)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(ctx, id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}
