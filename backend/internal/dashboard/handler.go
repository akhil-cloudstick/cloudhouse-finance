package dashboard

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

// NeedsAttention backs GET /dashboard/needs-attention?page= — see
// Service.GetNeedsAttention for the merge/order/paginate rules. page is
// 1-based; omitted or <= 0 defaults to page 1.
func (h *Handler) NeedsAttention(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	rec, err := h.svc.GetNeedsAttention(page, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}
