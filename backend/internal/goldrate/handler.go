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

// publishRequest is the JSON body accepted by POST /gold-rates. `karat`
// defaults to 24 when omitted, so existing callers that only ever sent
// {k24, setBy} (a plain 24K-only publish) keep working unchanged; `rate`
// falls back to `k24` for the same reason. New Manual/Auto-mode callers
// (RateModalContent) send {karat, rate, setBy} for whichever karat is
// being set this time — see PublishInput's doc comment for what happens
// to the other two columns.
type publishRequest struct {
	Date  string  `json:"date"` // optional, "YYYY-MM-DD" — defaults to today
	Karat int     `json:"karat"`
	Rate  float64 `json:"rate"`
	K24   float64 `json:"k24"` // legacy alias for {karat:24, rate: k24}
	SetBy string  `json:"setBy" binding:"required"`
	// Rates publishes several karats as one row, e.g. {"22": 11827, "18": 9676}.
	Rates map[int]float64 `json:"rates"`
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
	if len(req.Rates) > 0 {
		return PublishInput{Date: date, Rates: req.Rates, SetBy: req.SetBy}, nil
	}
	karat := req.Karat
	rate := req.Rate
	if karat == 0 {
		karat = 24
	}
	if rate == 0 {
		rate = req.K24
	}
	return PublishInput{Date: date, Karat: karat, Rate: rate, SetBy: req.SetBy}, nil
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
