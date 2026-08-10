package packet

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

func idParam(c *gin.Context, name string) (uint, error) {
	v, err := strconv.ParseUint(c.Param(name), 10, 64)
	if err != nil {
		return 0, errors.New("invalid " + name)
	}
	return uint(v), nil
}

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrInvalidPacketTransition), errors.Is(err, ErrLockerRequired),
		errors.Is(err, ErrLockerInvalid), errors.Is(err, ErrLockerFull), errors.Is(err, ErrLoanInvalid):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (h *Handler) List(c *gin.Context) {
	var f Filter
	if v := c.Query("loanId"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LoanID = uint(n)
		}
	}
	if v := c.Query("branchId"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.BranchID = uint(n)
		}
	}
	if v := c.Query("lockerId"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LockerID = uint(n)
		}
	}
	f.Status = c.Query("status")

	recs, err := h.svc.List(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, recs)
}

func (h *Handler) Get(c *gin.Context) {
	id, err := idParam(c, "id")
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

func (h *Handler) GetByCode(c *gin.Context) {
	rec, err := h.svc.GetByCode(c.Param("code"))
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) ListMovements(c *gin.Context) {
	id, err := idParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	recs, err := h.svc.ListMovements(id)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, recs)
}

type movementRequest struct {
	ToStatus   string `json:"toStatus" binding:"required"`
	LockerID   *uint  `json:"lockerId"`
	EmployeeID uint   `json:"employeeId"`
	Remarks    string `json:"remarks"`
}

func (h *Handler) RecordMovement(c *gin.Context) {
	id, err := idParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req movementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.RecordMovement(id, req.ToStatus, req.LockerID, req.EmployeeID, req.Remarks)
	if err != nil {
		c.JSON(statusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}
