package bank

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
	case errors.Is(err, ErrNameRequired), errors.Is(err, ErrPhoneInvalid):
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

type bankRequest struct {
	Name      string `json:"name"`
	Branch    string `json:"branch"`
	Ifsc      string `json:"ifsc"`
	AccountNo string `json:"accountNo"`
	Phone     string `json:"phone"`
}

func (h *Handler) Create(c *gin.Context) {
	var req bankRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, created, err := h.svc.FindOrCreate(CreateInput{Name: req.Name, Branch: req.Branch, Ifsc: req.Ifsc, AccountNo: req.AccountNo, Phone: req.Phone})
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
