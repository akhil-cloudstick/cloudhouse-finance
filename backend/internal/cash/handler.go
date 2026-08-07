package cash

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// MovementHandler wires HTTP requests to the MovementService.
type MovementHandler struct {
	svc *MovementService
}

func NewMovementHandler(svc *MovementService) *MovementHandler {
	return &MovementHandler{svc: svc}
}

type movementRequest struct {
	Type       string  `json:"type" binding:"required"`
	Source     string  `json:"source"`
	Purpose    string  `json:"purpose"`
	Bank       string  `json:"bank"`
	Amount     float64 `json:"amount" binding:"required"`
	OccurredOn string  `json:"occurredOn"` // optional, "YYYY-MM-DD" — defaults to today
}

func parseOptionalDate(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	return time.Parse("2006-01-02", s)
}

func (req movementRequest) toInput() (RecordMovementInput, error) {
	occurred, err := parseOptionalDate(req.OccurredOn)
	if err != nil {
		return RecordMovementInput{}, errors.New("invalid occurredOn: expected YYYY-MM-DD")
	}
	return RecordMovementInput{
		Type: req.Type, Source: req.Source, Purpose: req.Purpose,
		Bank: req.Bank, Amount: req.Amount, OccurredOn: occurred,
	}, nil
}

func idParam(c *gin.Context) (uint, error) {
	v, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return 0, errors.New("invalid id")
	}
	return uint(v), nil
}

func movementStatusForErr(err error) int {
	switch {
	case errors.Is(err, ErrMovementNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrInvalidType),
		errors.Is(err, ErrSourceRequired), errors.Is(err, ErrBankRequired),
		errors.Is(err, ErrPurposeRequired), errors.Is(err, ErrInvalidStatus):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (h *MovementHandler) Record(c *gin.Context) {
	var req movementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input, err := req.toInput()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Record(input)
	if err != nil {
		c.JSON(movementStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *MovementHandler) List(c *gin.Context) {
	rec, err := h.svc.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *MovementHandler) Get(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Get(id)
	if err != nil {
		c.JSON(movementStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

type setStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

func (h *MovementHandler) SetStatus(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req setStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.SetLoanStatus(id, req.Status)
	if err != nil {
		c.JSON(movementStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// ExpenseHandler wires HTTP requests to the ExpenseService.
type ExpenseHandler struct {
	svc *ExpenseService
}

func NewExpenseHandler(svc *ExpenseService) *ExpenseHandler {
	return &ExpenseHandler{svc: svc}
}

type expenseRequest struct {
	OccurredOn   string  `json:"occurredOn"` // optional, "YYYY-MM-DD" — defaults to today
	Category     string  `json:"category" binding:"required"`
	Amount       float64 `json:"amount" binding:"required"`
	Mode         string  `json:"mode" binding:"required"`
	Payee        string  `json:"payee" binding:"required"`
	Branch       string  `json:"branch" binding:"required"`
	ReceiptImage string  `json:"receiptImage"`
}

func (req expenseRequest) toInput() (RecordExpenseInput, error) {
	occurred, err := parseOptionalDate(req.OccurredOn)
	if err != nil {
		return RecordExpenseInput{}, errors.New("invalid occurredOn: expected YYYY-MM-DD")
	}
	return RecordExpenseInput{
		OccurredOn: occurred, Category: req.Category, Amount: req.Amount,
		Mode: req.Mode, Payee: req.Payee, Branch: req.Branch, ReceiptImage: req.ReceiptImage,
	}, nil
}

func expenseStatusForErr(err error) int {
	switch {
	case errors.Is(err, ErrExpenseNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrCategoryRequired),
		errors.Is(err, ErrModeRequired), errors.Is(err, ErrPayeeRequired), errors.Is(err, ErrBranchRequired):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (h *ExpenseHandler) Record(c *gin.Context) {
	var req expenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input, err := req.toInput()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Record(input)
	if err != nil {
		c.JSON(expenseStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *ExpenseHandler) List(c *gin.Context) {
	rec, err := h.svc.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *ExpenseHandler) Get(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Get(id)
	if err != nil {
		c.JSON(expenseStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}
