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

// List returns every flow with this tenant's chain resolved —
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

// Categories returns every category with its chains, for the admin screen —
// GET /approval-workflow/categories.
func (h *Handler) Categories(c *gin.Context) {
	ctx := platform.RequestContext(c)
	cats, err := h.svc.Categories(ctx)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, cats)
}

// UpdateCategory stores one category's mode and chains —
// PUT /approval-workflow/categories/:category.
func (h *Handler) UpdateCategory(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req UpdateCategoryInput
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	view, err := h.svc.UpdateCategory(ctx, c.Param("category"), req)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, view)
}
