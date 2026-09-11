package cash

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
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
	Mode       string  `json:"mode"`
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

// parseOccurredOn is parseOptionalDate plus one adjustment for *recording* a
// movement/expense (not for date-only filters/lookups, which still want
// plain parseOptionalDate): a date-only "YYYY-MM-DD" that names today gets
// stamped with the actual current time instead of midnight. Every screen
// that records one of these (CashOutModal.tsx, CashInModal, the expense
// form) sends a full date string even for "today", never leaving it blank —
// so the IsZero()-means-time.Now() fallback in MovementService.Record/
// ExpenseService.Record never fires for them. Without this, a same-day
// manual entry stored at midnight sorts *after* every other same-day
// movement in the "occurred_on desc" list (repository.go's FindAll)
// regardless of what time it was actually recorded — which is what made
// outflows (recorded via CashOutModal, always with an explicit date) look
// like they always landed last. A backdated (non-today) date is left at
// midnight — there's no time-of-day to preserve for those, and date-level
// ordering across different days is unaffected by this either way.
func parseOccurredOn(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	// Parsed in time.Local (matching time.Now() below), not the UTC
	// parseOptionalDate defaults to — otherwise "is this date today" could
	// disagree with the server's own clock right around midnight in
	// whatever zone the server actually runs in.
	t, err := time.ParseInLocation("2006-01-02", s, time.Local)
	if err != nil {
		return time.Time{}, err
	}
	now := time.Now()
	if t.Year() == now.Year() && t.YearDay() == now.YearDay() {
		return now, nil
	}
	return t, nil
}

func (req movementRequest) toInput() (RecordMovementInput, error) {
	occurred, err := parseOccurredOn(req.OccurredOn)
	if err != nil {
		return RecordMovementInput{}, httpx.NewBadRequest("invalid occurredOn: expected YYYY-MM-DD")
	}
	return RecordMovementInput{
		Type: req.Type, Source: req.Source, Purpose: req.Purpose, Mode: req.Mode,
		Bank: req.Bank, Amount: req.Amount, BranchID: req.BranchID, OccurredOn: occurred,
	}, nil
}

func (h *MovementHandler) Record(c *gin.Context) {
	ctx := platform.RequestContext(c)
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
	rec, err := h.svc.Record(ctx, input)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *MovementHandler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID := platform.GetBranchScope(c)

	fromDate, err := parseOptionalDate(c.Query("fromDate"))
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid fromDate: expected YYYY-MM-DD")
		return
	}
	toDate, err := parseOptionalDate(c.Query("toDate"))
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid toDate: expected YYYY-MM-DD")
		return
	}

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.List(ctx, branchID, fromDate, toDate, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		return
	}

	rec, _, err := h.svc.List(ctx, branchID, fromDate, toDate, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *MovementHandler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(ctx, id, platform.GetBranchScope(c))
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
	ctx := platform.RequestContext(c)
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
	rec, err := h.svc.SetLoanStatus(ctx, id, req.Status, platform.GetBranchScope(c))
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
	occurred, err := parseOccurredOn(req.OccurredOn)
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
	ctx := platform.RequestContext(c)
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
	rec, err := h.svc.Record(ctx, input)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *ExpenseHandler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID := platform.GetBranchScope(c)

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.List(ctx, branchID, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		return
	}

	rec, _, err := h.svc.List(ctx, branchID, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *ExpenseHandler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(ctx, id, platform.GetBranchScope(c))
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
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req approveExpenseRequest
	_ = c.ShouldBindJSON(&req) // body is optional
	rec, err := h.svc.Approve(ctx, id, req.ApprovedBy, platform.GetBranchScope(c))
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
	ctx := platform.RequestContext(c)
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
	rec, err := h.svc.Reject(ctx, id, req.ApprovedBy, req.Remarks, platform.GetBranchScope(c))
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
	ctx := platform.RequestContext(c)
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
	rec, err := h.svc.Set(ctx, req.BranchID, date, req.Amount)
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
	ctx := platform.RequestContext(c)
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
	rec, err := h.svc.Get(ctx, uint(branchID), date)
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
	ctx := platform.RequestContext(c)
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
	summary, err := h.svc.GetExpectedCash(ctx, branchID, date)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, summary)
}

// GoldSaleHandler wires HTTP requests to the GoldSaleService.
type GoldSaleHandler struct {
	svc *GoldSaleService
}

func NewGoldSaleHandler(svc *GoldSaleService) *GoldSaleHandler {
	return &GoldSaleHandler{svc: svc}
}

type goldSaleRequest struct {
	OrnamentType string  `json:"ornamentType" binding:"required"`
	SoldAmount   float64 `json:"soldAmount" binding:"required"`
	CostAmount   float64 `json:"costAmount"`
	SoldOn       string  `json:"soldOn"` // optional, "YYYY-MM-DD" — defaults to today
	BranchID     uint    `json:"branchId" binding:"required"`
	Remarks      string  `json:"remarks"`
}

func (req goldSaleRequest) toInput() (RecordGoldSaleInput, error) {
	soldOn, err := parseOccurredOn(req.SoldOn)
	if err != nil {
		return RecordGoldSaleInput{}, httpx.NewBadRequest("invalid soldOn: expected YYYY-MM-DD")
	}
	return RecordGoldSaleInput{
		OrnamentType: req.OrnamentType, SoldAmount: req.SoldAmount, CostAmount: req.CostAmount,
		SoldOn: soldOn, BranchID: req.BranchID, Remarks: req.Remarks,
	}, nil
}

func (h *GoldSaleHandler) Record(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req goldSaleRequest
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
	rec, err := h.svc.Create(ctx, input)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *GoldSaleHandler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID := platform.GetBranchScope(c)

	fromDate, err := parseOptionalDate(c.Query("fromDate"))
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid fromDate: expected YYYY-MM-DD")
		return
	}
	toDate, err := parseOptionalDate(c.Query("toDate"))
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid toDate: expected YYYY-MM-DD")
		return
	}

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.List(ctx, branchID, fromDate, toDate, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		return
	}

	rec, _, err := h.svc.List(ctx, branchID, fromDate, toDate, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *GoldSaleHandler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.Get(ctx, id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}
