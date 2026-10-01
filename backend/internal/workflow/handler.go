package workflow

import (
	"net/http"

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

// List returns every flow with this tenant's stage settings —
// GET /approval-workflow.
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	flows, err := h.svc.Config(ctx)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, flows)
}

type updateRequest struct {
	// Stages maps stage key → enabled.
	Stages map[string]bool `json:"stages" binding:"required"`
}

// Update stores one flow's stage settings — PUT /approval-workflow/:flow.
func (h *Handler) Update(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	view, err := h.svc.Update(ctx, c.Param("flow"), req.Stages)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, view)
}
