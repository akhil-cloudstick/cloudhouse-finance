package loan

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler wires HTTP requests to the Service.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func parseDate(s string) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, s)
}

// parsePaidOn is parseDate for a payment date: a date-only value for today
// becomes the current time, so the payment sorts with everything else
// recorded today in the newest-first Ledger instead of at UTC midnight
// (05:30 IST) underneath it — same rule as cash.parseOccurredOn. Other dates
// are left exactly as parseDate reads them.
func parsePaidOn(s string) (time.Time, error) {
	t, err := parseDate(s)
	if err != nil || len(s) != len("2006-01-02") {
		return t, err
	}
	now := time.Now()
	if s == now.Format("2006-01-02") {
		return now, nil
	}
	return t, nil
}

// --- Loan create/list/get -------------------------------------------------

type ornamentRequest struct {
	Name            string  `json:"name" binding:"required"`
	Purity          string  `json:"purity" binding:"required"`
	GrossWeight     float64 `json:"grossWeight" binding:"required"`
	DeductionWeight float64 `json:"deductionWeight"`
	Quantity        int     `json:"quantity"`
	Remarks         string  `json:"remarks"`
}

func (r ornamentRequest) toInput() OrnamentInput {
	return OrnamentInput{
		Name:            r.Name,
		Purity:          r.Purity,
		GrossWeight:     r.GrossWeight,
		DeductionWeight: r.DeductionWeight,
		Quantity:        r.Quantity,
		Remarks:         r.Remarks,
	}
}

type loanRequest struct {
	BranchID        uint              `json:"branchId" binding:"required"`
	CustomerID      uint              `json:"customerId" binding:"required"`
	SchemeID        uint              `json:"schemeId" binding:"required"`
	OpenedDate      string            `json:"openedDate" binding:"required"`
	DueDate         string            `json:"dueDate" binding:"required"`
	PrincipalAmount float64           `json:"principalAmount" binding:"required"`
	Ornaments       []ornamentRequest `json:"ornaments" binding:"required,min=1"`
	LockerID        *uint             `json:"lockerId"`
	AdditionalInfo  string            `json:"additionalInfo"`

	// DraftID, when the loan was submitted from a saved draft, is that
	// draft's id — discarded once the real loan exists so the staff member's
	// draft list doesn't keep offering a form they've already turned into a
	// loan. Optional, and never load-bearing: the loan is created either way
	// (see Service.DeleteDraftQuietly).
	DraftID *uint `json:"draftId"`
}

func (req loanRequest) toInput() (CreateInput, error) {
	opened, err := parseDate(req.OpenedDate)
	if err != nil {
		return CreateInput{}, httpx.NewBadRequest("invalid openedDate: expected YYYY-MM-DD")
	}
	due, err := parseDate(req.DueDate)
	if err != nil {
		return CreateInput{}, httpx.NewBadRequest("invalid dueDate: expected YYYY-MM-DD")
	}
	ornaments := make([]OrnamentInput, len(req.Ornaments))
	for i, o := range req.Ornaments {
		ornaments[i] = o.toInput()
	}
	return CreateInput{
		BranchID:        req.BranchID,
		CustomerID:      req.CustomerID,
		SchemeID:        req.SchemeID,
		OpenedDate:      opened,
		DueDate:         due,
		PrincipalAmount: req.PrincipalAmount,
		Ornaments:       ornaments,
		LockerID:        req.LockerID,
		AdditionalInfo:  req.AdditionalInfo,
	}, nil
}

func (h *Handler) Create(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req loanRequest
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
	// The loan is already created, so a draft that refuses to delete must not
	// turn this into an error response — it's logged and ignored.
	if req.DraftID != nil {
		actorEmployeeID, _, _ := platform.ActorFromContext(c)
		h.svc.DeleteDraftQuietly(ctx, *req.DraftID, actorEmployeeID)
	}
	httpx.Success(c, http.StatusCreated, rec)
}

// StatusDueTodayFilter is the derived `status` value GET /loans accepts on
// top of the stored statuses — see LoanFilter.DueToday.
const StatusDueTodayFilter = "Due Today"

// auctionCase values accepted by GET /loans (the mobile Auctions screen's
// three buckets, plus "all" for their union).
const (
	AuctionCaseAll                 = "all"
	AuctionCaseEligible            = "eligible"
	AuctionCaseDefaulted           = "defaulted"
	AuctionCaseAuctionedBalanceDue = "auctioned_balance_due"
)

// applyStatusParam maps GET /loans's `status` onto f: stored statuses are
// matched verbatim; "Due Today" (case-insensitive) is derived from due_date
// instead, since no loan ever stores it.
func applyStatusParam(f *LoanFilter, status string) {
	status = strings.TrimSpace(status)
	if strings.EqualFold(status, StatusDueTodayFilter) {
		f.DueToday = true
		f.Status = ""
		return
	}
	f.Status = status
}

// applyAuctionCase maps GET /loans's `auctionCase` onto f, replacing any
// `status` — "eligible" and "auctioned_balance_due" are stored statuses,
// "defaulted" is the read-time IsDefaulted flag (LoanFilter.OnlyDefaulted),
// "all" is any of the three (LoanFilter.AllAuctionCases).
// Reports false for an unrecognised value; empty is a no-op.
func applyAuctionCase(f *LoanFilter, auctionCase string) bool {
	switch strings.ToLower(strings.TrimSpace(auctionCase)) {
	case "":
	case AuctionCaseAll:
		f.Status, f.DueToday = "", false
		f.AllAuctionCases = true
	case AuctionCaseEligible:
		f.Status, f.DueToday = StatusAuctionEligible, false
	case AuctionCaseAuctionedBalanceDue:
		f.Status, f.DueToday = StatusAuctionedBalanceDue, false
	case AuctionCaseDefaulted:
		f.Status, f.DueToday = "", false
		f.OnlyDefaulted = true
	default:
		return false
	}
	return true
}

// List returns a bare array of every matching loan when no `limit` query
// param is given (the Loans page's behaviour, unchanged). When `limit` is
// given — the paginated SearchableSelect loan pickers — it fetches one extra
// row beyond the page to determine `hasMore` cheaply, PLUS a real total row
// count (Repository.FindAll's own COUNT(*) over the same filter, ignoring
// Limit/Offset) so the frontend can show a genuine "Page X of Y" instead of
// a guessed total, and responds with the {items, hasMore, total} shape
// (itself now under the outer {success, data} envelope). Mirrors
// internal/customer's List. `excludeBankPledged=true` additionally drops
// loans already sitting with a bank (see LoanFilter.ExcludeBankPledged).
//
// `status` matches the stored Loan.Status verbatim (Pending Approval, Active,
// Due Soon, Overdue, Closure Requested, Closed, Defaulted, Auction Eligible,
// Auctioned, Auctioned - Balance Due, Rejected), plus one derived value,
// "Due Today" (see LoanFilter.DueToday). `auctionCase` (all | eligible |
// defaulted | auctioned_balance_due) selects one of the mobile Auctions
// screen's buckets and, when given, replaces `status` — see
// applyAuctionCase.
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f := LoanFilter{Query: strings.TrimSpace(c.Query("q"))}
	// `status` may be a comma-separated list (the Loans page's multi-select
	// filter): the loan matches any of the listed stored statuses.
	if statuses := splitCSV(c.Query("status")); len(statuses) > 1 {
		f.StatusIn = statuses
	} else {
		applyStatusParam(&f, c.Query("status"))
	}
	if !applyAuctionCase(&f, c.Query("auctionCase")) {
		httpx.Fail(c, http.StatusBadRequest, "invalid auctionCase: expected all, eligible, defaulted or auctioned_balance_due")
		return
	}
	// `servicing` (due_soon | overdue | defaulted) is the Loans page's
	// read-time tabs; a single value replaces `status`, since these classes
	// are not stored statuses. Several values (comma-separated) are OR-ed with
	// each other and with any stored `status` values.
	if svs := splitCSV(strings.ToLower(c.Query("servicing"))); len(svs) > 0 {
		for _, sv := range svs {
			if !validServicing(sv) {
				httpx.Fail(c, http.StatusBadRequest, "invalid servicing: expected due_soon, overdue or defaulted")
				return
			}
		}
		if len(svs) == 1 && len(f.StatusIn) == 0 && f.Status == "" {
			f.DueToday, f.Servicing = false, svs[0]
		} else if len(svs) == 1 && f.Status == "" {
			f.DueToday, f.ServicingIn = false, svs
		} else {
			if f.Status != "" {
				f.StatusIn = append(f.StatusIn, f.Status)
			}
			f.Status, f.DueToday, f.ServicingIn = "", false, svs
		}
	}
	f.ExcludeBankPledged = c.Query("excludeBankPledged") == "true"
	f.BankPledgeStatus = c.Query("bankPledgeStatus")
	if ids := parseUintCSV(c.Query("branchId")); len(ids) == 1 {
		f.BranchID = ids[0]
	} else {
		f.BranchIDs = ids
	}
	if ids := parseUintCSV(c.Query("customerId")); len(ids) == 1 {
		f.CustomerID = ids[0]
	} else {
		f.CustomerIDs = ids
	}
	if v := c.Query("schemeId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.SchemeID = uint(id)
		}
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return
	}
	f.OpenedFrom, f.OpenedTo = from, to
	f.BranchScope = platform.GetBranchScope(c)

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		f.Limit, f.Offset = limit+1, offset
		rec, total, err := h.svc.List(ctx, f)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		// `total` (from h.svc.List) is a real COUNT over the same filter, so
		// the table can render "Page X of N" up front instead of growing N by
		// one every time the user pages forward (all `hasMore` alone can
		// support).
		httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
		return
	}

	rec, _, err := h.svc.List(ctx, f)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) Get(c *gin.Context) {
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

// GetByLoanNumber backs GET /loans/by-number/:loanNumber — a direct, atomic
// lookup by the human-readable loan number (mirrors packet.Handler.GetByCode).
func (h *Handler) GetByLoanNumber(c *gin.Context) {
	ctx := platform.RequestContext(c)
	rec, err := h.svc.GetByLoanNumber(ctx, c.Param("loanNumber"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// --- Ornaments -------------------------------------------------------------

func (h *Handler) AddOrnament(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req ornamentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.AddOrnament(ctx, loanID, req.toInput())
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) UpdateOrnament(c *gin.Context) {
	ctx := platform.RequestContext(c)
	ornamentID, err := httpx.IDParam(c, "ornamentId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req ornamentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.UpdateOrnament(ctx, ornamentID, req.toInput())
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// DeleteOrnament backs DELETE /loans/ornaments/:ornamentId — see
// Service.DeleteOrnament's own doc comment.
func (h *Handler) DeleteOrnament(c *gin.Context) {
	ornamentID, err := httpx.IDParam(c, "ornamentId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.DeleteOrnament(platform.RequestContext(c), ornamentID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type updateLoanRequest struct {
	SchemeID        *uint    `json:"schemeId"`
	PrincipalAmount *float64 `json:"principalAmount"`
}

// UpdateLoan backs PATCH /loans/:id — see Service.UpdateLoan's own doc
// comment for exactly what "editable after sanction" does and doesn't
// change.
func (h *Handler) UpdateLoan(c *gin.Context) {
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req updateLoanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	// Same rationale as Approve's handler: actor identity comes from the
	// authenticated JWT, never the request body — only used if this edit
	// turns out to touch a material field and the loan gets resubmitted
	// for approval (see UpdateLoan's own doc comment).
	actorEmployeeID, actorRole, _ := platform.ActorFromContext(c)
	rec, err := h.svc.UpdateLoan(platform.RequestContext(c), loanID, UpdateLoanInput{
		SchemeID:        req.SchemeID,
		PrincipalAmount: req.PrincipalAmount,
		ActorEmployeeID: actorEmployeeID,
		ActorRole:       actorRole,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type purityTestRequest struct {
	TestedPurity          string  `json:"testedPurity" binding:"required"`
	TestedGrossWeight     float64 `json:"testedGrossWeight" binding:"required"`
	TestedDeductionWeight float64 `json:"testedDeductionWeight"`
	TestingRemarks        string  `json:"testingRemarks"`
	TestedBy              string  `json:"testedBy" binding:"required"`
	TestedAt              string  `json:"testedAt" binding:"required"`
}

func (h *Handler) RecordPurityTest(c *gin.Context) {
	ctx := platform.RequestContext(c)
	ornamentID, err := httpx.IDParam(c, "ornamentId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req purityTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	testedAt, err := parseDate(req.TestedAt)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid testedAt: expected YYYY-MM-DD")
		return
	}
	rec, err := h.svc.RecordPurityTest(ctx, ornamentID, PurityTestInput{
		TestedPurity:          req.TestedPurity,
		TestedGrossWeight:     req.TestedGrossWeight,
		TestedDeductionWeight: req.TestedDeductionWeight,
		TestingRemarks:        req.TestingRemarks,
		TestedBy:              req.TestedBy,
		TestedAt:              testedAt,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type ornamentImageRequest struct {
	ImageURL string `json:"imageUrl" binding:"required"`
}

func (h *Handler) AddOrnamentImage(c *gin.Context) {
	ctx := platform.RequestContext(c)
	ornamentID, err := httpx.IDParam(c, "ornamentId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req ornamentImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.AddOrnamentImage(ctx, ornamentID, req.ImageURL)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

// --- Approval workflow -------------------------------------------------

type approvalRequest struct {
	Stage   string `json:"stage" binding:"required"`
	Action  string `json:"action" binding:"required"`
	Remarks string `json:"remarks"`

	// CashAmount/UpiAmount/BankTransferAmount/ChequeAmount — only meaningful
	// (and only validated) when this call is the one that clears
	// FinalSanction and triggers disbursement; see ApprovalInput's doc
	// comment.
	CashAmount         float64 `json:"cashAmount"`
	UpiAmount          float64 `json:"upiAmount"`
	BankTransferAmount float64 `json:"bankTransferAmount"`
	ChequeAmount       float64 `json:"chequeAmount"`
	// BankID — which bank the UPI/Bank Transfer/Cheque portion of the
	// disbursement was sent from; mirrors PaymentInput.BankID. Only
	// meaningful (and only stored) at the FinalSanction stage that triggers
	// the actual cash-out movement.
	BankID *uint `json:"bankId"`
}

func (h *Handler) Approve(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req approvalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	// Actor identity comes from the authenticated JWT, never the request
	// body — otherwise any caller could submit {"role":"Administrator"} and
	// self-approve any stage regardless of who they actually are.
	actorEmployeeID, actorRole, actorRoleID := platform.ActorFromContext(c)
	rec, err := h.svc.Approve(ctx, loanID, ApprovalInput{
		Stage:              req.Stage,
		Action:             req.Action,
		ActorEmployeeID:    actorEmployeeID,
		ActorRole:          actorRole,
		ActorRoleID:        actorRoleID,
		Remarks:            req.Remarks,
		CashAmount:         req.CashAmount,
		UpiAmount:          req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount,
		ChequeAmount:       req.ChequeAmount,
		BankID:             req.BankID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// GetCustomer360 handles GET /customers/:id/profile360?from=&to= — mounted
// directly on the customers group in main.go (not loan's own route group)
// since the URL is customer-shaped, even though the aggregation logic lives
// in internal/loan (see Service.GetCustomer360's doc comment for why).
// from/to are optional inclusive YYYY-MM-DD bounds on each loan's opened
// date; omitting both returns the customer's full history.
func (h *Handler) GetCustomer360(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var from, to *time.Time
	if v := c.Query("from"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid from: expected YYYY-MM-DD")
			return
		}
		from = &parsed
	}
	if v := c.Query("to"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid to: expected YYYY-MM-DD")
			return
		}
		to = &parsed
	}
	if from != nil && to != nil && to.Before(*from) {
		httpx.Fail(c, http.StatusBadRequest, "invalid range: to is before from")
		return
	}
	rec, err := h.svc.GetCustomer360(ctx, customerID, from, to)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// parseOpenedRange reads the shared from/to YYYY-MM-DD query params used by
// GetCustomer360 and the 5 customer-scoped sub-table endpoints below,
// returning a BadRequest on a malformed date or an inverted range.
func parseOpenedRange(c *gin.Context) (from, to *time.Time, ok bool) {
	if v := c.Query("from"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid from: expected YYYY-MM-DD")
			return nil, nil, false
		}
		from = &parsed
	}
	if v := c.Query("to"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid to: expected YYYY-MM-DD")
			return nil, nil, false
		}
		to = &parsed
	}
	if from != nil && to != nil && to.Before(*from) {
		httpx.Fail(c, http.StatusBadRequest, "invalid range: to is before from")
		return nil, nil, false
	}
	return from, to, true
}

// customerSubTableLimitOffset reads the shared limit/offset query params for
// the 5 customer-scoped sub-table endpoints below, mirroring Handler.List's
// convention: limit+1 is requested so the extra row can be sliced off to
// compute hasMore without a second COUNT query.
func customerSubTableLimitOffset(c *gin.Context) (limit, offset int) {
	limit, _ = strconv.Atoi(c.Query("limit"))
	offset, _ = strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// ListLoansForCustomer backs GET /customers/:id/loans — the Customer 360
// view's Loan History sub-table, paginated server-side instead of sliced
// client-side out of GetCustomer360's full loan set.
func (h *Handler) ListLoansForCustomer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return
	}
	limit, offset := customerSubTableLimitOffset(c)
	rec, total, err := h.svc.ListLoansForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.Query("q")), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := limit > 0 && len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

// ListOrnamentsForCustomer backs GET /customers/:id/ornaments — the
// Customer 360 view's Pledged Ornaments (all loans) sub-table.
func (h *Handler) ListOrnamentsForCustomer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return
	}
	limit, offset := customerSubTableLimitOffset(c)
	rec, total, err := h.svc.ListOrnamentsForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.Query("q")), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := limit > 0 && len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

// ListPaymentsForCustomer backs GET /customers/:id/payments — the
// Customer 360 view's Payment History (all loans) sub-table.
func (h *Handler) ListPaymentsForCustomer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return
	}
	limit, offset := customerSubTableLimitOffset(c)
	rec, total, err := h.svc.ListPaymentsForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.Query("q")), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := limit > 0 && len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

// ListBankPledgesForCustomer backs GET /customers/:id/bank-pledges — the
// Customer 360 view's Bank Pledges (all loans) sub-table.
func (h *Handler) ListBankPledgesForCustomer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return
	}
	limit, offset := customerSubTableLimitOffset(c)
	rec, total, err := h.svc.ListBankPledgesForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.Query("q")), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := limit > 0 && len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

// ListAuctionHistoryForCustomer backs GET /customers/:id/auction-history —
// the Customer 360 view's Auction History sub-table.
func (h *Handler) ListAuctionHistoryForCustomer(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return
	}
	limit, offset := customerSubTableLimitOffset(c)
	rec, total, err := h.svc.ListAuctionHistoryForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.Query("q")), limit+1, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	hasMore := limit > 0 && len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": rec, "hasMore": hasMore, "total": total})
}

// ListApprovals returns the full per-decision audit history for a loan's
// sanction chain (GET /:id/approvals) — used by the frontend's stage
// tracker to show who acted at each stage and when.
func (h *Handler) ListApprovals(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.ListApprovals(ctx, loanID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// GetInterestCollected handles GET /loans/interest-collected?from=&to= —
// both optional, defaulting to the current calendar month (YYYY-MM-01
// through today) when omitted, matching Dashboard.tsx's default KPI
// window.
func (h *Handler) GetInterestCollected(c *gin.Context) {
	ctx := platform.RequestContext(c)
	now := time.Now()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	to := now
	if v := c.Query("from"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid from: expected YYYY-MM-DD")
			return
		}
		from = parsed
	}
	if v := c.Query("to"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid to: expected YYYY-MM-DD")
			return
		}
		to = parsed
	}
	total, err := h.svc.GetInterestCollected(ctx, from, to)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"interestCollected": total, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}

// NextNumber backs GET /loans/next-number — the number the next created loan
// will receive, for New Loan's read-only "Loan No (auto)" field.
func (h *Handler) NextNumber(c *gin.Context) {
	maxSuffix, err := h.svc.repo.MaxLoanNumberSuffix(platform.RequestContext(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"loanNumber": fmt.Sprintf("LN-%05d", maxSuffix+1)})
}

// riskStatusAllowed reports whether status is one of the risk-eligible
// statuses ListLoanRiskAssessment accepts — same set the page's own status
// filter dropdown offers, so a mistyped/stale value fails clearly instead
// of silently matching nothing.
func riskStatusAllowed(status string) bool {
	for _, s := range riskEligibleStatuses {
		if s == status {
			return true
		}
	}
	return false
}

// riskLevelAllowed reports whether v is a real RiskLevel wire value —
// same "reject an unrecognized filter value outright" treatment
// riskStatusAllowed gives `status`.
func riskLevelAllowed(v string) bool {
	switch RiskLevel(v) {
	case RiskSafe, RiskAtRisk, RiskLoss:
		return true
	default:
		return false
	}
}

// ListRiskAssessment backs GET /loans/risk-assessment — see
// Service.ListLoanRiskAssessment's own doc comment. Query params: `status`
// (one of the risk-eligible statuses, omitted for "All"), `riskLevel` (one of
// Safe/AtRisk/Loss, omitted for "All" — narrows the returned rows but not
// `counts`, so the KPI tiles stay a true breakdown of the whole matching set
// even while one level is selected), `from`/`to` (opened-date range,
// "YYYY-MM-DD"), `limit`/`offset` (paginated when limit > 0). Response always
// carries `total`/`counts` across every loan matching status/from/to (not
// just the current page or the riskLevel filter), for the page's KPI tiles.
func (h *Handler) ListRiskAssessment(c *gin.Context) {
	ctx := platform.RequestContext(c)

	status := c.Query("status")
	if status != "" && !riskStatusAllowed(status) {
		httpx.Fail(c, http.StatusBadRequest, "invalid status")
		return
	}

	riskLevel := c.Query("riskLevel")
	if riskLevel != "" && !riskLevelAllowed(riskLevel) {
		httpx.Fail(c, http.StatusBadRequest, "invalid riskLevel")
		return
	}

	from, to, ok := parseOpenedRange(c)
	if !ok {
		return
	}

	f := RiskAssessmentFilter{
		Status:      status,
		RiskLevel:   RiskLevel(riskLevel),
		BranchScope: platform.GetBranchScope(c),
		OpenedFrom:  from,
		OpenedTo:    to,
		Query:       strings.TrimSpace(c.Query("q")),
	}

	if limit, _ := strconv.Atoi(c.Query("limit")); limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		f.Limit, f.Offset = limit, offset
	}

	result, err := h.svc.ListLoanRiskAssessment(ctx, f)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{
		"items":   result.Items,
		"hasMore": result.HasMore,
		"total":   result.Total,
		"counts": gin.H{
			"loss":   result.Counts[RiskLoss],
			"atRisk": result.Counts[RiskAtRisk],
			"safe":   result.Counts[RiskSafe],
		},
	})
}

// --- Payments ------------------------------------------------------------

type paymentRequest struct {
	Amount             float64 `json:"amount" binding:"required"`
	Type               string  `json:"type" binding:"required"`
	ProcessingFee      float64 `json:"processingFee"`
	PaidOn             string  `json:"paidOn" binding:"required"`
	CashAmount         float64 `json:"cashAmount"`
	UpiAmount          float64 `json:"upiAmount"`
	BankTransferAmount float64 `json:"bankTransferAmount"`
	ChequeAmount       float64 `json:"chequeAmount"`
	// BankID — see PaymentInput.BankID's own doc comment. Required when any
	// of UpiAmount/BankTransferAmount/ChequeAmount is non-zero.
	BankID      *uint  `json:"bankId"`
	Reference   string `json:"reference"`
	Description string `json:"description"`
	// InterestOverride — see PaymentInput.InterestOverride's own doc
	// comment. Omitted/null means "use the system-calculated figure",
	// same as before this field existed.
	InterestOverride *float64 `json:"interestOverride"`
}

// staffSelectablePaymentTypes are the only Types this endpoint accepts — the
// five modes the Record Payment dropdown offers. allocatePayment knows other
// types (Auction Sale, Auction Write-Off, Adjustment, Waiver), but those are
// raised by the auction/ledger-correction flows themselves, never posted by a
// client: an Auction Sale here would move gold proceeds through the till
// twice, and a Waiver would forgive real money with no approval behind it.
var staffSelectablePaymentTypes = map[string]bool{
	PaymentTypeInterest:       true,
	PaymentTypePenalInterest:  true,
	PaymentTypePrincipal:      true,
	PaymentTypePartial:        true,
	PaymentTypeFullSettlement: true,
}

func (h *Handler) RecordPayment(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req paymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	if !staffSelectablePaymentTypes[req.Type] {
		httpx.Fail(c, http.StatusBadRequest, "type must be one of: Interest, Penal Interest, Principal, Partial, Full Settlement")
		return
	}
	paidOn, err := parsePaidOn(req.PaidOn)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid paidOn: expected YYYY-MM-DD")
		return
	}
	// Actor identity comes from the authenticated JWT, not the request body
	// — see platform.ActorFromContext's doc comment.
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.RecordPayment(ctx, loanID, PaymentInput{
		Amount:               req.Amount,
		Type:                 req.Type,
		ProcessingFee:        req.ProcessingFee,
		PaidOn:               paidOn,
		ReceivedByEmployeeID: &actorEmployeeID,
		CashAmount:           req.CashAmount,
		UpiAmount:            req.UpiAmount,
		BankTransferAmount:   req.BankTransferAmount,
		ChequeAmount:         req.ChequeAmount,
		BankID:               req.BankID,
		Reference:            req.Reference,
		Description:          req.Description,
		InterestOverride:     req.InterestOverride,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

type topUpRequest struct {
	Amount             float64 `json:"amount" binding:"required"`
	CashAmount         float64 `json:"cashAmount"`
	UpiAmount          float64 `json:"upiAmount"`
	BankTransferAmount float64 `json:"bankTransferAmount"`
	ChequeAmount       float64 `json:"chequeAmount"`
	// OccurredOn is optional, "YYYY-MM-DD" — defaults to today (matching
	// RecordMovementInput's convention) when omitted.
	OccurredOn string `json:"occurredOn"`
	Reference  string `json:"reference"`
	// SettleInterest is "require" (default, if omitted) or "deduct" — see
	// TopUpSettleRequire/TopUpSettleDeduct's own doc comments.
	SettleInterest string `json:"settleInterest"`
}

// TopUpLoan lets staff draw additional cash against an already-Active
// loan's spare eligible value — see Service.TopUpLoan.
func (h *Handler) TopUpLoan(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req topUpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	var occurredOn time.Time
	if req.OccurredOn != "" {
		occurredOn, err = parseDate(req.OccurredOn)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid occurredOn: expected YYYY-MM-DD")
			return
		}
	}
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.TopUpLoan(ctx, loanID, TopUpInput{
		Amount:               req.Amount,
		CashAmount:           req.CashAmount,
		UpiAmount:            req.UpiAmount,
		BankTransferAmount:   req.BankTransferAmount,
		ChequeAmount:         req.ChequeAmount,
		OccurredOn:           occurredOn,
		Reference:            req.Reference,
		SettleInterest:       req.SettleInterest,
		ReceivedByEmployeeID: actorEmployeeID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// ListTopUps returns a loan's full top-up history, newest first.
func (h *Handler) ListTopUps(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.ListTopUps(ctx, loanID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// --- Auction (7-stage workflow) ---------------------------------------------

func (h *Handler) GetAuction(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.GetAuctionRecord(ctx, loanID, platform.GetBranchScope(c))
	if err != nil {
		// ?optional=1: "no case yet" is an expected answer for the web
		// Auctions screen (it asks about every eligible loan), so it gets a
		// 200 with a null body instead of a 404 the browser logs as an error.
		if c.Query("optional") == "1" && errors.Is(err, ErrAuctionNotFound) {
			httpx.Success(c, http.StatusOK, nil)
			return
		}
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// actorPtr returns the authenticated caller's employee ID as a pointer (nil if
// absent) alongside their role (for the auction/pledge audit trails) and
// roleID (for the Approval Workflow permission checks — see
// authz.Repository.IsAllowed). Identity always comes from the JWT, never the
// request body — see platform.ActorFromContext.
func actorPtr(c *gin.Context) (*uint, string, uint) {
	id, role, roleID := platform.ActorFromContext(c)
	if id == 0 {
		return nil, role, roleID
	}
	return &id, role, roleID
}

func (h *Handler) MarkAuctionEligible(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := h.svc.MarkAuctionEligible(ctx, loanID, platform.GetBranchScope(c), actorID, actorRole, actorRoleID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

// GetAuctionHistory returns every auction case ever opened against a loan,
// including concluded ones — previously only the single current case was
// reachable, so past attempts were invisible.
func (h *Handler) GetAuctionHistory(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	recs, err := h.svc.GetAuctionHistory(ctx, loanID, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

// ListConcludedAuctions backs the Auctions screen's History tab.
//
// hasSale=true|false narrows to the "Auctions Conducted" vs "Closed Without
// Auction" sub-tables server-side, so each can be paginated independently
// without one sub-table's page skipping over the other's rows. limit/offset
// follow the same convention as Handler.List: when limit is absent the
// original bare-array response is preserved for any other caller.
func (h *Handler) ListConcludedAuctions(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var hasSale *bool
	if v := c.Query("hasSale"); v == "true" || v == "false" {
		b := v == "true"
		hasSale = &b
	}
	query := strings.TrimSpace(c.Query("q"))

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.ListConcludedAuctions(ctx, platform.GetBranchScope(c), hasSale, query, limit+1, offset)
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

	recs, _, err := h.svc.ListConcludedAuctions(ctx, platform.GetBranchScope(c), hasSale, query, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

// ListPendingAuctionDecisions returns escalations awaiting a human decision.
func (h *Handler) ListPendingAuctionDecisions(c *gin.Context) {
	ctx := platform.RequestContext(c)
	reqs, err := h.svc.ListPendingAuctionDecisions(ctx, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, reqs)
}

type auctionDecisionRequestBody struct {
	RequestID uint   `json:"requestId" binding:"required"`
	Decision  string `json:"decision" binding:"required"`
	Remarks   string `json:"remarks"`
}

// ResolveAuctionDecision applies a human decision to an escalation — keep/
// remove for a part-payment, or write-off/pursue for a post-auction shortfall.
// Role authority is enforced in the service, since it differs per kind.
func (h *Handler) ResolveAuctionDecision(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req auctionDecisionRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := h.svc.ResolveAuctionDecision(ctx, loanID, req.RequestID, platform.GetBranchScope(c), req.Decision, req.Remarks, actorID, actorRole, actorRoleID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// auctionNoticeRequest no longer takes a method — IssueAuctionNotice always
// fires every channel in auctionNoticeChannels (WhatsApp) at once, so
// remarks is the only optional field left; an empty/missing body is fine.
type auctionNoticeRequest struct {
	Remarks string `json:"remarks"`
}

func (h *Handler) IssueAuctionNotice(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req auctionNoticeRequest
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := h.svc.IssueAuctionNotice(ctx, loanID, platform.GetBranchScope(c), req.Remarks, actorID, actorRole, actorRoleID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type auctionScheduleRequest struct {
	AuctionDate     string `json:"auctionDate" binding:"required"`
	ReferenceNumber string `json:"referenceNumber"`
}

func (h *Handler) ScheduleAuction(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req auctionScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	auctionDate, err := parseDate(req.AuctionDate)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid auctionDate: expected YYYY-MM-DD")
		return
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := h.svc.ScheduleAuction(ctx, loanID, platform.GetBranchScope(c), auctionDate, req.ReferenceNumber, actorID, actorRole, actorRoleID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type auctionSaleRequest struct {
	SaleAmount      float64 `json:"saleAmount" binding:"required"`
	AuctionExpenses float64 `json:"auctionExpenses"`
}

func (h *Handler) RecordAuctionSale(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req auctionSaleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := h.svc.RecordAuctionSale(ctx, loanID, platform.GetBranchScope(c), req.SaleAmount, req.AuctionExpenses, actorID, actorRole, actorRoleID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// auctionSettleRequest now carries the SURPLUS DISPOSITION rather than a
// generic settlement status: settlement is only reachable when the sale
// covered the debt, and the only remaining question is what happens to the
// money left over, which belongs to the customer. "settlementStatus" is still
// accepted as an alias so an older client is not hard-broken.
type auctionSettleRequest struct {
	Disposition      string `json:"disposition"`
	SettlementStatus string `json:"settlementStatus"`
	Remarks          string `json:"remarks"`
}

func (h *Handler) SettleAuction(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req auctionSettleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	disposition := req.Disposition
	if disposition == "" {
		disposition = req.SettlementStatus
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := h.svc.SettleAuction(ctx, loanID, platform.GetBranchScope(c), disposition, req.Remarks, actorID, actorRole, actorRoleID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// --- Bank pledge ---------------------------------------------------------

type bankPledgeRequest struct {
	BankID            *uint   `json:"bankId"`
	BankName          string  `json:"bankName" binding:"required"`
	PledgedAmount     float64 `json:"pledgedAmount" binding:"required"`
	PledgeDate        string  `json:"pledgeDate" binding:"required"`
	BankInterestRate  float64 `json:"bankInterestRate"`
	ReferenceNumber   string  `json:"referenceNumber"`
	BankPledgeDueDate string  `json:"bankPledgeDueDate"`

	// CashTreatment: "CashIn" books the bank's advance into Cash-in-Hand,
	// "RecordOnly" creates the record with no cash effect. OMITTED means
	// RecordOnly — the safe default, so cash is only ever touched when the
	// operator explicitly asks for it. An unrecognised value is rejected rather
	// than being coerced, so a typo cannot silently suppress a real cash entry.
	CashTreatment string `json:"cashTreatment"`
}

func (h *Handler) RecordBankPledge(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req bankPledgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	pledgeDate, err := parseDate(req.PledgeDate)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "invalid pledgeDate: expected YYYY-MM-DD")
		return
	}
	var dueDate *time.Time
	if req.BankPledgeDueDate != "" {
		d, err := parseDate(req.BankPledgeDueDate)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid bankPledgeDueDate: expected YYYY-MM-DD")
			return
		}
		dueDate = &d
	}
	// Absent means "no cash effect". Deliberately NOT defaulted to CashIn: a
	// caller that forgot the field should end up with a harmless book-keeping
	// record, not an unintended movement of money into the till.
	cashTreatment := req.CashTreatment
	if cashTreatment == "" {
		cashTreatment = BankPledgeCashTreatmentRecordOnly
	}
	actorID, actorRole, _ := actorPtr(c)
	rec, err := h.svc.RecordBankPledge(ctx, loanID, platform.GetBranchScope(c), BankPledgeInput{
		BankID:            req.BankID,
		BankName:          req.BankName,
		PledgedAmount:     req.PledgedAmount,
		PledgeDate:        pledgeDate,
		BankInterestRate:  req.BankInterestRate,
		ReferenceNumber:   req.ReferenceNumber,
		BankPledgeDueDate: dueDate,
		CashTreatment:     cashTreatment,
		ActorEmployeeID:   actorID,
		ActorRole:         actorRole,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) ReleaseBankPledge(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	pledgeID, err := httpx.IDParam(c, "pledgeId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	actorID, actorRole, _ := actorPtr(c)
	rec, err := h.svc.ReleaseBankPledge(ctx, loanID, pledgeID, platform.GetBranchScope(c), actorID, actorRole)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type voidBankPledgeRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// VoidBankPledge cancels a re-pledge recorded in error. This is the only way to
// correct a mis-chosen cash treatment, which is immutable by design — see
// Service.VoidBankPledge.
func (h *Handler) VoidBankPledge(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	pledgeID, err := httpx.IDParam(c, "pledgeId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req voidBankPledgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	actorID, actorRole, _ := actorPtr(c)
	rec, err := h.svc.VoidBankPledge(ctx, loanID, pledgeID, platform.GetBranchScope(c), req.Reason, actorID, actorRole)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// GetBankPledgeHistory returns every re-pledge ever recorded against a loan,
// released and voided ones included, each with its audit trail.
func (h *Handler) GetBankPledgeHistory(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	recs, err := h.svc.GetBankPledgeHistory(ctx, loanID, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

// ListBankPledgeHistory backs the Bank Re-Pledge screen's History tab, which
// previously had no way to show anything but currently-pledged gold.
func (h *Handler) ListBankPledgeHistory(c *gin.Context) {
	ctx := platform.RequestContext(c)
	branchID := platform.GetBranchScope(c)
	query := c.Query("q")

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		recs, total, err := h.svc.ListBankPledgeHistory(ctx, branchID, query, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(recs) > limit
		if hasMore {
			recs = recs[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": recs, "hasMore": hasMore, "total": total})
		return
	}

	recs, _, err := h.svc.ListBankPledgeHistory(ctx, branchID, query, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

// --- Extension & release requests ------------------------------------------

type extensionRequestRequest struct {
	Months      int    `json:"months" binding:"required"`
	Detail      string `json:"detail"`
	RequestedBy string `json:"requestedBy"`
}

func (h *Handler) CreateExtensionRequest(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req extensionRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.CreateExtensionRequest(ctx, loanID, ExtensionRequestInput{
		Months:      req.Months,
		Detail:      req.Detail,
		RequestedBy: req.RequestedBy,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

type releaseRequestRequest struct {
	Detail      string `json:"detail"`
	RequestedBy string `json:"requestedBy"`
	// OrnamentIDs selects a Partial Ornament Release's subset of the loan's
	// currently-pledged ornaments — omitted/empty means a full release,
	// unchanged from before this field existed. See ReleaseRequestInput's
	// own doc comment for the exact full-vs-partial rule.
	OrnamentIDs []uint `json:"ornamentIds"`
}

func (h *Handler) CreateReleaseRequest(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req releaseRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	rec, err := h.svc.CreateReleaseRequest(ctx, loanID, ReleaseRequestInput{
		Detail:      req.Detail,
		RequestedBy: req.RequestedBy,
		OrnamentIDs: req.OrnamentIDs,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) ListRequests(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f := LoanRequestFilter{Status: c.Query("status"), Query: strings.TrimSpace(c.Query("q"))}
	switch strings.ToLower(strings.TrimSpace(c.Query("type"))) {
	case "":
	case "extension":
		f.Type = RequestTypeExtension
	case "release":
		f.Type = RequestTypeRelease
	default:
		httpx.Fail(c, http.StatusBadRequest, "invalid type: expected extension or release")
		return
	}
	if v := c.Query("loanId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LoanID = uint(id)
		}
	}
	f.BranchID = platform.GetBranchScope(c)

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		f.Limit, f.Offset = limit+1, offset
		rec, total, err := h.svc.ListRequests(ctx, f)
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

	rec, _, err := h.svc.ListRequests(ctx, f)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type decideRequestRequest struct {
	Action  string `json:"action" binding:"required"` // "Approved" | "Rejected"
	Remarks string `json:"remarks"`
}

func (h *Handler) DecideRequest(c *gin.Context) {
	ctx := platform.RequestContext(c)
	requestID, err := httpx.IDParam(c, "requestId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req decideRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	var approve bool
	switch req.Action {
	case ApprovalStageApproved:
		approve = true
	case ApprovalStageRejected:
		approve = false
	default:
		httpx.FailErr(c, ErrInvalidAction)
		return
	}
	// Actor identity comes from the authenticated JWT, not the request body
	// — see platform.ActorFromContext's doc comment.
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.DecideRequest(ctx, requestID, platform.GetBranchScope(c), approve, actorEmployeeID, req.Remarks)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// --- Release verification checklist & approval chain ----------------------

// VerifyReleaseChecklist parses its body as a raw map rather than a typed
// struct: it needs to tell "customerSawGold explicitly sent as false" apart
// from "field omitted" (ChecklistInput.CustomerSawGold is a *bool, updated
// only when non-nil), and the old checklist's PacketVerified/
// BankPledgeVerified/PaymentVerified/CustomerConfirmed fields are simply
// ignored if an old client still sends them — see ChecklistInput's own doc
// comment on why those retired fields no longer do anything.
func (h *Handler) VerifyReleaseChecklist(c *gin.Context) {
	ctx := platform.RequestContext(c)
	requestID, err := httpx.IDParam(c, "requestId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	var customerSawGold *bool
	if v, ok := raw["customerSawGold"]; ok {
		b, _ := v.(bool)
		customerSawGold = &b
	}
	var verificationNotes *string
	if v, ok := raw["verificationNotes"]; ok {
		s, _ := v.(string)
		verificationNotes = &s
	}
	var charges *float64
	if v, ok := raw["charges"]; ok {
		f, _ := v.(float64)
		charges = &f
	}
	_, _, actorRoleID := platform.ActorFromContext(c)
	rec, err := h.svc.VerifyReleaseChecklist(ctx, requestID, platform.GetBranchScope(c), ChecklistInput{
		CustomerSawGold:   customerSawGold,
		VerificationNotes: verificationNotes,
		Charges:           charges,
		ActorRoleID:       actorRoleID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type releasePaymentRequest struct {
	// Type is any general PaymentType* value (Interest, Principal, Partial,
	// Full Settlement, ...) — see ReleasePaymentInput.Type's own comment.
	// Defaults to Partial when omitted.
	Type               string   `json:"type"`
	Amount             float64  `json:"amount"`
	Discount           float64  `json:"discount"`
	CashAmount         float64  `json:"cashAmount"`
	UpiAmount          float64  `json:"upiAmount"`
	BankTransferAmount float64  `json:"bankTransferAmount"`
	ChequeAmount       float64  `json:"chequeAmount"`
	BankID             *uint    `json:"bankId"`
	Method             string   `json:"method"`
	Reference          string   `json:"reference"`
	InterestOverride   *float64 `json:"interestOverride"`
	// DueDate is a plain "YYYY-MM-DD" string (matching every other date
	// field in this package — see parseDate/auctionScheduleRequest), NOT a
	// bare *time.Time: Go's default time.Time JSON unmarshalling only
	// accepts RFC3339, so the frontend's DatePicker value ("2026-09-16")
	// failed ShouldBindJSON outright and surfaced as an opaque "Invalid
	// input" on Save Payment whenever a due date was required.
	DueDate string `json:"dueDate"`
}

// RecordReleasePayment backs POST /loans/requests/:requestId/release-payment
// — the "Record Payment" step on the release review screen (see
// Service.RecordReleaseRequestPayment's doc comment). Handler name kept
// stable even though it now calls RecordReleaseRequestPayment underneath —
// same route, same request shape family, just driven by the general
// payment path instead of a bespoke Interest/Principal split.
func (h *Handler) RecordReleasePayment(c *gin.Context) {
	ctx := platform.RequestContext(c)
	requestID, err := httpx.IDParam(c, "requestId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req releasePaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	var dueDate *time.Time
	if req.DueDate != "" {
		d, err := parseDate(req.DueDate)
		if err != nil {
			httpx.Fail(c, http.StatusBadRequest, "invalid dueDate: expected YYYY-MM-DD")
			return
		}
		dueDate = &d
	}
	actorEmployeeID, _, actorRoleID := platform.ActorFromContext(c)
	rec, err := h.svc.RecordReleaseRequestPayment(ctx, requestID, platform.GetBranchScope(c), ReleasePaymentInput{
		Type:               req.Type,
		Amount:             req.Amount,
		Discount:           req.Discount,
		CashAmount:         req.CashAmount,
		UpiAmount:          req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount,
		ChequeAmount:       req.ChequeAmount,
		BankID:             req.BankID,
		Method:             req.Method,
		Reference:          req.Reference,
		InterestOverride:   req.InterestOverride,
		DueDate:            dueDate,
		ActorEmployeeID:    actorEmployeeID,
		ActorRoleID:        actorRoleID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type releaseApprovalRequest struct {
	Stage   string `json:"stage" binding:"required"`
	Action  string `json:"action" binding:"required"`
	Remarks string `json:"remarks"`
}

// ApproveRequest backs POST /loans/requests/:requestId/approve, dispatching
// on the request's Type: Extension -> ApproveExtensionRequest, Release ->
// ApproveReleaseRequest. Both take the same {stage, action, remarks} body
// shape, so one handler reads the request first to route it rather than
// requiring the caller to know which type they're deciding.
func (h *Handler) ApproveRequest(c *gin.Context) {
	ctx := platform.RequestContext(c)
	requestID, err := httpx.IDParam(c, "requestId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req releaseApprovalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}

	lr, err := h.svc.GetRequest(ctx, requestID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	// Actor identity comes from the authenticated JWT, not the request body
	// — see platform.ActorFromContext's doc comment.
	actorEmployeeID, actorRole, actorRoleID := platform.ActorFromContext(c)

	switch lr.Type {
	case RequestTypeExtension:
		rec, err := h.svc.ApproveExtensionRequest(ctx, requestID, platform.GetBranchScope(c), ExtensionApprovalInput{
			Stage:           req.Stage,
			Action:          req.Action,
			ActorEmployeeID: actorEmployeeID,
			ActorRole:       actorRole,
			ActorRoleID:     actorRoleID,
			Remarks:         req.Remarks,
		})
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, rec)
	case RequestTypeRelease:
		rec, err := h.svc.ApproveReleaseRequest(ctx, requestID, platform.GetBranchScope(c), ReleaseApprovalInput{
			Stage:           req.Stage,
			Action:          req.Action,
			ActorEmployeeID: actorEmployeeID,
			ActorRoleID:     actorRoleID,
			Remarks:         req.Remarks,
		})
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		httpx.Success(c, http.StatusOK, rec)
	default:
		httpx.FailErr(c, ErrInvalidRequestType)
	}
}

// ApproveTopUp backs POST /loans/topups/:topUpId/approve — the same
// {stage, action, remarks} body as the request approvals above.
func (h *Handler) ApproveTopUp(c *gin.Context) {
	ctx := platform.RequestContext(c)
	topUpID, err := httpx.IDParam(c, "topUpId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req releaseApprovalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	actorEmployeeID, actorRole, actorRoleID := platform.ActorFromContext(c)
	rec, err := h.svc.ApproveTopUp(ctx, topUpID, platform.GetBranchScope(c), TopUpApprovalInput{
		Stage:           req.Stage,
		Action:          req.Action,
		ActorEmployeeID: actorEmployeeID,
		ActorRole:       actorRole,
		ActorRoleID:     actorRoleID,
		Remarks:         req.Remarks,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

func (h *Handler) CompleteRelease(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	// Actor identity comes from the authenticated JWT — no request body
	// needed at all now (previously just carried a spoofable employeeId).
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.CompleteRelease(ctx, loanID, platform.GetBranchScope(c), actorEmployeeID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// HardDeleteLoan backs DELETE /loans/:id/hard-delete — see
// Service.HardDeleteLoan's own doc comment for the full cascade. Gated by
// its own "can hard delete loan" permission at the route, not
// perms.Delete.
func (h *Handler) HardDeleteLoan(c *gin.Context) {
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if err := h.svc.HardDeleteLoan(platform.RequestContext(c), loanID); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"deleted": true})
}

// --- Indemnity bond Aadhaar eSign (Setu) --------------------------------

// startIndemnityBondEsignRequest carries the frontend's own callback page
// URL — Setu redirects the customer's browser there once they finish
// Aadhaar+OTP signing — same shape as customer.Handler's
// startAadhaarVerifyRequest.
type startIndemnityBondEsignRequest struct {
	Lang        string `json:"lang" binding:"required"`
	RedirectURL string `json:"redirectUrl" binding:"required"`
	// DeliverBy chooses how the signing URL reaches the customer —
	// "open" (default), "whatsapp", or "dashboard"; see
	// Service.StartIndemnityBondSign's deliverBy doc comment.
	DeliverBy string `json:"deliverBy"`
}

// StartIndemnityBondEsign renders the loan's indemnity bond (in the
// requested language), uploads it to Setu, and returns the Aadhaar eSign
// signing URL the CUSTOMER must open themselves to complete OTP signing —
// in addition to delivering it via WhatsApp or the customer's dashboard
// when req.DeliverBy asks for that.
func (h *Handler) StartIndemnityBondEsign(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req startIndemnityBondEsignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	signReq, err := h.svc.StartIndemnityBondSign(ctx, loanID, platform.GetBranchScope(c), req.Lang, req.RedirectURL, req.DeliverBy)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{
		"id":         signReq.ID,
		"documentId": signReq.DocumentID,
		"status":     signReq.Status,
		"url":        signReq.URL,
	})
}

// CheckIndemnityBondEsign polls the outstanding Setu signature request
// (started by StartIndemnityBondEsign) for this loan. Returns the current
// status while the customer hasn't finished signing yet (poll again
// later), or the updated loan (carrying the stored signed-document URL)
// once "sign_complete".
func (h *Handler) CheckIndemnityBondEsign(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, status, err := h.svc.CheckIndemnityBondSign(ctx, loanID, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{
		"loan":   rec,
		"status": status.Status,
	})
}

// DownloadIndemnityBondPDF renders the loan's pledge agreement in the
// requested language (?lang=en|gu, default en) and returns it as a plain
// PDF download — no Setu/eSign involved, just the same document staff
// would otherwise get via the client-side "print for wet-ink signing"
// copy (frontend/modules/loans/utils/indemnityBond.ts), except this one
// has a real per-page header/footer (only possible server-side, via
// chromedp — see RenderIndemnityBondPDF's header/footer template comment).
func (h *Handler) DownloadIndemnityBondPDF(c *gin.Context) {
	ctx := platform.RequestContext(c)

	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	lang := c.DefaultQuery("lang", BondLangEnglish)
	pdfBytes, filename, err := h.svc.RenderIndemnityBondPDFForLoan(ctx, loanID, platform.GetBranchScope(c), lang)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

// DownloadReleaseAgreementPDF renders the loan's FORM 7 discharge receipt in
// the requested language (?lang=en|ml, default en) and returns it as a plain
// PDF download — the server-side replacement for the client-side
// window.print() copy frontend/modules/loans/utils/releaseAgreement.ts used
// to build, with a real per-page header/footer (see RenderReleaseAgreementPDF).
func (h *Handler) DownloadReleaseAgreementPDF(c *gin.Context) {
	ctx := platform.RequestContext(c)

	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	lang := c.DefaultQuery("lang", BondLangEnglish)
	pdfBytes, filename, err := h.svc.RenderReleaseAgreementPDFForLoan(ctx, loanID, platform.GetBranchScope(c), lang)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

// DownloadPartialReleaseReceiptPDF backs
// GET /loans/requests/:requestId/partial-release-receipt/pdf — the Partial
// Ornament Release counterpart to DownloadReleaseAgreementPDF above. Only
// valid for a Release request with IsPartial true; a full release keeps
// using the FORM 7 endpoint instead.
func (h *Handler) DownloadPartialReleaseReceiptPDF(c *gin.Context) {
	ctx := platform.RequestContext(c)

	requestID, err := httpx.IDParam(c, "requestId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	lang := c.DefaultQuery("lang", BondLangEnglish)
	pdfBytes, filename, err := h.svc.RenderPartialReleaseReceiptPDFForRequest(ctx, requestID, platform.GetBranchScope(c), lang)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

// indemnityBondPreviewOrnament/indemnityBondPreviewRequest mirror
// frontend/modules/loans/components/NewLoan.tsx's buildDraft() output
// (loanNumber/name/dob/address/branchName/phone/pan/aadhaar/
// principalAmount/interestRate/dueDate/ornaments) — the same shape
// printIndemnityBond() used to build for its now-retired client-side
// window.print() copy.
type indemnityBondPreviewOrnament struct {
	Name        string  `json:"name"`
	Purity      string  `json:"purity"`
	GrossWeight float64 `json:"grossWeight"`
	NetWeight   float64 `json:"netWeight"`
	Value       float64 `json:"value"`
}

type indemnityBondPreviewRequest struct {
	LoanNumber      string                         `json:"loanNumber"`
	Name            string                         `json:"name"`
	DOB             string                         `json:"dob"` // "YYYY-MM-DD", optional
	Address         string                         `json:"address"`
	BranchName      string                         `json:"branchName"`
	Phone           string                         `json:"phone"`
	PAN             string                         `json:"pan"`
	Aadhaar         string                         `json:"aadhaar"`
	PrincipalAmount float64                        `json:"principalAmount"`
	InterestRate    float64                        `json:"interestRate"`
	DueDate         string                         `json:"dueDate"` // "YYYY-MM-DD", optional
	Ornaments       []indemnityBondPreviewOrnament `json:"ornaments"`
}

// PreviewIndemnityBondPDF renders the pledge agreement PDF from draft data
// the frontend hasn't saved as a real loan yet (New Loan's pre-submission
// preview) — everything DownloadIndemnityBondPDF renders from a saved
// Loan, this renders straight from the request body instead, so the
// New Loan page's preview gets the exact same server-rendered PDF (real
// per-page header/footer included) as every other bond download, without
// requiring a loan to exist first.
func (h *Handler) PreviewIndemnityBondPDF(c *gin.Context) {
	var req indemnityBondPreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	lang := c.DefaultQuery("lang", BondLangEnglish)
	if lang != BondLangEnglish && lang != BondLangMalayalam && lang != BondLangGujarati {
		httpx.FailErr(c, ErrUnsupportedIndemnityBondLang)
		return
	}

	age := 0
	if req.DOB != "" {
		if dob, err := time.Parse("2006-01-02", req.DOB); err == nil {
			age = int(time.Since(dob).Hours() / 24 / 365.25)
		}
	}
	var dueDate time.Time
	if req.DueDate != "" {
		if d, err := time.Parse("2006-01-02", req.DueDate); err == nil {
			dueDate = d
		}
	}
	ornaments := make([]BondOrnament, 0, len(req.Ornaments))
	for _, o := range req.Ornaments {
		ornaments = append(ornaments, BondOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			Value:       o.Value,
		})
	}
	now := time.Now()
	data := BondData{
		LoanNumber:      req.LoanNumber,
		CustomerName:    req.Name,
		Age:             age,
		Address:         req.Address,
		BranchName:      req.BranchName,
		Phone:           req.Phone,
		PAN:             req.PAN,
		Aadhaar:         req.Aadhaar,
		PrincipalAmount: req.PrincipalAmount,
		InterestRate:    req.InterestRate,
		Ornaments:       ornaments,
		Day:             now.Day(),
		Month:           now.Month().String(),
		Year:            now.Year(),
		DueDate:         dueDate,
	}
	h.svc.FillLenderProfile(platform.RequestContext(c), &data)

	pdfBytes, err := RenderIndemnityBondPDF(data, lang)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	filename := "Pledge-Agreement-Preview.pdf"
	if lang == BondLangGujarati {
		filename = "Pledge-Agreement-Preview-Gujarati.pdf"
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

// --- Loan drafts ------------------------------------------------------------

type draftOrnamentRequest struct {
	Name        string  `json:"name"`
	Purity      string  `json:"purity"`
	GrossWeight float64 `json:"grossWeight"`
	Quantity    int     `json:"quantity"`
	ImageURL    string  `json:"imageUrl"`
	ImageName   string  `json:"imageName"`
}

// draftRequest is the New Gold Loan form as sent by "Save Draft". Note the
// absence of `binding:"required"` on everything except branchId, and the
// pointer types: unlike loanRequest, a draft is explicitly allowed to be
// incomplete, and "not chosen yet" (null) must be distinguishable from
// "chosen as zero".
type draftRequest struct {
	BranchID          uint                   `json:"branchId" binding:"required"`
	CustomerID        *uint                  `json:"customerId"`
	SchemeID          *uint                  `json:"schemeId"`
	LockerID          *uint                  `json:"lockerId"`
	PrincipalOverride *float64               `json:"principalOverride"`
	Ornaments         []draftOrnamentRequest `json:"ornaments"`
}

func (req draftRequest) toInput() DraftInput {
	ornaments := make([]DraftOrnamentInput, len(req.Ornaments))
	for i, o := range req.Ornaments {
		ornaments[i] = DraftOrnamentInput{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			Quantity:    o.Quantity,
			ImageURL:    o.ImageURL,
			ImageName:   o.ImageName,
		}
	}
	return DraftInput{
		BranchID:          req.BranchID,
		CustomerID:        req.CustomerID,
		SchemeID:          req.SchemeID,
		LockerID:          req.LockerID,
		PrincipalOverride: req.PrincipalOverride,
		Ornaments:         ornaments,
	}
}

// SaveDraft handles POST /loans/drafts — the first press of "Save Draft".
func (h *Handler) SaveDraft(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req draftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	// Ownership comes from the JWT, never the body — otherwise a caller could
	// write drafts into (or read them out of) someone else's queue.
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.SaveDraft(ctx, actorEmployeeID, req.toInput())
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

// UpdateDraft handles PUT /loans/drafts/:draftId — subsequent presses of
// "Save Draft" on a form already saved once, overwriting rather than piling
// up near-duplicate drafts.
func (h *Handler) UpdateDraft(c *gin.Context) {
	ctx := platform.RequestContext(c)
	draftID, err := httpx.IDParam(c, "draftId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req draftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.UpdateDraft(ctx, draftID, actorEmployeeID, req.toInput())
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// ListDrafts handles GET /loans/drafts — the caller's own saved drafts only.
func (h *Handler) ListDrafts(c *gin.Context) {
	ctx := platform.RequestContext(c)
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.ListDrafts(ctx, actorEmployeeID, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// GetDraft handles GET /loans/drafts/:draftId, used to reopen a draft in the
// New Gold Loan form.
func (h *Handler) GetDraft(c *gin.Context) {
	ctx := platform.RequestContext(c)
	draftID, err := httpx.IDParam(c, "draftId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	rec, err := h.svc.GetDraft(ctx, draftID, actorEmployeeID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// DeleteDraft handles DELETE /loans/drafts/:draftId — discarding a draft the
// staff member no longer needs.
func (h *Handler) DeleteDraft(c *gin.Context) {
	ctx := platform.RequestContext(c)
	draftID, err := httpx.IDParam(c, "draftId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	actorEmployeeID, _, _ := platform.ActorFromContext(c)
	if err := h.svc.DeleteDraft(ctx, draftID, actorEmployeeID); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Draft deleted successfully")
}

// Statement streams a customer-facing PDF account statement for one loan.
//
// Gated by "can view loan" (perms.Read) rather than a permission of its own:
// the statement contains nothing the loan detail screen does not already
// show, so anyone who may read the loan may print it. Branch scoping and
// tenant filtering both apply through Service.Statement -> Service.Get, so a
// loan from another branch or another business is a plain not-found.
func (h *Handler) Statement(c *gin.Context) {
	ctx := platform.RequestContext(c)

	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	data, filename, err := h.svc.Statement(ctx, loanID, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	// Attachment, not inline: this is a document the borrower is given, and
	// naming the file after the loan means it is identifiable once saved.
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Data(http.StatusOK, "application/pdf", data)
}

// GetLedger backs GET /loans/:id/ledger — one page of the loan's Payment
// Ledger (limit/offset, optional from/to and a focusKey or focusDate +
// focusAmount row to open on), read-gated and branch-scoped like Get.
func (h *Handler) GetLedger(c *gin.Context) {
	ctx := platform.RequestContext(c)
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	from := c.Query("from")
	to := c.Query("to")
	focusAmountParam := c.Query("focusAmount")
	q := LoanLedgerQuery{From: from, To: to, FocusKey: c.Query("focusKey"), FocusDate: c.Query("focusDate")}
	for _, k := range strings.Split(c.Query("kinds"), ",") {
		if k = strings.TrimSpace(k); k != "" {
			q.Kinds = append(q.Kinds, k)
		}
	}
	q.Limit, _ = strconv.Atoi(c.Query("limit"))
	q.Offset, _ = strconv.Atoi(c.Query("offset"))
	for _, d := range []string{from, to} {
		if _, err := time.Parse("2006-01-02", d); d != "" && err != nil {
			httpx.Fail(c, http.StatusBadRequest, "Dates must be in YYYY-MM-DD format")
			return
		}
	}
	if v, err := strconv.ParseFloat(focusAmountParam, 64); focusAmountParam != "" && err == nil {
		q.FocusAmount = &v
	}
	page, err := h.svc.GetLoanLedger(ctx, loanID, platform.GetBranchScope(c), q)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, page)
}
