package loan

import (
	"bytes"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jung-kurt/gofpdf"
)

// --- Customer mobile app (customer-mobile/) — batch 2: My Loans + Loan
// Detail. These handlers wrap the existing Service exactly like the staff
// handlers above, but are mounted under /api/v1/customer/loans (see
// main.go), gated by platform.CustomerAuthMiddleware rather than the staff
// AuthMiddleware. customerIDFromContext reads the customerId the middleware
// already set — never trusted from the request body/query — so a customer
// can only ever see/act on their own loans, with no branchId filter at all
// (a customer's loans may span branches).

// customerIDFromContext mirrors customerauth.customerIDFromContext — kept
// as its own copy here rather than exported from customerauth, since
// internal/loan already avoids importing sibling domain packages it
// doesn't otherwise need (see PacketCreator/PacketMover/CashRecorder's
// narrow-interface pattern for the same reasoning applied to services).
func customerIDFromContext(c *gin.Context) (uint, bool) {
	v, ok := c.Get("customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

// CustomerListLoans backs GET /customer/loans — wraps Service.List, forcing
// CustomerID from the JWT and passing through status/limit/offset. No
// branchId filter: a customer sees every one of their loans regardless of
// which branch opened it.
func (h *Handler) CustomerListLoans(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}

	f := LoanFilter{Status: c.Query("status"), CustomerID: customerID}

	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit > 0 {
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		f.Limit, f.Offset = limit+1, offset
		rec, err := h.svc.List(f)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		c.JSON(http.StatusOK, gin.H{"items": rec, "hasMore": hasMore})
		return
	}

	rec, err := h.svc.List(f)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// customerOwnedLoan fetches a loan by id and verifies it belongs to
// customerID, returning ErrNotFound (not a 403) on any mismatch so a
// customer probing another customer's loan id can't even learn it exists.
func (h *Handler) customerOwnedLoan(c *gin.Context, loanID, customerID uint) (*Loan, error) {
	l, err := h.svc.Get(loanID, nil)
	if err != nil {
		return nil, err
	}
	if l.CustomerID != customerID {
		return nil, ErrNotFound
	}
	return l, nil
}

// CustomerGetLoan backs GET /customer/loans/:id.
func (h *Handler) CustomerGetLoan(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	l, err := h.customerOwnedLoan(c, loanID, customerID)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, l)
}

// CustomerCreateExtensionRequest backs POST
// /customer/loans/:id/extension-request — same ownership check as
// CustomerGetLoan, then calls CreateExtensionRequest with
// RequestedBy: "Customer".
func (h *Handler) CustomerCreateExtensionRequest(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		fail(c, statusForErr(err), err)
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
		RequestedBy: RequestedByCustomer,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

// CustomerListLoanRequests backs GET /customer/loans/:id/requests — not
// called out as its own numbered item in the batch 2 plan, but needed to
// satisfy its own goal of "visibility into where that request stands": the
// Loan Detail screen's Requests card needs to show an already-pending
// request's current stage on a fresh screen load, not only right after
// this session submitted one. Same ownership check as the other
// customer-scoped loan routes; no branch scoping (a customer's loans may
// span branches).
func (h *Handler) CustomerListLoanRequests(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	rec, err := h.svc.ListRequests(LoanRequestFilter{LoanID: loanID})
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// CustomerCreateReleaseRequest backs POST
// /customer/loans/:id/release-request — same pattern as
// CustomerCreateExtensionRequest.
func (h *Handler) CustomerCreateReleaseRequest(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		fail(c, statusForErr(err), err)
		return
	}

	var req releaseRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	rec, err := h.svc.CreateReleaseRequest(loanID, ReleaseRequestInput{
		Detail:      req.Detail,
		RequestedBy: RequestedByCustomer,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

// --- Customer mobile app — batch 3: Razorpay Setup + Payments -------------

type razorpayCreateOrderRequest struct {
	Amount float64 `json:"amount" binding:"required"`
	Type   string  `json:"type" binding:"required"`
}

// CustomerCreateRazorpayOrder backs POST
// /customer/loans/:id/pay/create-order — ownership-checked like every other
// customer-scoped loan route, then delegates the amount validation +
// Razorpay order creation to Service.CreateRazorpayOrder.
func (h *Handler) CustomerCreateRazorpayOrder(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		fail(c, statusForErr(err), err)
		return
	}

	var req razorpayCreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	result, err := h.svc.CreateRazorpayOrder(loanID, req.Amount, req.Type)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type razorpayVerifyRequest struct {
	OrderID   string  `json:"orderId" binding:"required"`
	PaymentID string  `json:"paymentId" binding:"required"`
	Signature string  `json:"signature" binding:"required"`
	Amount    float64 `json:"amount" binding:"required"`
	Type      string  `json:"type" binding:"required"`
}

// CustomerVerifyRazorpayPayment backs POST /customer/loans/:id/pay/verify —
// ownership-checked, then verifies the checkout signature and records the
// payment via Service.VerifyAndRecordRazorpayPayment. Returns the updated
// Loan on success, 400 on a signature mismatch (no LoanPayment is created
// in that case).
func (h *Handler) CustomerVerifyRazorpayPayment(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		fail(c, statusForErr(err), err)
		return
	}

	var req razorpayVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	l, err := h.svc.VerifyAndRecordRazorpayPayment(loanID, RazorpayVerifyInput{
		OrderID:   req.OrderID,
		PaymentID: req.PaymentID,
		Signature: req.Signature,
		Amount:    req.Amount,
		Type:      req.Type,
	})
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	c.JSON(http.StatusOK, l)
}

// CustomerListLoanPayments backs GET /customer/loans/:id/payments —
// ownership-checked, thin wrap of the loan's payment ledger, for the Loan
// Detail screen's payment history section.
func (h *Handler) CustomerListLoanPayments(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	rec, err := h.svc.paymentRepo.FindByLoanID(loanID)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// CustomerListPayments backs GET /customer/payments — every payment across
// every loan belonging to the authenticated customer, newest first,
// paginated via limit/offset, backing the Payments tab's global history
// list. No branch scoping — a customer's loans may span branches.
func (h *Handler) CustomerListPayments(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	if limit > 0 {
		rec, err := h.svc.paymentRepo.FindByCustomerID(customerID, limit+1, offset)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		c.JSON(http.StatusOK, gin.H{"items": rec, "hasMore": hasMore})
		return
	}
	rec, err := h.svc.paymentRepo.FindByCustomerID(customerID, 0, 0)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// CustomerPaymentReceipt backs GET /customer/payments/:paymentId/receipt —
// ownership-checked via the payment's parent loan (404 on mismatch, same
// convention as the other customer routes), then generates and serves a
// one-page PDF receipt inline, mirroring internal/reports/export.go's
// gofpdf usage (buildPDF) rather than indemnitybond.go's chromedp-based
// renderer, since a receipt needs no multi-language HTML/CSS layout.
func (h *Handler) CustomerPaymentReceipt(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	paymentID, err := idParam(c, "paymentId")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	payment, err := h.svc.paymentRepo.FindByID(paymentID)
	if err != nil {
		fail(c, http.StatusNotFound, ErrNotFound)
		return
	}
	l, err := h.customerOwnedLoan(c, payment.LoanID, customerID)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}

	buf, err := renderPaymentReceiptPDF(l, payment)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"receipt-%d.pdf\"", payment.ID))
	c.Data(http.StatusOK, "application/pdf", buf)
}

// renderPaymentReceiptPDF renders a one-page receipt for a single
// LoanPayment: loan number, customer name, payment date, amount, type,
// method, reference, and the running balance left after it.
func renderPaymentReceiptPDF(l *Loan, p *LoanPayment) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	pdf.SetFont("Arial", "B", 16)
	pdf.CellFormat(0, 10, "Ambika Gold Finance", "", 1, "L", false, 0, "")
	pdf.SetFont("Arial", "", 11)
	pdf.CellFormat(0, 8, "Payment Receipt", "", 1, "L", false, 0, "")
	pdf.Ln(4)

	row := func(label, value string) {
		pdf.SetFont("Arial", "B", 10)
		pdf.CellFormat(55, 8, label, "0", 0, "L", false, 0, "")
		pdf.SetFont("Arial", "", 10)
		pdf.CellFormat(0, 8, value, "0", 1, "L", false, 0, "")
	}

	row("Loan Number:", l.LoanNumber)
	row("Customer Name:", l.Customer.Name)
	row("Payment Date:", p.PaidOn.Format("02 Jan 2006"))
	row("Amount:", fmt.Sprintf("Rs. %.2f", p.Amount))
	row("Type:", p.Type)
	row("Method:", p.Method)
	row("Reference:", p.Reference)
	row("Running Balance:", fmt.Sprintf("Rs. %.2f", p.RunningBalance))
	pdf.Ln(6)

	pdf.SetFont("Arial", "I", 8)
	pdf.CellFormat(0, 6, "Generated on "+time.Now().Format("02 Jan 2006 15:04"), "", 1, "L", false, 0, "")

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// --- Customer mobile app — batch 5: Documents ------------------------------

// CustomerLoanStatement backs GET /customer/loans/:id/statement —
// ownership-checked via customerOwnedLoan (404 on mismatch, same convention
// as every other route in this file), then generates and serves a PDF
// listing every LoanPayment against the loan plus a summary header,
// mirroring renderPaymentReceiptPDF's label/value row() helper for the
// header and a simple looped-row table for the payments.
func (h *Handler) CustomerLoanStatement(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	loanID, err := idParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	l, err := h.customerOwnedLoan(c, loanID, customerID)
	if err != nil {
		fail(c, statusForErr(err), err)
		return
	}
	payments, err := h.svc.paymentRepo.FindByLoanID(l.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}

	buf, err := renderLoanStatementPDF(l, payments)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"statement-%s.pdf\"", l.LoanNumber))
	c.Data(http.StatusOK, "application/pdf", buf)
}

// renderLoanStatementPDF renders a summary header (loan number, customer
// name, principal, opened/due date, current outstanding — same row() label/
// value shape as renderPaymentReceiptPDF) followed by a table of every
// payment (paid date, type, amount, method, reference, running balance). A
// loan with no payments yet still renders a valid one-page PDF with a plain
// "No payments recorded yet" line instead of an empty table.
func renderLoanStatementPDF(l *Loan, payments []LoanPayment) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	pdf.SetFont("Arial", "B", 16)
	pdf.CellFormat(0, 10, "Ambika Gold Finance", "", 1, "L", false, 0, "")
	pdf.SetFont("Arial", "", 11)
	pdf.CellFormat(0, 8, "Loan Statement", "", 1, "L", false, 0, "")
	pdf.Ln(4)

	row := func(label, value string) {
		pdf.SetFont("Arial", "B", 10)
		pdf.CellFormat(55, 8, label, "0", 0, "L", false, 0, "")
		pdf.SetFont("Arial", "", 10)
		pdf.CellFormat(0, 8, value, "0", 1, "L", false, 0, "")
	}

	row("Loan Number:", l.LoanNumber)
	row("Customer Name:", l.Customer.Name)
	row("Principal:", fmt.Sprintf("Rs. %.2f", l.PrincipalAmount))
	row("Opened Date:", l.OpenedDate.Format("02 Jan 2006"))
	row("Due Date:", l.DueDate.Format("02 Jan 2006"))
	row("Current Outstanding:", fmt.Sprintf("Rs. %.2f", l.TotalOutstandingBalance))
	pdf.Ln(6)

	pdf.SetFont("Arial", "B", 11)
	pdf.CellFormat(0, 8, "Payments", "", 1, "L", false, 0, "")
	pdf.Ln(1)

	if len(payments) == 0 {
		pdf.SetFont("Arial", "", 10)
		pdf.CellFormat(0, 8, "No payments recorded yet.", "0", 1, "L", false, 0, "")
	} else {
		colWidths := []float64{25, 28, 25, 22, 35, 30}
		headers := []string{"Date", "Type", "Amount", "Method", "Reference", "Balance"}

		pdf.SetFont("Arial", "B", 9)
		for i, h := range headers {
			pdf.CellFormat(colWidths[i], 8, h, "B", 0, "L", false, 0, "")
		}
		pdf.Ln(-1)

		pdf.SetFont("Arial", "", 9)
		for _, p := range payments {
			if pdf.GetY() > 270 {
				pdf.AddPage()
			}
			pdf.CellFormat(colWidths[0], 7, p.PaidOn.Format("02-Jan-06"), "", 0, "L", false, 0, "")
			pdf.CellFormat(colWidths[1], 7, p.Type, "", 0, "L", false, 0, "")
			pdf.CellFormat(colWidths[2], 7, fmt.Sprintf("%.2f", p.Amount), "", 0, "L", false, 0, "")
			pdf.CellFormat(colWidths[3], 7, p.Method, "", 0, "L", false, 0, "")
			pdf.CellFormat(colWidths[4], 7, p.Reference, "", 0, "L", false, 0, "")
			pdf.CellFormat(colWidths[5], 7, fmt.Sprintf("%.2f", p.RunningBalance), "", 1, "L", false, 0, "")
		}
	}
	pdf.Ln(6)

	pdf.SetFont("Arial", "I", 8)
	pdf.CellFormat(0, 6, "Generated on "+time.Now().Format("02 Jan 2006 15:04"), "", 1, "L", false, 0, "")

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
