package loan

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
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

func parseDate(s string) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, s)
}

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrOrnamentNotFound), errors.Is(err, ErrRequestNotFound),
		errors.Is(err, ErrAuctionNotFound), errors.Is(err, ErrPledgeNotFound),
		errors.Is(err, ErrAuctionDecisionNotFound):
		return http.StatusNotFound
	// A role that reached the route but may not perform this specific action —
	// notably an Auction Administrator attempting a shortfall write-off, which
	// only Branch Manager/Management/Administrator may decide.
	case errors.Is(err, ErrShortfallAuthorityRequired):
		return http.StatusForbidden
	// The auction is frozen pending a repayment decision. 409 rather than 400:
	// the request is well-formed, it simply conflicts with the case's current
	// state, and retrying after the decision is made will succeed.
	case errors.Is(err, ErrAuctionDecisionPending), errors.Is(err, ErrAuctionDecisionAlreadyDecided),
		errors.Is(err, ErrSurplusAlreadyDisposed), errors.Is(err, ErrPledgeNotActive):
		return http.StatusConflict
	case errors.Is(err, ErrBranchInvalid), errors.Is(err, ErrCustomerInvalid),
		errors.Is(err, ErrCustomerNotVerified), errors.Is(err, ErrSchemeInvalid),
		errors.Is(err, ErrNoOrnaments), errors.Is(err, ErrNoGoldRate),
		errors.Is(err, ErrGoldRateNotSetToday),
		errors.Is(err, ErrInvalidPurity), errors.Is(err, ErrInvalidWeight),
		errors.Is(err, ErrPrincipalTooHigh), errors.Is(err, ErrInvalidPrincipal),
		errors.Is(err, ErrInvalidDueDate), errors.Is(err, ErrWrongStage),
		errors.Is(err, ErrAlreadyDecided), errors.Is(err, ErrInvalidAction),
		errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrInvalidRequestType),
		errors.Is(err, ErrInvalidMonths), errors.Is(err, ErrRequestAlreadyDecided),
		errors.Is(err, ErrInvalidPaymentType), errors.Is(err, ErrExceedsOutstanding),
		errors.Is(err, ErrNotExtensionRequest), errors.Is(err, ErrNotReleaseRequest),
		errors.Is(err, ErrLoanTerminalState), errors.Is(err, ErrChecklistIncomplete),
		errors.Is(err, ErrOutstandingBalanceRemains), errors.Is(err, ErrBankPledgeStillActive),
		errors.Is(err, ErrLoanNotDefaulted), errors.Is(err, ErrAuctionAlreadyStarted),
		errors.Is(err, ErrAuctionWrongStage), errors.Is(err, ErrExceedsApprovalLimit),
		errors.Is(err, ErrAwaitingOperatorVerification),
		errors.Is(err, ErrInvalidCashTreatment), errors.Is(err, ErrVoidReasonRequired),
		errors.Is(err, ErrInvalidAuctionDecision), errors.Is(err, ErrAuctionBalanceDueCannotSettle),
		errors.Is(err, ErrNoSurplusToDispose), errors.Is(err, ErrInvalidSurplusDisposition),
		errors.Is(err, ErrSettlementRemarksRequired), errors.Is(err, ErrDecisionRemarksRequired):
		return http.StatusBadRequest
	case errors.Is(err, ErrReleaseNotApproved):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

func fail(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{"error": err.Error()})
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
}

func (req loanRequest) toInput() (CreateInput, error) {
	opened, err := parseDate(req.OpenedDate)
	if err != nil {
		return CreateInput{}, errors.New("invalid openedDate: expected YYYY-MM-DD")
	}
	due, err := parseDate(req.DueDate)
	if err != nil {
		return CreateInput{}, errors.New("invalid dueDate: expected YYYY-MM-DD")
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
	}, nil
}

func (h *Handler) Create(c *gin.Context) {
	var req loanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	input, err := req.toInput()
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	input.BranchID = platform.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := h.svc.Create(input)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) List(c *gin.Context) {
	f := LoanFilter{Query: c.Query("q"), Status: c.Query("status")}
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
	f.BranchScope = platform.GetBranchScope(c)
	rec, err := h.svc.List(f)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) Get(c *gin.Context) {
	id, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.Get(id, platform.GetBranchScope(c))
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// GetByLoanNumber backs GET /loans/by-number/:loanNumber — a direct, atomic
// lookup by the human-readable loan number (mirrors packet.Handler.GetByCode).
func (h *Handler) GetByLoanNumber(c *gin.Context) {
	rec, err := h.svc.GetByLoanNumber(c.Param("loanNumber"))
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// --- Ornaments -------------------------------------------------------------

func (h *Handler) AddOrnament(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req ornamentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.AddOrnament(loanID, req.toInput())
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) UpdateOrnament(c *gin.Context) {
	ornamentID, err := idParam(c, "ornamentId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req ornamentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.UpdateOrnament(ornamentID, req.toInput())
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
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
	ornamentID, err := idParam(c, "ornamentId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req purityTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	testedAt, err := parseDate(req.TestedAt)
	if err != nil {
		fail(c, http.StatusBadRequest, errors.New("invalid testedAt: expected YYYY-MM-DD"))
		return
	}
	rec, err := h.svc.RecordPurityTest(ornamentID, PurityTestInput{
		TestedPurity:          req.TestedPurity,
		TestedGrossWeight:     req.TestedGrossWeight,
		TestedDeductionWeight: req.TestedDeductionWeight,
		TestingRemarks:        req.TestingRemarks,
		TestedBy:              req.TestedBy,
		TestedAt:              testedAt,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

type ornamentImageRequest struct {
	ImageURL string `json:"imageUrl" binding:"required"`
}

func (h *Handler) AddOrnamentImage(c *gin.Context) {
	ornamentID, err := idParam(c, "ornamentId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req ornamentImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.AddOrnamentImage(ornamentID, req.ImageURL)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

// --- Approval workflow -------------------------------------------------

type approvalRequest struct {
	Stage   string `json:"stage" binding:"required"`
	Action  string `json:"action" binding:"required"`
	Remarks string `json:"remarks"`
}

func (h *Handler) Approve(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req approvalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	// Actor identity comes from the authenticated JWT, never the request
	// body — otherwise any caller could submit {"role":"Administrator"} and
	// self-approve any stage regardless of who they actually are.
	actorEmployeeID, actorRole := platform.ActorFromContext(c)
	rec, err := h.svc.Approve(loanID, ApprovalInput{
		Stage:           req.Stage,
		Action:          req.Action,
		ActorEmployeeID: actorEmployeeID,
		ActorRole:       actorRole,
		Remarks:         req.Remarks,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// GetCustomer360 handles GET /customers/:id/profile360?from=&to= — mounted
// directly on the customers group in main.go (not loan's own route group)
// since the URL is customer-shaped, even though the aggregation logic lives
// in internal/loan (see Service.GetCustomer360's doc comment for why).
// from/to are optional inclusive YYYY-MM-DD bounds on each loan's opened
// date; omitting both returns the customer's full history.
func (h *Handler) GetCustomer360(c *gin.Context) {
	customerID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var from, to *time.Time
	if v := c.Query("from"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("invalid from: expected YYYY-MM-DD"))
			return
		}
		from = &parsed
	}
	if v := c.Query("to"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("invalid to: expected YYYY-MM-DD"))
			return
		}
		to = &parsed
	}
	if from != nil && to != nil && to.Before(*from) {
		fail(c, http.StatusBadRequest, errors.New("invalid range: to is before from"))
		return
	}
	rec, err := h.svc.GetCustomer360(customerID, from, to)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// ListApprovals returns the full per-decision audit history for a loan's
// sanction chain (GET /:id/approvals) — used by the frontend's stage
// tracker to show who acted at each stage and when.
func (h *Handler) ListApprovals(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.ListApprovals(loanID)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// GetInterestCollected handles GET /loans/interest-collected?from=&to= —
// both optional, defaulting to the current calendar month (YYYY-MM-01
// through today) when omitted, matching Dashboard.tsx's default KPI
// window.
func (h *Handler) GetInterestCollected(c *gin.Context) {
	now := time.Now()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	to := now
	if v := c.Query("from"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("invalid from: expected YYYY-MM-DD"))
			return
		}
		from = parsed
	}
	if v := c.Query("to"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("invalid to: expected YYYY-MM-DD"))
			return
		}
		to = parsed
	}
	total, err := h.svc.GetInterestCollected(from, to)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"interestCollected": total, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
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

func (h *Handler) RecordPayment(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req paymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	paidOn, err := parseDate(req.PaidOn)
	if err != nil {
		fail(c, http.StatusBadRequest, errors.New("invalid paidOn: expected YYYY-MM-DD"))
		return
	}
	// Actor identity comes from the authenticated JWT, not the request body
	// — see platform.ActorFromContext's doc comment.
	actorEmployeeID, _ := platform.ActorFromContext(c)
	rec, err := h.svc.RecordPayment(loanID, PaymentInput{
		Amount:               req.Amount,
		Type:                 req.Type,
		ProcessingFee:        req.ProcessingFee,
		PaidOn:               paidOn,
		ReceivedByEmployeeID: actorEmployeeID,
		Method:               req.Method,
		Reference:            req.Reference,
		Description:          req.Description,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

// --- Auction (7-stage workflow) ---------------------------------------------

func (h *Handler) GetAuction(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.GetAuctionRecord(loanID, platform.GetBranchScope(c))
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// actorPtr returns the authenticated caller's employee ID as a pointer (nil if
// absent) alongside their role, for the auction/pledge audit trails. Identity
// always comes from the JWT, never the request body — see
// platform.ActorFromContext.
func actorPtr(c *gin.Context) (*uint, string) {
	id, role := platform.ActorFromContext(c)
	if id == 0 {
		return nil, role
	}
	return &id, role
}

func (h *Handler) MarkAuctionEligible(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.MarkAuctionEligible(loanID, platform.GetBranchScope(c), actorID, actorRole)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

// GetAuctionHistory returns every auction case ever opened against a loan,
// including concluded ones — previously only the single current case was
// reachable, so past attempts were invisible.
func (h *Handler) GetAuctionHistory(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	recs, err := h.svc.GetAuctionHistory(loanID, platform.GetBranchScope(c))
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, recs)
}

// ListConcludedAuctions backs the Auctions screen's History tab.
func (h *Handler) ListConcludedAuctions(c *gin.Context) {
	recs, err := h.svc.ListConcludedAuctions(platform.GetBranchScope(c))
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, recs)
}

// ListPendingAuctionDecisions returns escalations awaiting a human decision.
func (h *Handler) ListPendingAuctionDecisions(c *gin.Context) {
	reqs, err := h.svc.ListPendingAuctionDecisions(platform.GetBranchScope(c))
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, reqs)
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
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req auctionDecisionRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.ResolveAuctionDecision(loanID, req.RequestID, platform.GetBranchScope(c), req.Decision, req.Remarks, actorID, actorRole)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// auctionNoticeRequest no longer takes a method — IssueAuctionNotice always
// fires all three channels (SMS, WhatsApp, Registered Post) at once, so
// remarks is the only optional field left; an empty/missing body is fine.
type auctionNoticeRequest struct {
	Remarks string `json:"remarks"`
}

func (h *Handler) IssueAuctionNotice(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req auctionNoticeRequest
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		fail(c, http.StatusBadRequest, err)
		return
	}
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.IssueAuctionNotice(loanID, platform.GetBranchScope(c), req.Remarks, actorID, actorRole)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

type auctionScheduleRequest struct {
	AuctionDate     string `json:"auctionDate" binding:"required"`
	ReferenceNumber string `json:"referenceNumber"`
}

func (h *Handler) ScheduleAuction(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req auctionScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	auctionDate, err := parseDate(req.AuctionDate)
	if err != nil {
		fail(c, http.StatusBadRequest, errors.New("invalid auctionDate: expected YYYY-MM-DD"))
		return
	}
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.ScheduleAuction(loanID, platform.GetBranchScope(c), auctionDate, req.ReferenceNumber, actorID, actorRole)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

type auctionSaleRequest struct {
	SaleAmount      float64 `json:"saleAmount" binding:"required"`
	AuctionExpenses float64 `json:"auctionExpenses"`
}

func (h *Handler) RecordAuctionSale(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req auctionSaleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.RecordAuctionSale(loanID, platform.GetBranchScope(c), req.SaleAmount, req.AuctionExpenses, actorID, actorRole)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
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
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req auctionSettleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	disposition := req.Disposition
	if disposition == "" {
		disposition = req.SettlementStatus
	}
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.SettleAuction(loanID, platform.GetBranchScope(c), disposition, req.Remarks, actorID, actorRole)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
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
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req bankPledgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	pledgeDate, err := parseDate(req.PledgeDate)
	if err != nil {
		fail(c, http.StatusBadRequest, errors.New("invalid pledgeDate: expected YYYY-MM-DD"))
		return
	}
	var dueDate *time.Time
	if req.BankPledgeDueDate != "" {
		d, err := parseDate(req.BankPledgeDueDate)
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("invalid bankPledgeDueDate: expected YYYY-MM-DD"))
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
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.RecordBankPledge(loanID, platform.GetBranchScope(c), BankPledgeInput{
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
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) ReleaseBankPledge(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	pledgeID, err := idParam(c, "pledgeId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.ReleaseBankPledge(loanID, pledgeID, platform.GetBranchScope(c), actorID, actorRole)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

type voidBankPledgeRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// VoidBankPledge cancels a re-pledge recorded in error. This is the only way to
// correct a mis-chosen cash treatment, which is immutable by design — see
// Service.VoidBankPledge.
func (h *Handler) VoidBankPledge(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	pledgeID, err := idParam(c, "pledgeId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req voidBankPledgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	actorID, actorRole := actorPtr(c)
	rec, err := h.svc.VoidBankPledge(loanID, pledgeID, platform.GetBranchScope(c), req.Reason, actorID, actorRole)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// GetBankPledgeHistory returns every re-pledge ever recorded against a loan,
// released and voided ones included, each with its audit trail.
func (h *Handler) GetBankPledgeHistory(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	recs, err := h.svc.GetBankPledgeHistory(loanID, platform.GetBranchScope(c))
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, recs)
}

// ListBankPledgeHistory backs the Bank Re-Pledge screen's History tab, which
// previously had no way to show anything but currently-pledged gold.
func (h *Handler) ListBankPledgeHistory(c *gin.Context) {
	recs, err := h.svc.ListBankPledgeHistory(platform.GetBranchScope(c))
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, recs)
}

// --- Extension & release requests ------------------------------------------

type extensionRequestRequest struct {
	Months      int    `json:"months" binding:"required"`
	Detail      string `json:"detail"`
	RequestedBy string `json:"requestedBy"`
}

func (h *Handler) CreateExtensionRequest(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req extensionRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.CreateExtensionRequest(loanID, ExtensionRequestInput{
		Months:      req.Months,
		Detail:      req.Detail,
		RequestedBy: req.RequestedBy,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

type releaseRequestRequest struct {
	Detail      string `json:"detail"`
	RequestedBy string `json:"requestedBy"`
}

func (h *Handler) CreateReleaseRequest(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req releaseRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.CreateReleaseRequest(loanID, ReleaseRequestInput{
		Detail:      req.Detail,
		RequestedBy: req.RequestedBy,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) ListRequests(c *gin.Context) {
	f := LoanRequestFilter{Status: c.Query("status")}
	if v := c.Query("loanId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.LoanID = uint(id)
		}
	}
	f.BranchID = platform.GetBranchScope(c)
	rec, err := h.svc.ListRequests(f)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

type decideRequestRequest struct {
	Action  string `json:"action" binding:"required"` // "Approved" | "Rejected"
	Remarks string `json:"remarks"`
}

func (h *Handler) DecideRequest(c *gin.Context) {
	requestID, err := idParam(c, "requestId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req decideRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var approve bool
	switch req.Action {
	case ApprovalStageApproved:
		approve = true
	case ApprovalStageRejected:
		approve = false
	default:
		fail(c, http.StatusBadRequest, ErrInvalidAction)
		return
	}
	// Actor identity comes from the authenticated JWT, not the request body
	// — see platform.ActorFromContext's doc comment.
	actorEmployeeID, _ := platform.ActorFromContext(c)
	rec, err := h.svc.DecideRequest(requestID, platform.GetBranchScope(c), approve, actorEmployeeID, req.Remarks)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
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
	requestID, err := idParam(c, "requestId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req checklistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.VerifyReleaseChecklist(requestID, platform.GetBranchScope(c), ChecklistInput{
		PaymentVerified:    req.PaymentVerified,
		PacketVerified:     req.PacketVerified,
		BankPledgeVerified: req.BankPledgeVerified,
		CustomerConfirmed:  req.CustomerConfirmed,
		VerificationNotes:  req.VerificationNotes,
		Charges:            req.Charges,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

type releaseApprovalRequest struct {
	Stage   string `json:"stage" binding:"required"`
	Action  string `json:"action" binding:"required"`
	Remarks string `json:"remarks"`
}

func (h *Handler) ApproveReleaseRequest(c *gin.Context) {
	requestID, err := idParam(c, "requestId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req releaseApprovalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	// Actor identity comes from the authenticated JWT, not the request body
	// — see platform.ActorFromContext's doc comment.
	actorEmployeeID, _ := platform.ActorFromContext(c)
	rec, err := h.svc.ApproveReleaseRequest(requestID, platform.GetBranchScope(c), ReleaseApprovalInput{
		Stage:           req.Stage,
		Action:          req.Action,
		ActorEmployeeID: actorEmployeeID,
		Remarks:         req.Remarks,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

func (h *Handler) CompleteRelease(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	// Actor identity comes from the authenticated JWT — no request body
	// needed at all now (previously just carried a spoofable employeeId).
	actorEmployeeID, _ := platform.ActorFromContext(c)
	rec, err := h.svc.CompleteRelease(loanID, platform.GetBranchScope(c), actorEmployeeID)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// --- Approval limits ---------------------------------------------------

// GetLoanOperatorApprovalLimit backs GET /loans/approval-limits/loan-operator
// — the Employees page's "Roles" panel reads this to show the current
// hard-enforced cap (see Service.Approve's stage-role check).
func (h *Handler) GetLoanOperatorApprovalLimit(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"role": "Loan Operator", "maxAmount": h.svc.GetLoanOperatorLimit()})
}

type approvalLimitRequest struct {
	MaxAmount float64 `json:"maxAmount" binding:"required"`
}

// SetLoanOperatorApprovalLimit backs PUT /loans/approval-limits/loan-operator.
func (h *Handler) SetLoanOperatorApprovalLimit(c *gin.Context) {
	var req approvalLimitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	amount, err := h.svc.SetLoanOperatorLimit(req.MaxAmount)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"role": "Loan Operator", "maxAmount": amount})
}
