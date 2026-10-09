package cash

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/reports"
)

// MovementHandler wires HTTP requests to the MovementService.
type MovementHandler struct {
	svc *MovementService
}

func NewMovementHandler(svc *MovementService) *MovementHandler {
	return &MovementHandler{svc: svc}
}

type movementRequest struct {
	Type         string  `json:"type" binding:"required"`
	Source       string  `json:"source"`
	Purpose      string  `json:"purpose"`
	Mode         string  `json:"mode"`
	Bank         string  `json:"bank"`
	BankID       *uint   `json:"bankId"`   // real FK behind Bank — "From Bank" for a UPI/Bank Transfer-mode movement
	ToBankID     *uint   `json:"toBankId"` // destination account for a bank-to-bank transfer — see CashMovement.ToBankID
	Amount       float64 `json:"amount" binding:"required"`
	ReceiptImage string  `json:"receiptImage"` // optional bill — an /uploads/... URL
	BranchID     *uint   `json:"branchId"`     // optional — not every cash movement is tied to a till yet
	OccurredOn   string  `json:"occurredOn"`   // optional, "YYYY-MM-DD" — defaults to today
	// LoanSource is required (see toLoanSourceInput) when Source == "Loan" —
	// the Loan Details block on AddCashModal.tsx / MovementSheet's Loan
	// source picker.
	LoanSource *loanSourceRequest `json:"loanSource"`
}

type loanSourceRequest struct {
	BankID          uint     `json:"bankId"`
	LoanNumber      string   `json:"loanNumber"`
	PrincipalAmount float64  `json:"principalAmount"`
	InterestRate    *float64 `json:"interestRate"`
	DurationMonths  *int     `json:"durationMonths"`
}

func (req movementRequest) toLoanSourceInput() *LoanSourceInput {
	if req.LoanSource == nil {
		return nil
	}
	return &LoanSourceInput{
		BankID:          req.LoanSource.BankID,
		LoanNumber:      req.LoanSource.LoanNumber,
		PrincipalAmount: req.LoanSource.PrincipalAmount,
		InterestRate:    req.LoanSource.InterestRate,
		DurationMonths:  req.LoanSource.DurationMonths,
	}
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
		Bank: req.Bank, BankID: req.BankID, ToBankID: req.ToBankID,
		Amount: req.Amount, BranchID: req.BranchID, OccurredOn: occurred, ReceiptImage: req.ReceiptImage,
	}, nil
}

// ListLoanSources backs GET /cash-movements/loan-sources?q=&limit=&offset= —
// AddCashModal.tsx's Loan Number picker, one row per distinct loan number.
func (h *MovementHandler) ListLoanSources(c *gin.Context) {
	ctx := platform.RequestContext(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	fetch := 0
	if limit > 0 {
		fetch = limit + 1
	}
	bankID, _ := strconv.Atoi(c.Query("bankId"))
	if bankID < 0 {
		bankID = 0
	}
	rec, err := h.svc.SearchLoanSources(ctx, strings.TrimSpace(c.Query("q")), uint(bankID), fetch, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := limit > 0 && len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore})
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
	} else if scope := platform.GetBranchScope(c); scope != nil {
		// A branch-bound employee's manual cash-in/out with no branch given
		// (an older client) is their own till's money — left branch-less it
		// would never reach that branch's Balance in Hand, which only sums
		// the branch's own movements (see SummaryService.openingFor).
		input.BranchID = scope
	}
	rec, err := h.svc.Record(ctx, input, req.toLoanSourceInput())
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, movementResponse{CashMovement: rec, LoanSource: h.svc.GetLoanSource(ctx, rec.ID)})
}

type selfTransferRequest struct {
	Category     string  `json:"category" binding:"required"`
	Amount       float64 `json:"amount" binding:"required"`
	FromBankID   uint    `json:"fromBankId"`
	FromBank     string  `json:"fromBank"`
	ToBankID     uint    `json:"toBankId"` // ignored when Category is a loan — the loan's own bank is used
	ToBank       string  `json:"toBank"`
	Mode         string  `json:"mode"`         // Bank Transfer (default) | UPI | Cash — shown on both rows
	ReceiptImage string  `json:"receiptImage"` // optional bill
	BranchID     *uint   `json:"branchId"`
	OccurredOn   string  `json:"occurredOn"` // optional, "YYYY-MM-DD" — defaults to today
}

// RecordSelfTransfer backs POST /cash-movements/self-transfer — one debit on
// the from-bank and one credit on the to-bank, linked by a TransactionGroupID.
func (h *MovementHandler) RecordSelfTransfer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req selfTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	occurred, err := parseOccurredOn(req.OccurredOn)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid occurredOn: expected YYYY-MM-DD")
		return
	}
	branchID := req.BranchID
	if branchID != nil {
		b := platform.EnforceBranchOnWrite(c, *branchID)
		branchID = &b
	} else if scope := platform.GetBranchScope(c); scope != nil {
		branchID = scope
	}
	rows, err := h.svc.RecordSelfTransfer(ctx, RecordSelfTransferInput{
		Category: req.Category, Amount: req.Amount,
		FromBankID: req.FromBankID, FromBank: req.FromBank,
		ToBankID: req.ToBankID, ToBank: req.ToBank, Mode: req.Mode, ReceiptImage: req.ReceiptImage,
		BranchID: branchID, OccurredOn: occurred,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rows)
}

// partyPageSize is the Party Transactions page's own page size (12) —
// distinct from the app's usual 10, per that page's own convention.
const partyPageSize = 12

// parseUintCSV parses a comma-separated list of uint ids (e.g.
// "3,7,12" from ?branchIds=3,7,12) — empty entries (from a leading/
// trailing/doubled comma) and non-numeric entries are silently skipped
// rather than failing the whole request, since this only ever narrows a
// filter (a bad id just matches nothing).
func parseUintCSV(s string) []uint {
	if s == "" {
		return nil
	}
	var out []uint
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		v, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			continue
		}
		out = append(out, uint(v))
	}
	return out
}

// parseStringCSV is parseUintCSV's counterpart for the Type section's
// comma-separated category list (e.g. "loan,auction").
func parseStringCSV(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

// loanNumbersFromQuery reads the customer-drilldown Loan filter's selection
// off a request — ?loanNumbers=LN-1,LN-2 (the Ledger tab's multi-select
// picker) merged with the older single ?loanNumber= param (kept for any
// existing caller/bookmark that still sends just one).
func loanNumbersFromQuery(c *gin.Context) []string {
	numbers := parseStringCSV(c.Query("loanNumbers"))
	if single := c.Query("loanNumber"); single != "" {
		numbers = append(numbers, single)
	}
	return numbers
}

// movementQueryFilter builds a MovementFilter from the Ledger filter's
// ?branchIds=/?customerIds=/?types= query params — shared by List and
// Export so the downloaded file always matches what the table's filter
// panel currently shows.
func movementQueryFilter(c *gin.Context) MovementFilter {
	return MovementFilter{
		BranchIDs:   parseUintCSV(c.Query("branchIds")),
		CustomerIDs: parseUintCSV(c.Query("customerIds")),
		Categories:  parseStringCSV(c.Query("types")),
	}
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
	filter := movementQueryFilter(c)
	search := strings.TrimSpace(c.Query("q"))

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.ListFiltered(ctx, branchID, fromDate, toDate, filter, search, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		debit, credit, err := h.svc.SumFiltered(ctx, branchID, fromDate, toDate, filter, search)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		// pageBalance is the running balance after the page's newest row: the
		// whole filtered set's net minus what the rows ahead of this page add.
		ahead, err := h.svc.NetOfNewest(ctx, branchID, fromDate, toDate, filter, search, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": h.withLoanSources(ctx, rec), "hasMore": hasMore, "total": total, "totalDebit": debit, "totalCredit": credit, "pageBalance": (credit - debit) - ahead})
		return
	}

	rec, _, err := h.svc.ListFiltered(ctx, branchID, fromDate, toDate, filter, search, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, h.withLoanSources(ctx, rec))
}

// withLoanSources decorates a list page with each loan-sourced movement's
// LoanSource (same shape Get/Record return) so the ledger's Ref No can show
// the loan number staff typed in Add Cash.
func (h *MovementHandler) withLoanSources(ctx context.Context, rows []CashMovement) []movementResponse {
	var ids []uint
	for _, m := range rows {
		if IsLoanSource(m.Source) {
			ids = append(ids, m.ID)
		}
	}
	sources := h.svc.LoanSourcesByMovementIDs(ctx, ids)
	out := make([]movementResponse, len(rows))
	for i := range rows {
		out[i] = movementResponse{CashMovement: &rows[i], LoanSource: sources[rows[i].ID]}
	}
	return out
}

// GetCashLedger backs GET /cash-movements/cash-ledger — the "Cash Ledger"
// sub-ledger drill-down off the Cash entity: every transaction across
// CashMovement/LoanPayment/PersonalLoanPayment/GoldSale whose mode was pure
// Cash (see MovementService.ListCashModeLedger's doc comment), as opposed to
// the bank/customer/loan ledgers which show every mode. Branch-scoped the
// same way List above is: platform.GetBranchScope pins a non-cross-branch
// role to their own branch; a cross-branch role additionally may narrow to
// specific branches via ?branchIds=1,2,3 (same query param List's own
// MovementFilter.BranchIDs reads), ignored for a scoped caller.
func (h *MovementHandler) GetCashLedger(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID := platform.GetBranchScope(c)
	branchIDs := parseUintCSV(c.Query("branchIds"))

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
	limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := h.svc.ListCashModeLedger(ctx, branchID, branchIDs, fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	respondLedger(c, export, "Cash Ledger", "cash-ledger.pdf", fromDate, toDate, rec, total, totals, nil)
}

// modeVocabulary is every payment mode a mode-scoped ledger drill-down can be
// asked for — the same free-text vocabulary CashMovement.Mode/Expense.Mode/
// SplitPaymentInput.tsx's SPLIT_PAYMENT_MODES use everywhere else in the app.
var modeVocabulary = map[string]bool{
	"Cash":          true,
	"UPI":           true,
	"Bank Transfer": true,
	"Cheque":        true,
}

// GetModeLedger backs GET /cash-movements/mode-ledger — the generic
// per-payment-mode ledger drill-down (see MovementService.ListModeLedger's
// doc comment): Cash, UPI, Bank Transfer or Cheque, each optionally narrowed
// to one bankId (meaningless for Cash, which never has a bank of record).
// ?mode is a query param rather than a path segment since "Bank Transfer"
// contains a space that would need URL-encoding either way, and this keeps
// the route registration simple (no per-mode route to add later).
func (h *MovementHandler) GetModeLedger(c *gin.Context) {
	ctx := platform.RequestContext(c)
	mode := c.Query("mode")
	if !modeVocabulary[mode] {
		httpx.Fail(c, http.StatusBadRequest, "invalid mode: expected Cash, UPI, Bank Transfer or Cheque")
		return
	}
	var bankID *uint
	if raw := c.Query("bankId"); raw != "" {
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid bankId")
			return
		}
		v := uint(id)
		bankID = &v
	}
	branchID := platform.GetBranchScope(c)
	branchIDs := parseUintCSV(c.Query("branchIds"))

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
	limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := h.svc.ListModeLedger(ctx, mode, bankID, branchID, branchIDs, parseStringCSV(c.Query("types")), fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	slug := strings.ToLower(strings.ReplaceAll(mode, " ", "-"))
	respondLedger(c, export, mode+" Ledger", slug+"-ledger.pdf", fromDate, toDate, rec, total, totals, nil)
}

// ListByBank returns one page of every cash movement tagged to :bankId,
// plus PartyTotals across every matching row — backs the Party Transactions
// page's bank drill-down. Page size defaults to 12 (per the Party
// Transactions page's own convention, distinct from the app's usual 10) when
// limit is omitted.
func (h *MovementHandler) ListByBank(c *gin.Context) {
	ctx := platform.RequestContext(c)
	bankID, err := httpx.IDParam(c, "bankId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if !h.ownsParty(c, ctx, "banks", bankID, "bank not found") {
		return
	}
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
	if limit <= 0 {
		limit = partyPageSize
	}
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	rec, total, totals, err := h.svc.ListCashMovementsByBank(ctx, bankID, fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "total": total, "totals": totals})
}

// ListByCustomer backs the Party Transactions page's customer drill-down and
// CustomerDetail.tsx's "Transactions" tab. Returns the COMBINED, normalized
// ledger (CashMovement + LoanPayment + PersonalLoanPayment rows tagged to
// this customer — see ledger.go's dedup rule) rather than plain CashMovement
// rows — same URL as before, richer payload, so no frontend caller needs a
// new endpoint to pick up the richer ledger.
func (h *MovementHandler) ListByCustomer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := httpx.IDParam(c, "customerId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if !h.ownsParty(c, ctx, "customers", customerID, "customer not found") {
		return
	}
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
	limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := h.svc.ListCombinedLedgerByCustomer(ctx, customerID, loanNumbersFromQuery(c), fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	respondLedger(c, export, "Customer Ledger", "customer-ledger.pdf", fromDate, toDate, rec, total, totals, nil)
}

// GetBankLedger backs GET /banks/:id/ledger — the combined, normalized
// ledger (CashMovement + LoanPayment + PersonalLoanPayment + GoldSale rows
// tagged to this bank — see ledger.go's dedup rule) for one bank. Lives on
// MovementHandler (not bank.Handler) because internal/bank cannot import
// internal/cash's CashMovement/GoldSale models without an import cycle —
// internal/cash already imports internal/bank (bank.Bank/bank.NewRepository)
// — so the handler is here and the route is mounted under /banks/:id/ledger
// from app.go instead, same "handler in one package, route path in
// another's URL shape" precedent as loanHandler.GetCustomer360 under
// /customers/:id/profile360.
func (h *MovementHandler) GetBankLedger(c *gin.Context) {
	ctx := platform.RequestContext(c)
	bankID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if !h.ownsParty(c, ctx, "banks", bankID, "bank not found") {
		return
	}
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
	limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := h.svc.ListCombinedLedgerByBank(ctx, bankID, splitCSV(c.Query("modes")), fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	respondLedger(c, export, "Bank Ledger", "bank-ledger.pdf", fromDate, toDate, rec, total, totals, nil)
}

// ownsParty answers 404 (and returns false) unless the :id in the path is a
// record of the caller's own business — see platform.ExistsInTenant for why
// an empty 200 for another business's id is not good enough.
func (h *MovementHandler) ownsParty(c *gin.Context, ctx context.Context, table string, id uint, notFound string) bool {
	ok, err := platform.ExistsInTenant(ctx, h.svc.repo.db, table, id)
	if err != nil {
		httpx.FailErr(c, err)
		return false
	}
	if ok {
		ok, err = h.partyInBranchScope(c, ctx, table, id)
		if err != nil {
			httpx.FailErr(c, err)
			return false
		}
	}
	if !ok {
		httpx.Fail(c, http.StatusNotFound, notFound)
		return false
	}
	return true
}

// partyInBranchScope reports whether a bank, customer or branch belongs to
// the caller's branch scope (GetBranchScope): each belongs to one branch, so
// with a branch selected — or for a branch-confined role — another branch's
// party reads as not found, the same as one from another business.
func (h *MovementHandler) partyInBranchScope(c *gin.Context, ctx context.Context, table string, id uint) (bool, error) {
	scope := platform.GetBranchScope(c)
	if scope == nil {
		return true, nil
	}
	if table == "branches" {
		return id == *scope, nil
	}
	var branchID uint
	if err := h.svc.repo.db.WithContext(ctx).Table(table).Select("branch_id").
		Where("id = ?", id).Scan(&branchID).Error; err != nil {
		return false, err
	}
	return branchID == *scope, nil
}

// ListByBranch is ListByBank's counterpart for :branchId.
func (h *MovementHandler) ListByBranch(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if !h.ownsParty(c, ctx, "branches", branchID, "branch not found") {
		return
	}
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
	if limit <= 0 {
		limit = partyPageSize
	}
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	rec, total, totals, err := h.svc.ListCashMovementsByBranch(ctx, branchID, fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "total": total, "totals": totals})
}

// partyStatementRows/partyStatementNote are ListByBank/ListByCustomer's
// shared PDF-export shape — factored out of Export above so the Party
// Transactions page's "Export Statement" reuses the exact same
// renderTablePDF call/column layout instead of a second copy of it.
func partyStatementRows(rows []CashMovement) [][]string {
	tableRows := make([][]string, len(rows))
	for i, m := range rows {
		branchName := ""
		if m.Branch != nil {
			branchName = m.Branch.Name
		}
		tableRows[i] = []string{
			m.OccurredOn.Format("2006-01-02"),
			m.Type,
			m.Source,
			m.Purpose,
			m.Mode,
			m.Bank,
			branchName,
			strconv.FormatFloat(m.Amount, 'f', 2, 64),
			m.Status,
		}
	}
	return tableRows
}

// branchColumnFor drops the "Branch" column from an export when the business
// runs in single-branch mode — its only branch is the Head Office, so the
// column carries nothing. Returns headers and rows unchanged otherwise.
func branchColumnFor(c *gin.Context, headers []string, rows [][]string) ([]string, [][]string) {
	if _, single := platform.SingleBranchPin(c); !single {
		return headers, rows
	}
	idx := -1
	for i, h := range headers {
		if h == "Branch" {
			idx = i
			break
		}
	}
	if idx < 0 {
		return headers, rows
	}
	headers = append(append([]string{}, headers[:idx]...), headers[idx+1:]...)
	for i, r := range rows {
		if idx < len(r) {
			rows[i] = append(append([]string{}, r[:idx]...), r[idx+1:]...)
		}
	}
	return headers, rows
}

// ledgerPaging reads a ledger request's limit/offset. ?export=pdf asks for
// every matching row instead (limit 0 is unpaged in paginateLedgerRows).
func ledgerPaging(c *gin.Context) (limit, offset int, export bool) {
	if c.Query("export") == "pdf" {
		return 0, 0, true
	}
	limit, _ = strconv.Atoi(c.Query("limit"))
	if limit <= 0 {
		limit = partyPageSize
	}
	offset, _ = strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	return limit, offset, false
}

// respondLedger writes one ledger page as JSON — with totalDebit/totalCredit
// across the whole filter, not just the page — or, when export is set, a PDF
// of every matching row ending in a totals line. extra adds JSON-only keys.
func respondLedger(c *gin.Context, export bool, title, filename string, fromDate, toDate time.Time, rows []LedgerRow, total int64, totals LedgerTotals, extra gin.H) {
	if !export {
		body := gin.H{"items": rows, "total": total, "totalDebit": totals.TotalDebit, "totalCredit": totals.TotalCredit}
		for k, v := range extra {
			body[k] = v
		}
		httpx.Success(c, http.StatusOK, body)
		return
	}
	money := func(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }
	tableRows := make([][]string, 0, len(rows)+1)
	for _, r := range rows {
		debit, credit := "", ""
		if r.DebitOrCredit == "debit" {
			debit = money(r.Amount)
		} else {
			credit = money(r.Amount)
		}
		tableRows = append(tableRows, []string{
			r.Date.Format("2006-01-02"), r.Description, r.Method, r.Reference, r.BankName, r.CustomerName, debit, credit, money(r.RunningBalance),
		})
	}
	tableRows = append(tableRows, []string{"", "Total", "", "", "", "", money(totals.TotalDebit), money(totals.TotalCredit), ""})
	pdfBytes, err := renderTablePDF(title, partyStatementNote(fromDate, toDate),
		[]string{"Date", "Description", "Mode", "Reference", "Bank", "Customer", "Debit", "Credit", "Balance"}, tableRows)
	if err != nil {
		httpx.Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

func partyStatementNote(fromDate, toDate time.Time) string {
	if fromDate.IsZero() && toDate.IsZero() {
		return ""
	}
	from, to := "…", "…"
	if !fromDate.IsZero() {
		from = fromDate.Format("02 Jan 2006")
	}
	if !toDate.IsZero() {
		to = toDate.Format("02 Jan 2006")
	}
	return from + " – " + to
}

// ExportByBank streams a PDF statement of every cash movement tagged to
// :bankId matching the same fromDate/toDate filters the Party Transactions
// page itself uses — never capped to the page's current page size.
func (h *MovementHandler) ExportByBank(c *gin.Context) {
	ctx := platform.RequestContext(c)
	bankID, err := httpx.IDParam(c, "bankId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if !h.ownsParty(c, ctx, "banks", bankID, "bank not found") {
		return
	}
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
	rows, _, err := h.svc.repo.ListByBank(ctx, bankID, fromDate, toDate, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	headers, tableRows := branchColumnFor(c, []string{"Date", "Type", "Source", "Purpose", "Mode", "Bank", "Branch", "Amount", "Status"}, partyStatementRows(rows))
	pdfBytes, err := renderTablePDF(
		"Party Transactions",
		partyStatementNote(fromDate, toDate),
		headers,
		tableRows,
	)
	if err != nil {
		httpx.Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Disposition", `attachment; filename="party-transactions.pdf"`)
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

// ExportByBranch is ExportByBank's counterpart for :branchId.
func (h *MovementHandler) ExportByBranch(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if !h.ownsParty(c, ctx, "branches", branchID, "branch not found") {
		return
	}
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
	rows, _, err := h.svc.repo.ListByBranch(ctx, branchID, fromDate, toDate, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	headers, tableRows := branchColumnFor(c, []string{"Date", "Type", "Source", "Purpose", "Mode", "Bank", "Branch", "Amount", "Status"}, partyStatementRows(rows))
	pdfBytes, err := renderTablePDF(
		"Party Transactions",
		partyStatementNote(fromDate, toDate),
		headers,
		tableRows,
	)
	if err != nil {
		httpx.Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Disposition", `attachment; filename="party-transactions.pdf"`)
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

// ExportByCustomer is ExportByBank's counterpart for :customerId.
func (h *MovementHandler) ExportByCustomer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := httpx.IDParam(c, "customerId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if !h.ownsParty(c, ctx, "customers", customerID, "customer not found") {
		return
	}
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
	rows, _, err := h.svc.repo.ListByCustomer(ctx, customerID, fromDate, toDate, loanNumbersFromQuery(c), 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	headers, tableRows := branchColumnFor(c, []string{"Date", "Type", "Source", "Purpose", "Mode", "Bank", "Branch", "Amount", "Status"}, partyStatementRows(rows))
	pdfBytes, err := renderTablePDF(
		"Party Transactions",
		partyStatementNote(fromDate, toDate),
		headers,
		tableRows,
	)
	if err != nil {
		httpx.Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Disposition", `attachment; filename="party-transactions.pdf"`)
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

// Export streams every cash movement matching the same fromDate/toDate/
// category filters the Cash Movements table itself uses — deliberately NOT
// capped to the table's current page size or even its full loaded set, so
// the downloaded file always reflects the filter, not how many rows
// happen to be paginated into the browser right now.
func (h *MovementHandler) Export(c *gin.Context) {
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
	filter := movementQueryFilter(c)

	rows, _, err := h.svc.ListFiltered(ctx, branchID, fromDate, toDate, filter, "", 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	var noteParts []string
	if !fromDate.IsZero() || !toDate.IsZero() {
		from, to := "…", "…"
		if !fromDate.IsZero() {
			from = fromDate.Format("02 Jan 2006")
		}
		if !toDate.IsZero() {
			to = toDate.Format("02 Jan 2006")
		}
		noteParts = append(noteParts, from+" – "+to)
	}
	if len(filter.Categories) > 0 {
		noteParts = append(noteParts, "type: "+strings.Join(filter.Categories, ", "))
	}

	headers := []string{"Date", "Type", "Source", "Purpose", "Mode", "Bank", "Branch", "Amount", "Loan Status"}
	tableRows := make([][]string, len(rows))
	for i, m := range rows {
		branchName := ""
		if m.Branch != nil {
			branchName = m.Branch.Name
		}
		tableRows[i] = []string{
			m.OccurredOn.Format("2006-01-02"),
			m.Type,
			m.Source,
			m.Purpose,
			m.Mode,
			m.Bank,
			branchName,
			strconv.FormatFloat(m.Amount, 'f', 2, 64),
			m.Status,
		}
	}

	headers, tableRows = branchColumnFor(c, headers, tableRows)

	// format defaults to "pdf" for every existing caller that never sent
	// one — the Ledger filter panel's "Export PDF" / "Export XL" pair (added
	// alongside this) is the only caller that sets it to "xlsx", same
	// ?format= convention internal/reports/export.go's own Export uses.
	if c.Query("format") == "xlsx" {
		xlsxBytes, err := reports.BuildXLSX("Cash Movements", headers, tableRows)
		if err != nil {
			httpx.Fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		c.Header("Content-Disposition", `attachment; filename="cash-movements.xlsx"`)
		c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)
		return
	}

	pdfBytes, err := renderTablePDF(
		"Cash Movements",
		strings.Join(noteParts, " · "),
		headers,
		tableRows,
	)
	if err != nil {
		httpx.Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Disposition", `attachment; filename="cash-movements.pdf"`)
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

// movementResponse embeds CashMovement plus its LoanSource (nil unless this
// is a loan-sourced cash-in) — LoanCashSource lives in its own table (see
// model.go's doc comment), so it's attached here rather than preloaded as a
// GORM association.
type movementResponse struct {
	*CashMovement
	LoanSource *LoanCashSource `json:"loanSource,omitempty"`
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
	httpx.Success(c, http.StatusOK, movementResponse{CashMovement: rec, LoanSource: h.svc.GetLoanSource(ctx, rec.ID)})
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
	Payee        string  `json:"payee"` // legacy free text — the forms no longer ask for it
	FromBankID   *uint   `json:"fromBankId"`
	ToBankID     *uint   `json:"toBankId"`
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
		Mode: req.Mode, Payee: req.Payee, FromBankID: req.FromBankID, ToBankID: req.ToBankID,
		BranchID: req.BranchID, Remarks: req.Remarks, ReceiptImage: req.ReceiptImage,
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
	search := strings.TrimSpace(c.Query("q"))

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.List(ctx, branchID, search, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		totalAmount, err := h.svc.repo.SumFiltered(ctx, branchID, search)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total, "totalAmount": totalAmount})
		return
	}

	rec, _, err := h.svc.List(ctx, branchID, search, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// Export streams every expense-register row for the caller's branch scope
// — see MovementHandler.Export's own doc comment for why this is never
// capped to the table's current page size.
func (h *ExpenseHandler) Export(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID := platform.GetBranchScope(c)
	rows, _, err := h.svc.List(ctx, branchID, "", 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	tableRows := make([][]string, len(rows))
	for i, e := range rows {
		tableRows[i] = []string{
			e.OccurredOn.Format("2006-01-02"),
			e.Category,
			e.Mode,
			e.Branch.Name,
			strconv.FormatFloat(e.Amount, 'f', 2, 64),
			e.Status,
			e.Remarks,
		}
	}

	headers, tableRows := branchColumnFor(c, []string{"Date", "Category", "Mode", "Branch", "Amount", "Status", "Remarks"}, tableRows)
	pdfBytes, err := renderTablePDF(
		"Expense Register",
		"",
		headers,
		tableRows,
	)
	if err != nil {
		httpx.Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Disposition", `attachment; filename="expense-register.pdf"`)
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
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
	rec, err := h.svc.ApproveAs(ctx, id, expenseActor(c, req.ApprovedBy), platform.GetBranchScope(c))
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
	rec, err := h.svc.RejectAs(ctx, id, expenseActor(c, req.ApprovedBy), req.Remarks, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// expenseActor builds the deciding employee from the JWT. fallbackName (the
// optional body field older clients still send) is only used for display
// when the employee's own name can't be looked up.
func expenseActor(c *gin.Context, fallbackName string) ExpenseActor {
	employeeID, role, roleID := platform.ActorFromContext(c)
	if fallbackName == "" {
		fallbackName = role
	}
	return ExpenseActor{EmployeeID: employeeID, RoleID: roleID, Name: fallbackName}
}

// OpeningBalanceHandler wires HTTP requests to the OpeningBalanceService.
type OpeningBalanceHandler struct {
	svc *OpeningBalanceService
}

func NewOpeningBalanceHandler(svc *OpeningBalanceService) *OpeningBalanceHandler {
	return &OpeningBalanceHandler{svc: svc}
}

type setOpeningBalanceRequest struct {
	BranchID   uint    `json:"branchId" binding:"required"`
	Date       string  `json:"date"`       // optional, "YYYY-MM-DD" — defaults to today
	Mode       string  `json:"mode"`       // optional — defaults to "Cash"
	BankID     *uint   `json:"bankId"`     // "to" bank — required unless Mode is Cash
	FromBankID *uint   `json:"fromBankId"` // required unless Mode is Cash
	Amount     float64 `json:"amount"`
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
	if _, ok := platform.NarrowBranch(c, &req.BranchID); !ok {
		httpx.FailErr(c, ErrBranchOutOfScope)
		return
	}
	rec, err := h.svc.Set(ctx, req.BranchID, date, req.Mode, req.BankID, req.FromBankID, req.Amount)
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
	var bankID *uint
	if raw := c.Query("bankId"); raw != "" {
		v, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid bankId")
			return
		}
		id := uint(v)
		bankID = &id
	}
	requested := uint(branchID)
	if _, ok := platform.NarrowBranch(c, &requested); !ok {
		httpx.FailErr(c, ErrBranchOutOfScope)
		return
	}
	rec, err := h.svc.Get(ctx, requested, date, c.Query("mode"), bankID)
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
	// No branchId follows the caller's scope — the selected branch, or all
	// branches; an explicit one may only narrow it.
	branchID, ok := platform.NarrowBranch(c, branchID)
	if !ok {
		httpx.FailErr(c, ErrBranchOutOfScope)
		return
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
	// Mode — see GoldSale.Mode's doc comment. Optional; defaults to "Cash"
	// when blank, matching this field's implicit prior behavior.
	Mode string `json:"mode"`
	// BankID — see GoldSale.BankID's doc comment. Required when Mode is UPI
	// or Bank Transfer.
	BankID       *uint  `json:"bankId"`
	Remarks      string `json:"remarks"`
	ReceiptImage string `json:"receiptImage"` // optional bill
}

func (req goldSaleRequest) toInput() (RecordGoldSaleInput, error) {
	soldOn, err := parseOccurredOn(req.SoldOn)
	if err != nil {
		return RecordGoldSaleInput{}, httpx.NewBadRequest("invalid soldOn: expected YYYY-MM-DD")
	}
	return RecordGoldSaleInput{
		OrnamentType: req.OrnamentType, SoldAmount: req.SoldAmount, CostAmount: req.CostAmount,
		SoldOn: soldOn, BranchID: req.BranchID, Mode: req.Mode, BankID: req.BankID, Remarks: req.Remarks, ReceiptImage: req.ReceiptImage,
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
	search := strings.TrimSpace(c.Query("q"))

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.List(ctx, branchID, fromDate, toDate, search, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		totals, err := h.svc.repo.SumFiltered(ctx, branchID, fromDate, toDate, search)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total,
			"totalSold": totals.TotalSold, "totalCost": totals.TotalCost, "totalProfit": totals.TotalProfit})
		return
	}

	rec, _, err := h.svc.List(ctx, branchID, fromDate, toDate, search, 0, 0)
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

// CashSourceHandler wires HTTP requests to the CashSourceService — backs
// AddCashModal.tsx's "Source of Cash" searchable/creatable picker.
type CashSourceHandler struct {
	svc         *CashSourceService
	movementSvc *MovementService
}

func NewCashSourceHandler(svc *CashSourceService, movementSvc *MovementService) *CashSourceHandler {
	return &CashSourceHandler{svc: svc, movementSvc: movementSvc}
}

// Get backs GET /cash-sources/:id — the source plus, for a loan source with
// its details captured, its current balance.
func (h *CashSourceHandler) Get(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	src, bal, err := h.movementSvc.GetCashSource(ctx, id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"source": src, "isLoan": IsLoanSource(src.Name), "balance": bal})
}

// GetLedger backs GET /cash-sources/:id/ledger — a loan source's own ledger
// (see MovementService.ListLoanSourceLedger).
func (h *CashSourceHandler) GetLedger(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	src, bal, err := h.movementSvc.GetCashSource(ctx, id)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if !IsLoanSource(src.Name) {
		respondCashInLedger(c, h.movementSvc, src)
		return
	}
	if !src.HasLoanDetails() {
		httpx.Fail(c, http.StatusNotFound, "this loan has no details recorded yet")
		return
	}
	respondLoanLedger(c, h.movementSvc, src, bal)
}

// respondLoanLedger writes a loan source's ledger page (or PDF), adding the
// loan's own header fields — shared by the cash-source and expense-category
// ledger endpoints, since a loan's repayment category IS the loan.
func respondLoanLedger(c *gin.Context, svc *MovementService, src *CashSource, bal LoanBalance) {
	ctx := platform.RequestContext(c)
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
	limit, offset, export := ledgerPaging(c)
	rows, total, totals, err := svc.ListLoanSourceLedger(ctx, src, fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	bankName := ""
	if src.Bank != nil {
		bankName = src.Bank.Name
	}
	respondLedger(c, export, "Loan Ledger — "+src.Name, "loan-ledger.pdf", fromDate, toDate, rows, total, totals, gin.H{
		"categoryName": src.Name,
		"loan": gin.H{
			"sourceId": src.ID, "name": src.Name, "bankName": bankName, "loanNumber": src.LoanNumber,
			"principal": bal.Principal, "drawn": bal.Drawn, "repaid": bal.Repaid, "balance": bal.Balance,
		},
	})
}

// List mirrors bank.Handler.List's pagination convention: plain array when
// `limit` is absent, {items, hasMore} envelope when present (the
// SearchableSelect/mobile picker's paginated fetch).
func (h *CashSourceHandler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	if limit <= 0 {
		rec, _, err := h.svc.List(ctx, c.Query("q"), 0, 0)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, rec)
		return
	}

	rec, total, err := h.svc.List(ctx, c.Query("q"), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

type cashSourceRequest struct {
	Name string `json:"name"`
}

func (h *CashSourceHandler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req cashSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, created, err := h.svc.FindOrCreate(ctx, req.Name)
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

// ExpenseCategoryHandler wires HTTP requests to the ExpenseCategoryService —
// backs ExpenseModal.tsx's Category searchable/creatable picker, plus (via
// movementSvc) the category ledger drill-down.
type ExpenseCategoryHandler struct {
	svc         *ExpenseCategoryService
	movementSvc *MovementService
}

func NewExpenseCategoryHandler(svc *ExpenseCategoryService, movementSvc *MovementService) *ExpenseCategoryHandler {
	return &ExpenseCategoryHandler{svc: svc, movementSvc: movementSvc}
}

func (h *ExpenseCategoryHandler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))

	if limit <= 0 {
		rec, _, err := h.svc.List(ctx, c.Query("q"), 0, 0)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, rec)
		return
	}

	rec, total, err := h.svc.List(ctx, c.Query("q"), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

type expenseCategoryRequest struct {
	Name string `json:"name"`
}

func (h *ExpenseCategoryHandler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req expenseCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, created, err := h.svc.FindOrCreate(ctx, req.Name)
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

// GetLedger backs GET /expense-categories/:id/ledger — resolves :id to its
// category name (Expense.Category is still free text; see
// MovementService.ListLedgerByCategory's doc comment), then returns every
// expense recorded under that name as the same normalized LedgerRow shape
// the bank/customer/loan ledgers use.
func (h *ExpenseCategoryHandler) GetLedger(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	cat, err := h.svc.FindByID(ctx, id)
	if err != nil {
		httpx.Fail(c, http.StatusNotFound, "expense category not found")
		return
	}
	// A loan source's same-named category is its repayment category — its
	// ledger is the loan's own ledger, balance and all.
	if src := h.movementSvc.findLoanSource(ctx, cat.Name); src != nil {
		src, bal, err := h.movementSvc.GetCashSource(ctx, src.ID)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		respondLoanLedger(c, h.movementSvc, src, bal)
		return
	}
	// A plain cash-in category (Savings, …) has its own cash-in-only ledger.
	if cat.Type == CategoryCashIn && !cat.IsCommon {
		respondCashInLedger(c, h.movementSvc, cat)
		return
	}
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
	limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := h.movementSvc.ListLedgerByCategory(ctx, cat.Name, platform.GetBranchScope(c), fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	respondLedger(c, export, "Expense Ledger — "+cat.Name, "expense-category-ledger.pdf", fromDate, toDate, rec, total, totals, gin.H{"categoryName": cat.Name})
}

// CategoryHandler backs the unified /categories endpoint — one list for the
// Credit, Debit and Self Transfer pickers, told apart by ?type=.
type CategoryHandler struct {
	svc *CategoryService
}

func NewCategoryHandler(svc *CategoryService) *CategoryHandler {
	return &CategoryHandler{svc: svc}
}

// List backs GET /categories?type=&q=&limit=&offset= — the categories shown on
// the form of that type (its own plus every common one). Paginated like the
// other pickers: {items, hasMore, total} when limit is given.
func (h *CategoryHandler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	typ := c.Query("type")

	if limit <= 0 {
		rec, _, err := h.svc.List(ctx, typ, c.Query("q"), 0, 0)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, rec)
		return
	}
	rec, total, err := h.svc.List(ctx, typ, c.Query("q"), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

type categoryRequest struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Create backs POST /categories — find-or-create by name; a name that already
// exists under another type becomes common (see findOrCreateCategory).
func (h *CategoryHandler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req categoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, created, err := h.svc.FindOrCreate(ctx, req.Name, req.Type)
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

// respondCashInLedger writes a plain cash-in category's ledger page (or PDF) —
// every Add Cash under that name, credits only (see
// MovementService.ListLedgerByCashInCategory).
func respondCashInLedger(c *gin.Context, svc *MovementService, cat *Category) {
	ctx := platform.RequestContext(c)
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
	limit, offset, export := ledgerPaging(c)
	rows, total, totals, err := svc.ListLedgerByCashInCategory(ctx, cat.Name, platform.GetBranchScope(c), fromDate, toDate, limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	respondLedger(c, export, cat.Name+" Ledger", "category-ledger.pdf", fromDate, toDate, rows, total, totals, gin.H{"categoryName": cat.Name})
}
