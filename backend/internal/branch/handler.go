package branch

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// createRequest is the JSON body accepted by POST /branches.
type createRequest struct {
	Name    string `json:"name" binding:"required"`
	Code    string `json:"code"`
	Address string `json:"address" binding:"required"`
	Phone   string `json:"phone"`
}

// updateRequest is the JSON body accepted by PUT /branches/:id.
type updateRequest struct {
	Name     string `json:"name" binding:"required"`
	Code     string `json:"code"`
	Address  string `json:"address" binding:"required"`
	Phone    string `json:"phone"`
	IsActive bool   `json:"isActive"`
}

func idParam(c *gin.Context) (uint, error) {
	v, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return 0, errors.New("invalid id")
	}
	return uint(v), nil
}

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrNameRequired), errors.Is(err, ErrAddressReq),
		errors.Is(err, ErrDuplicateName), errors.Is(err, ErrInUse):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (h *Handler) Create(c *gin.Context) {
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Create(CreateInput{Name: req.Name, Code: req.Code, Address: req.Address, Phone: req.Phone})
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	rec, err := h.svc.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Get(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Get(id)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Update(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Update(id, UpdateInput{
		Name: req.Name, Code: req.Code, Address: req.Address, Phone: req.Phone, IsActive: req.IsActive,
	})
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// Delete deactivates (soft-disables) a branch rather than hard-deleting it,
// so historical records keep a valid BranchID reference.
func (h *Handler) Delete(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Deactivate(id)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}
