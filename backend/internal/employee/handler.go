package employee

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// genericErr is returned to the client instead of a raw internal error
// (e.g. a DB constraint violation) so we never leak SQL/driver details.
// The real error is logged server-side for debugging.
const genericErr = "Something went wrong on our end. Please try again."

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// createRequest is the JSON body accepted by POST /employees.
type createRequest struct {
	Name     string `json:"name" binding:"required"`
	Role     string `json:"role" binding:"required"`
	BranchID uint   `json:"branchId" binding:"required"`
	Phone    string `json:"phone"`
}

// updateRequest is the JSON body accepted by PUT /employees/:id.
type updateRequest struct {
	Name           string  `json:"name" binding:"required"`
	Role           string  `json:"role" binding:"required"`
	BranchID       uint    `json:"branchId" binding:"required"`
	Phone          string  `json:"phone"`
	LoansProcessed int     `json:"loansProcessed"`
	Collections    float64 `json:"collections"`
	Followups      int     `json:"followups"`
	Pending        int     `json:"pending"`
	// Email/Password are optional — set/rotate an employee's login
	// credentials via this same endpoint (see internal/auth).
	Email    string `json:"email"`
	Password string `json:"password"`
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
	case errors.Is(err, ErrNameRequired), errors.Is(err, ErrRoleRequired), errors.Is(err, ErrInvalidRole), errors.Is(err, ErrBranchReq), errors.Is(err, ErrBranchInvalid), errors.Is(err, ErrPhoneInvalid), errors.Is(err, ErrEmailInvalid), errors.Is(err, ErrPasswordTooShort):
		return http.StatusBadRequest
	case errors.Is(err, ErrEmailTaken):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

// respondErr writes the appropriate status code for err. For anything that
// maps to 500 (unexpected/internal errors, e.g. a DB failure) it logs the
// real error server-side and sends a generic message to the client instead
// of the raw error text.
func respondErr(c *gin.Context, err error) {
	status := statusForErr(err)
	if status == http.StatusInternalServerError {
		log.Printf("employee: internal error: %v", err)
		c.JSON(status, gin.H{"error": genericErr})
		return
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

func (h *Handler) Create(c *gin.Context) {
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Create(CreateInput{Name: req.Name, Role: req.Role, BranchID: req.BranchID, Phone: req.Phone})
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	rec, err := h.svc.List()
	if err != nil {
		respondErr(c, err)
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
		respondErr(c, err)
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
		Name: req.Name, Role: req.Role, BranchID: req.BranchID, Phone: req.Phone,
		LoansProcessed: req.LoansProcessed, Collections: req.Collections,
		Followups: req.Followups, Pending: req.Pending,
		Email: req.Email, Password: req.Password,
	})
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Delete(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Delete(id); err != nil {
		respondErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
