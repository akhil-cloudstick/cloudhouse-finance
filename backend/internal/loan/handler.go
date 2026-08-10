package loan

import (
	"errors"
	"net/http"
	"strconv"
	"time"

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

func parseDate(s string) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, s)
}

func statusForErr(err error) int {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrOrnamentNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrBranchInvalid), errors.Is(err, ErrCustomerInvalid),
		errors.Is(err, ErrCustomerNotVerified), errors.Is(err, ErrSchemeInvalid),
		errors.Is(err, ErrNoOrnaments), errors.Is(err, ErrNoGoldRate),
		errors.Is(err, ErrGoldRateNotSetToday),
		errors.Is(err, ErrInvalidPurity), errors.Is(err, ErrInvalidWeight),
		errors.Is(err, ErrPrincipalTooHigh), errors.Is(err, ErrInvalidPrincipal),
		errors.Is(err, ErrInvalidDueDate), errors.Is(err, ErrWrongStage),
		errors.Is(err, ErrAlreadyDecided), errors.Is(err, ErrInvalidAction),
		errors.Is(err, ErrInvalidAmount):
		return http.StatusBadRequest
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
	rec, err := h.svc.Get(id)
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
	Stage      string `json:"stage" binding:"required"`
	Action     string `json:"action" binding:"required"`
	EmployeeID uint   `json:"employeeId" binding:"required"`
	Remarks    string `json:"remarks"`
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
	rec, err := h.svc.Approve(loanID, ApprovalInput{
		Stage:           req.Stage,
		Action:          req.Action,
		ActorEmployeeID: req.EmployeeID,
		Remarks:         req.Remarks,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// --- Payments ------------------------------------------------------------

type paymentRequest struct {
	Amount     float64 `json:"amount" binding:"required"`
	Type       string  `json:"type" binding:"required"`
	PaidOn     string  `json:"paidOn" binding:"required"`
	EmployeeID uint    `json:"employeeId" binding:"required"`
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
	rec, err := h.svc.RecordPayment(loanID, PaymentInput{
		Amount:               req.Amount,
		Type:                 req.Type,
		PaidOn:               paidOn,
		ReceivedByEmployeeID: req.EmployeeID,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

// --- Auction ---------------------------------------------------------------

type auctionRequest struct {
	AuctionDate   string  `json:"auctionDate" binding:"required"`
	AuctionAmount float64 `json:"auctionAmount" binding:"required"`
}

func (h *Handler) RecordAuction(c *gin.Context) {
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var req auctionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	auctionDate, err := parseDate(req.AuctionDate)
	if err != nil {
		fail(c, http.StatusBadRequest, errors.New("invalid auctionDate: expected YYYY-MM-DD"))
		return
	}
	rec, err := h.svc.RecordAuction(loanID, AuctionInput{
		AuctionDate:   auctionDate,
		AuctionAmount: req.AuctionAmount,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// --- Bank pledge ---------------------------------------------------------

type bankPledgeRequest struct {
	BankName      string  `json:"bankName" binding:"required"`
	PledgedAmount float64 `json:"pledgedAmount" binding:"required"`
	PledgeDate    string  `json:"pledgeDate" binding:"required"`
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
	rec, err := h.svc.RecordBankPledge(loanID, BankPledgeInput{
		BankName:      req.BankName,
		PledgedAmount: req.PledgedAmount,
		PledgeDate:    pledgeDate,
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
	rec, err := h.svc.ReleaseBankPledge(loanID, pledgeID)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, rec)
}
