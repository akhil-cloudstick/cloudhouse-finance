package settings

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform/httpx"
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
func (h *Handler) List(c *gin.Context) {
	views, err := h.svc.List()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, views)
}

// Get returns one category — GET /settings/api-keys/:category.
func (h *Handler) Get(c *gin.Context) {
	category := Category(c.Param("category"))
	view, err := h.svc.Get(category)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, view)
}

// Set creates/updates a category's key — PUT /settings/api-keys/:category.
func (h *Handler) Set(c *gin.Context) {
	category := Category(c.Param("category"))
	var req setRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	view, err := h.svc.Set(category, SetInput{Name: req.Name, Value: req.Value})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, view)
}

// Delete clears a category's stored key — DELETE /settings/api-keys/:category.
func (h *Handler) Delete(c *gin.Context) {
	category := Category(c.Param("category"))
	if err := h.svc.Delete(category); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Setting cleared successfully")
}
