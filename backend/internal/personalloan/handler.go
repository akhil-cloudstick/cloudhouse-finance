package personalloan

import (
	"fmt"
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
	employeeID, _, _ := platform.ActorFromContext(c)
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

// List returns one page of loans as the {items, hasMore} envelope,
// branch-scoped, optionally filtered by customerId/status/frequency and
// searched by loan number or customer name (q) — limit/offset query params,
// page size defaults to 10 (see Service.List).
func (h *Handler) List(c *gin.Context) {
	branchID := platform.GetBranchScope(c)
	var customerID *uint
	if v := c.Query("customerId"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			cid := uint(id)
			customerID = &cid
		}
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	recs, hasMore, err := h.svc.List(ListInput{
		BranchID:   branchID,
		CustomerID: customerID,
		Status:     c.Query("status"),
		Frequency:  c.Query("frequency"),
		Query:      c.Query("q"),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": recs, "hasMore": hasMore})
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

// Schedule returns one page of a loan's installment schedule as the
// {items, hasMore} envelope (limit/offset query params, page size defaults
// to 10 — see Service.GetSchedule).
func (h *Handler) Schedule(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	recs, hasMore, err := h.svc.GetSchedule(id, platform.GetBranchScope(c), limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": recs, "hasMore": hasMore})
}

// Payments returns one page of a loan's payment ledger as the
// {items, hasMore} envelope (limit/offset query params, page size defaults
// to 10 — see Service.ListPayments).
func (h *Handler) Payments(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	recs, hasMore, err := h.svc.ListPayments(id, platform.GetBranchScope(c), limit, offset)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{"items": recs, "hasMore": hasMore})
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
	employeeID, _, _ := platform.ActorFromContext(c)
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
	employeeID, _, _ := platform.ActorFromContext(c)
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

// DownloadBond streams the borrower-only bond PDF for a loan (see bond.go's
// GenerateBond) as an attachment, filename "bond-<loanNumber>.pdf" — matches
// internal/reports' export.go Content-Disposition pattern.
func (h *Handler) DownloadBond(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	pdf, loan, err := h.svc.GenerateBond(c.Request.Context(), id, platform.GetBranchScope(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	filename := fmt.Sprintf("bond-%s.pdf", loan.LoanNumber)
	c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.Data(http.StatusOK, "application/pdf", pdf)
}

// ListLoansForCustomer returns a customer's personal loans — mounted under
// /customers/:id/personal-loans (see internal/loan's equivalent placement).
// Unpaginated: a single customer's own personal loans are few enough to
// show in full, unlike the branch-wide list page.
func (h *Handler) ListLoansForCustomer(c *gin.Context) {
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	recs, _, err := h.svc.List(ListInput{BranchID: platform.GetBranchScope(c), CustomerID: &id, Limit: 1000})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, recs)
}
