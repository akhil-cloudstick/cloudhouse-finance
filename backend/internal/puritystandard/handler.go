package puritystandard

import (
	"net/http"

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

func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	rec, err := h.svc.List(ctx, c.Query("q"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type purityStandardRequest struct {
	Karat           *int     `json:"karat"`
	FinenessPercent *float64 `json:"finenessPercent"`
	Label           string   `json:"label"`
}

func (h *Handler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req purityStandardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, created, err := h.svc.FindOrCreate(ctx, CreateInput{Karat: req.Karat, FinenessPercent: req.FinenessPercent, Label: req.Label})
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
