package cash

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
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
		return RecordMovementInput{}, httpx.NewBadRequest("invalid occurredOn: expected YYYY-MM-DD")
	}
	return RecordMovementInput{
		Type: req.Type, Source: req.Source, Purpose: req.Purpose,
		Bank: req.Bank, Amount: req.Amount, BranchID: req.BranchID, OccurredOn: occurred,
	}, nil
}

func (h *MovementHandler) Record(c *gin.Context) {
	var req movementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	input, err := req.toInput()
	if err != nil {
		httpx.FailErr(c, err)
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
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *MovementHandler) List(c *gin.Context) {
	branchID := platform.GetBranchScope(c)

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, err := h.svc.List(branchID, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore})
		return
	}

	rec, err := h.svc.List(branchID, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *MovementHandler) Get(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type setStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

func (h *MovementHandler) SetStatus(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req setStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.SetLoanStatus(id, req.Status, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
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
		return RecordExpenseInput{}, httpx.NewBadRequest("invalid occurredOn: expected YYYY-MM-DD")
	}
	return RecordExpenseInput{
		OccurredOn: occurred, Category: req.Category, Amount: req.Amount,
		Mode: req.Mode, Payee: req.Payee, BranchID: req.BranchID,
		Remarks: req.Remarks, ReceiptImage: req.ReceiptImage,
	}, nil
}

func (h *ExpenseHandler) Record(c *gin.Context) {
	var req expenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	input, err := req.toInput()
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	input.BranchID = platform.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := h.svc.Record(input)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *ExpenseHandler) List(c *gin.Context) {
	branchID := platform.GetBranchScope(c)

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, err := h.svc.List(branchID, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore})
		return
	}

	rec, err := h.svc.List(branchID, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *ExpenseHandler) Get(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type approveExpenseRequest struct {
	ApprovedBy string `json:"approvedBy"`
}

func (h *ExpenseHandler) Approve(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req approveExpenseRequest
	_ = c.ShouldBindJSON(&req) // body is optional
	rec, err := h.svc.Approve(id, req.ApprovedBy, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type rejectExpenseRequest struct {
	ApprovedBy string `json:"approvedBy"`
	Remarks    string `json:"remarks" binding:"required"`
}

func (h *ExpenseHandler) Reject(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req rejectExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.Reject(id, req.ApprovedBy, req.Remarks, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// OpeningBalanceHandler wires HTTP requests to the OpeningBalanceService.
type OpeningBalanceHandler struct {
	svc *OpeningBalanceService
}

func NewOpeningBalanceHandler(svc *OpeningBalanceService) *OpeningBalanceHandler {
	return &OpeningBalanceHandler{svc: svc}
}

type setOpeningBalanceRequest struct {
	BranchID uint    `json:"branchId" binding:"required"`
	Date     string  `json:"date"` // optional, "YYYY-MM-DD" — defaults to today
	Amount   float64 `json:"amount"`
}

func (h *OpeningBalanceHandler) Set(c *gin.Context) {
	var req setOpeningBalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	date, err := parseOptionalDate(req.Date)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid date: expected YYYY-MM-DD")
		return
	}
	rec, err := h.svc.Set(req.BranchID, date, req.Amount)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func parseQueryDate(c *gin.Context) (time.Time, error) {
	return parseOptionalDate(c.Query("date"))
}

func (h *OpeningBalanceHandler) Get(c *gin.Context) {
	branchIDStr := c.Query("branchId")
	if branchIDStr == "" {
		httpx.Fail(c, http.StatusBadRequest, "branchId is required")
		return
	}
	branchID, err := strconv.ParseUint(branchIDStr, 10, 64)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid branchId")
		return
	}
	date, err := parseQueryDate(c)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid date: expected YYYY-MM-DD")
		return
	}
	rec, err := h.svc.Get(uint(branchID), date)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
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
			httpx.Fail(c, http.StatusBadRequest, "invalid branchId")
			return
		}
		id := uint(v)
		branchID = &id
	}
	date, err := parseQueryDate(c)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid date: expected YYYY-MM-DD")
		return
	}
	summary, err := h.svc.GetExpectedCash(branchID, date)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, summary)
}
