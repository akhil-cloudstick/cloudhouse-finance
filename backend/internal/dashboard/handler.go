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
	ctx := platform.RequestContext(c)
	page, _ := strconv.Atoi(c.Query("page"))
	rec, err := h.svc.GetNeedsAttention(ctx, page, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// LatestSnapshot backs GET /dashboard/snapshots/latest — the KPI counts
// captured by the most recent nightly snapshot (typically "yesterday"),
// used by the mobile dashboard to compute each card's trend vs. today's
// live count. Returns null (200) rather than 404 when no snapshot has been
// captured yet, since that's an expected startup state (first day after
// this feature ships), not an error.
func (h *Handler) LatestSnapshot(c *gin.Context) {
	rec, err := h.svc.LatestSnapshot()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// ListSnapshots backs GET /dashboard/snapshots?limit=&offset= — paginated
// snapshot history, same envelope shape as GET /gold-rates.
func (h *Handler) ListSnapshots(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.ListSnapshots(limit+1, offset)
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

	rec, _, err := h.svc.ListSnapshots(0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}
