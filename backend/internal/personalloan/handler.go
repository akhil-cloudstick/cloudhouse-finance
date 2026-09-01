package personalloan

import (
	"net/http"
	"strconv"

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

type createRequest struct {
	BranchID        uint    `json:"branchId"`
	CustomerID      uint    `json:"customerId"`
	PrincipalAmount float64 `json:"principalAmount"`
	InterestType    string  `json:"interestType"`
	InterestValue   float64 `json:"interestValue"`
	Frequency       string  `json:"frequency"`
	TenureCount     int     `json:"tenureCount"`
}

// Create validates + persists a new loan, disbursing it in the same step.
func (h *Handler) Create(c *gin.Context) {
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	employeeID, _ := platform.ActorFromContext(c)
	branchID := platform.EnforceBranchOnWrite(c, req.BranchID)

	rec, err := h.svc.CreateLoan(CreateInput{
		BranchID:            branchID,
		CustomerID:          req.CustomerID,
		PrincipalAmount:     req.PrincipalAmount,
		InterestType:        req.InterestType,
		InterestValue:       req.InterestValue,
		Frequency:           req.Frequency,
		TenureCount:         req.TenureCount,
		CreatedByEmployeeID: employeeID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
}

// List returns loans, branch-scoped, optionally filtered by customerId/status.
func (h *Handler) List(c *gin.Context) {
	branchID := platform.GetBranchScope(c)
	var customerID *uint
	if v := c.Query("customerId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			cid := uint(id)
			customerID = &cid
		}
	}
	recs, err := h.svc.List(branchID, customerID, c.Query("status"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

// Get returns one loan.
func (h *Handler) Get(c *gin.Context) {
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

// Schedule returns a loan's installment schedule.
func (h *Handler) Schedule(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	recs, err := h.svc.GetSchedule(id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

// Payments returns a loan's payment ledger.
func (h *Handler) Payments(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	recs, err := h.svc.ListPayments(id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}

type paymentRequest struct {
	Amount      float64 `json:"amount"`
	Method      string  `json:"method"`
	Reference   string  `json:"reference"`
	Description string  `json:"description"`
}

// RecordPayment collects a payment against a loan.
func (h *Handler) RecordPayment(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req paymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	employeeID, _ := platform.ActorFromContext(c)
	rec, err := h.svc.RecordPayment(id, platform.GetBranchScope(c), PaymentInput{
		Amount:               req.Amount,
		Method:               req.Method,
		Reference:            req.Reference,
		Description:          req.Description,
		ReceivedByEmployeeID: &employeeID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

type renewRequest struct {
	PrincipalAmount float64 `json:"principalAmount"`
	InterestType    string  `json:"interestType"`
	InterestValue   float64 `json:"interestValue"`
	Frequency       string  `json:"frequency"`
	TenureCount     int     `json:"tenureCount"`
}

// RenewalPreview returns the dry-run renewal calculation.
func (h *Handler) RenewalPreview(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req renewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	preview, err := h.svc.PreviewRenewal(id, platform.GetBranchScope(c), RenewInput{
		PrincipalAmount: req.PrincipalAmount,
		InterestType:    req.InterestType,
		InterestValue:   req.InterestValue,
		Frequency:       req.Frequency,
		TenureCount:     req.TenureCount,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, preview)
}

// Renew closes the loan and opens a new one in its place.
func (h *Handler) Renew(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req renewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	employeeID, _ := platform.ActorFromContext(c)
	result, err := h.svc.RenewLoan(id, platform.GetBranchScope(c), RenewInput{
		PrincipalAmount:     req.PrincipalAmount,
		InterestType:        req.InterestType,
		InterestValue:       req.InterestValue,
		Frequency:           req.Frequency,
		TenureCount:         req.TenureCount,
		CreatedByEmployeeID: employeeID,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, result)
}

// ListLoansForCustomer returns a customer's personal loans — mounted under
// /customers/:id/personal-loans (see internal/loan's equivalent placement).
func (h *Handler) ListLoansForCustomer(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	recs, err := h.svc.List(platform.GetBranchScope(c), &id, "")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}
