package loan

import (
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
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
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f := LoanFilter{Query: c.Query("q"), Status: c.Query("status")}
	f.ExcludeBankPledged = c.Query("excludeBankPledged") == "true"
	f.BankPledgeStatus = c.Query("bankPledgeStatus")
	if v := c.Query("branchId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.BranchID = uint(id)
		}
	}
	if v := c.Query("customerId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.CustomerID = uint(id)
		}
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
	rec, total, err := h.svc.ListLoansForCustomer(ctx, customerID, from, to, limit+1, offset)
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
	rec, total, err := h.svc.ListOrnamentsForCustomer(ctx, customerID, from, to, limit+1, offset)
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
	rec, total, err := h.svc.ListPaymentsForCustomer(ctx, customerID, from, to, limit+1, offset)
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
	rec, total, err := h.svc.ListBankPledgesForCustomer(ctx, customerID, from, to, limit+1, offset)
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
	rec, total, err := h.svc.ListAuctionHistoryForCustomer(ctx, customerID, from, to, limit+1, offset)
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

// --- Payments ------------------------------------------------------------

type paymentRequest struct {
	Amount        float64 `json:"amount" binding:"required"`
	Type          string  `json:"type" binding:"required"`
	ProcessingFee float64 `json:"processingFee"`
	PaidOn        string  `json:"paidOn" binding:"required"`
	Method        string  `json:"method"`
	Reference     string  `json:"reference"`
	Description   string  `json:"description"`
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
	paidOn, err := parseDate(req.PaidOn)
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
		Method:               req.Method,
		Reference:            req.Reference,
		Description:          req.Description,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
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

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		rec, total, err := h.svc.ListConcludedAuctions(ctx, platform.GetBranchScope(c), hasSale, limit+1, offset)
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

	recs, _, err := h.svc.ListConcludedAuctions(ctx, platform.GetBranchScope(c), hasSale, 0, 0)
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

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		recs, total, err := h.svc.ListBankPledgeHistory(ctx, branchID, limit+1, offset)
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

	recs, _, err := h.svc.ListBankPledgeHistory(ctx, branchID, 0, 0)
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
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

func (h *Handler) ListRequests(c *gin.Context) {
	ctx := platform.RequestContext(c)
	f := LoanRequestFilter{Status: c.Query("status")}
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

type checklistRequest struct {
	PaymentVerified    *bool    `json:"paymentVerified"`
	PacketVerified     *bool    `json:"packetVerified"`
	BankPledgeVerified *bool    `json:"bankPledgeVerified"`
	CustomerConfirmed  *bool    `json:"customerConfirmed"`
	VerificationNotes  *string  `json:"verificationNotes"`
	Charges            *float64 `json:"charges"`
}

func (h *Handler) VerifyReleaseChecklist(c *gin.Context) {
	ctx := platform.RequestContext(c)
	requestID, err := httpx.IDParam(c, "requestId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req checklistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	_, _, actorRoleID := platform.ActorFromContext(c)
	rec, err := h.svc.VerifyReleaseChecklist(ctx, requestID, platform.GetBranchScope(c), ChecklistInput{
		PaymentVerified:    req.PaymentVerified,
		PacketVerified:     req.PacketVerified,
		BankPledgeVerified: req.BankPledgeVerified,
		CustomerConfirmed:  req.CustomerConfirmed,
		VerificationNotes:  req.VerificationNotes,
		Charges:            req.Charges,
		ActorRoleID:        actorRoleID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type releasePaymentRequest struct {
	Discount float64 `json:"discount"`
	Payment  float64 `json:"payment"`
	// DueDate is a plain "YYYY-MM-DD" string (matching every other date
	// field in this package — see parseDate/auctionScheduleRequest), NOT a
	// bare *time.Time: Go's default time.Time JSON unmarshalling only
	// accepts RFC3339, so the frontend's DatePicker value ("2026-09-16")
	// failed ShouldBindJSON outright and surfaced as an opaque "Invalid
	// input" on Save Payment whenever a due date was required.
	DueDate string `json:"dueDate"`
}

// RecordReleasePayment backs POST /loans/requests/:requestId/release-payment
// — the "Record Payment" step on the Manager-stage release review screen
// (see Service.RecordReleasePayment's doc comment).
func (h *Handler) RecordReleasePayment(c *gin.Context) {
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
	rec, err := h.svc.RecordReleasePayment(c.Request.Context(), requestID, platform.GetBranchScope(c), ReleasePaymentInput{
		Discount:        req.Discount,
		Payment:         req.Payment,
		DueDate:         dueDate,
		ActorEmployeeID: actorEmployeeID,
		ActorRoleID:     actorRoleID,
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

// --- Approval limits ---------------------------------------------------

// GetLoanOperatorApprovalLimit backs GET /loans/approval-limits/loan-operator
// — the Employees page's "Roles" panel reads this to show the current
// hard-enforced cap (see Service.Approve's stage-role check).
func (h *Handler) GetLoanOperatorApprovalLimit(c *gin.Context) {
	ctx := platform.RequestContext(c)
	httpx.Success(c, http.StatusOK, gin.H{"role": "Loan Operator", "maxAmount": h.svc.GetLoanOperatorLimit(ctx)})
}

type approvalLimitRequest struct {
	MaxAmount float64 `json:"maxAmount" binding:"required"`
}

// SetLoanOperatorApprovalLimit backs PUT /loans/approval-limits/loan-operator.
func (h *Handler) SetLoanOperatorApprovalLimit(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req approvalLimitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	amount, err := h.svc.SetLoanOperatorLimit(ctx, req.MaxAmount)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"role": "Loan Operator", "maxAmount": amount})
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
