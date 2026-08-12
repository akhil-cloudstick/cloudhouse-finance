package puritystandard

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

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrKaratOutOfRange), errors.Is(err, ErrFinenessOutOfRange), errors.Is(err, ErrNeitherProvided):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (h *Handler) List(c *gin.Context) {
	rec, err := h.svc.List(c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

type purityStandardRequest struct {
	Karat           *int     `json:"karat"`
	FinenessPercent *float64 `json:"finenessPercent"`
	Label           string   `json:"label"`
}

func (h *Handler) Create(c *gin.Context) {
	var req purityStandardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, created, err := h.svc.FindOrCreate(CreateInput{Karat: req.Karat, FinenessPercent: req.FinenessPercent, Label: req.Label})
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	if created {
		c.JSON(http.StatusCreated, rec)
		return
	}
	c.JSON(http.StatusOK, rec)
}
