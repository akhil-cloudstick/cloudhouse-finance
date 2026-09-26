package settings

import (
	"net/http"
	"strconv"
	"strings"

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

type setRequest struct {
	Name  string `json:"name"`
	Value string `json:"value" binding:"required"`
}

// List returns every known category (configured or not) — GET /settings/api-keys.
//
// q matches the category (the provider slot, e.g. "sms", "whatsapp") or the
// admin's own key label — never the secret value. Opt-in pagination: no
// limit returns the bare array (the original shape); limit > 0 returns
// {items, hasMore, total}. The set is a fixed handful of categories, so
// both are applied in memory after Service.List.
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	views, err := h.svc.List(ctx)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	views = filterApiKeyViews(views, c.Query("q"))

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		total := len(views)
		if offset > total {
			offset = total
		}
		end := offset + limit
		if end > total {
			end = total
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": views[offset:end], "hasMore": end < total, "total": total})
		return
	}
	httpx.Success(c, http.StatusOK, views)
}

// filterApiKeyViews keeps views whose Category or Name contains q
// (case-insensitive); an empty q keeps all.
func filterApiKeyViews(views []ApiKeyView, q string) []ApiKeyView {
	needle := strings.ToLower(strings.TrimSpace(q))
	if needle == "" {
		return views
	}
	kept := make([]ApiKeyView, 0, len(views))
	for _, v := range views {
		if strings.Contains(strings.ToLower(string(v.Category)), needle) ||
			strings.Contains(strings.ToLower(v.Name), needle) {
			kept = append(kept, v)
		}
	}
	return kept
}

// Get returns one category — GET /settings/api-keys/:category.
func (h *Handler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	category := Category(c.Param("category"))
	view, err := h.svc.Get(ctx, category)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, view)
}

// Set creates/updates a category's key — PUT /settings/api-keys/:category.
func (h *Handler) Set(c *gin.Context) {
	ctx := platform.RequestContext(c)
	category := Category(c.Param("category"))
	var req setRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	view, err := h.svc.Set(ctx, category, SetInput{Name: req.Name, Value: req.Value})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, view)
}

// Delete clears a category's stored key — DELETE /settings/api-keys/:category.
func (h *Handler) Delete(c *gin.Context) {
	ctx := platform.RequestContext(c)
	category := Category(c.Param("category"))
	if err := h.svc.Delete(ctx, category); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Setting cleared successfully")
}
