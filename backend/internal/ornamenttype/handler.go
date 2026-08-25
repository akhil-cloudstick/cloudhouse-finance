package ornamenttype

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

func (h *Handler) List(c *gin.Context) {
	rec, err := h.svc.List(c.Query("q"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type ornamentTypeRequest struct {
	Name string `json:"name"`
}

func (h *Handler) Create(c *gin.Context) {
	var req ornamentTypeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, created, err := h.svc.FindOrCreate(req.Name)
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
