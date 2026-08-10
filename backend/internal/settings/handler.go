package settings

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
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

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrInvalidCategory):
		return http.StatusNotFound
	case errors.Is(err, ErrValueRequired):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

// List returns every known category (configured or not) — GET /settings/api-keys.
func (h *Handler) List(c *gin.Context) {
	views, err := h.svc.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, views)
}

// Get returns one category — GET /settings/api-keys/:category.
func (h *Handler) Get(c *gin.Context) {
	category := Category(c.Param("category"))
	view, err := h.svc.Get(category)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, view)
}

// Set creates/updates a category's key — PUT /settings/api-keys/:category.
func (h *Handler) Set(c *gin.Context) {
	category := Category(c.Param("category"))
	var req setRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	view, err := h.svc.Set(category, SetInput{Name: req.Name, Value: req.Value})
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, view)
}

// Delete clears a category's stored key — DELETE /settings/api-keys/:category.
func (h *Handler) Delete(c *gin.Context) {
	category := Category(c.Param("category"))
	if err := h.svc.Delete(category); err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
