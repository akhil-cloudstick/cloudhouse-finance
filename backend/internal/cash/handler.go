package cash

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
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
	BranchID   *uint   `json:"branchId"`   // optional — not every cash movement is tied to a till yet
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
		Bank: req.Bank, Amount: req.Amount, BranchID: req.BranchID, OccurredOn: occurred,
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
		errors.Is(err, ErrPurposeRequired), errors.Is(err, ErrInvalidStatus),
		errors.Is(err, ErrBranchInvalid):
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
	// Only enforce/override the branch when the caller actually supplied
	// one — forcing a branch onto a till-less movement would defeat the
	// "not every movement is tied to a till" design (see model.go).
	if input.BranchID != nil {
		branchID := platform.EnforceBranchOnWrite(c, *input.BranchID)
		input.BranchID = &branchID
	}
	rec, err := h.svc.Record(input)
	if err != nil {
		c.JSON(movementStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *MovementHandler) List(c *gin.Context) {
	rec, err := h.svc.List(platform.GetBranchScope(c))
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
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
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
	rec, err := h.svc.SetLoanStatus(id, req.Status, platform.GetBranchScope(c))
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
	BranchID     uint    `json:"branchId" binding:"required"`
	Remarks      string  `json:"remarks"`
	ReceiptImage string  `json:"receiptImage"`
}

func (req expenseRequest) toInput() (RecordExpenseInput, error) {
	occurred, err := parseOptionalDate(req.OccurredOn)
	if err != nil {
		return RecordExpenseInput{}, errors.New("invalid occurredOn: expected YYYY-MM-DD")
	}
	return RecordExpenseInput{
		OccurredOn: occurred, Category: req.Category, Amount: req.Amount,
		Mode: req.Mode, Payee: req.Payee, BranchID: req.BranchID,
		Remarks: req.Remarks, ReceiptImage: req.ReceiptImage,
	}, nil
}

func expenseStatusForErr(err error) int {
	switch {
	case errors.Is(err, ErrExpenseNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrCategoryRequired),
		errors.Is(err, ErrModeRequired), errors.Is(err, ErrPayeeRequired), errors.Is(err, ErrBranchRequired),
		errors.Is(err, ErrBranchInvalid), errors.Is(err, ErrExpenseNotPending), errors.Is(err, ErrRemarksRequired):
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
	input.BranchID = platform.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := h.svc.Record(input)
	if err != nil {
		c.JSON(expenseStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *ExpenseHandler) List(c *gin.Context) {
	rec, err := h.svc.List(platform.GetBranchScope(c))
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
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(expenseStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

type approveExpenseRequest struct {
	ApprovedBy string `json:"approvedBy"`
}

func (h *ExpenseHandler) Approve(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req approveExpenseRequest
	_ = c.ShouldBindJSON(&req) // body is optional
	rec, err := h.svc.Approve(id, req.ApprovedBy, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(expenseStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

type rejectExpenseRequest struct {
	ApprovedBy string `json:"approvedBy"`
	Remarks    string `json:"remarks" binding:"required"`
}

func (h *ExpenseHandler) Reject(c *gin.Context) {
	id, err := idParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var req rejectExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Reject(id, req.ApprovedBy, req.Remarks, platform.GetBranchScope(c))
	if err != nil {
		c.JSON(expenseStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// OpeningBalanceHandler wires HTTP requests to the OpeningBalanceService.
type OpeningBalanceHandler struct {
	svc *OpeningBalanceService
}

func NewOpeningBalanceHandler(svc *OpeningBalanceService) *OpeningBalanceHandler {
	return &OpeningBalanceHandler{svc: svc}
}

func openingBalanceStatusForErr(err error) int {
	switch {
	case errors.Is(err, ErrInvalidBalance), errors.Is(err, ErrBranchRequired), errors.Is(err, ErrBranchInvalid):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

type setOpeningBalanceRequest struct {
	BranchID uint    `json:"branchId" binding:"required"`
	Date     string  `json:"date"` // optional, "YYYY-MM-DD" — defaults to today
	Amount   float64 `json:"amount"`
}

func (h *OpeningBalanceHandler) Set(c *gin.Context) {
	var req setOpeningBalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	date, err := parseOptionalDate(req.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date: expected YYYY-MM-DD"})
		return
	}
	rec, err := h.svc.Set(req.BranchID, date, req.Amount)
	if err != nil {
		c.JSON(openingBalanceStatusForErr(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

func parseQueryDate(c *gin.Context) (time.Time, error) {
	return parseOptionalDate(c.Query("date"))
}

func (h *OpeningBalanceHandler) Get(c *gin.Context) {
	branchIDStr := c.Query("branchId")
	if branchIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branchId is required"})
		return
	}
	branchID, err := strconv.ParseUint(branchIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid branchId"})
		return
	}
	date, err := parseQueryDate(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date: expected YYYY-MM-DD"})
		return
	}
	rec, err := h.svc.Get(uint(branchID), date)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// SummaryHandler wires HTTP requests to the SummaryService.
type SummaryHandler struct {
	svc *SummaryService
}

func NewSummaryHandler(svc *SummaryService) *SummaryHandler {
	return &SummaryHandler{svc: svc}
}

func (h *SummaryHandler) Get(c *gin.Context) {
	var branchID *uint
	if branchIDStr := c.Query("branchId"); branchIDStr != "" {
		v, err := strconv.ParseUint(branchIDStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid branchId"})
			return
		}
		id := uint(v)
		branchID = &id
	}
	date, err := parseQueryDate(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date: expected YYYY-MM-DD"})
		return
	}
	summary, err := h.svc.GetExpectedCash(branchID, date)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, summary)
}
