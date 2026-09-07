package bank

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

// List mirrors customer/loan/scheme's pagination convention: plain array
// when `limit` is absent (unchanged for existing callers, e.g. the web
// bank directory and NewLoan.tsx's SearchableSelect), {items, hasMore}
// envelope when present (the mobile app's paginated list).
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	if limit <= 0 {
		rec, _, err := h.svc.List(ctx, c.Query("q"), 0, 0)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, rec)
		return
	}

	rec, total, err := h.svc.List(ctx, c.Query("q"), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

type bankRequest struct {
	Name      string `json:"name"`
	Branch    string `json:"branch"`
	Ifsc      string `json:"ifsc"`
	AccountNo string `json:"accountNo"`
	Phone     string `json:"phone"`
}

func (h *Handler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req bankRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, created, err := h.svc.FindOrCreate(ctx, CreateInput{Name: req.Name, Branch: req.Branch, Ifsc: req.Ifsc, AccountNo: req.AccountNo, Phone: req.Phone})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if created {
		httpx.Success(c, http.StatusCreated, rec)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}
