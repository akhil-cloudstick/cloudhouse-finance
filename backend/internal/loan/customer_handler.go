package loan

import (
	"bytes"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jung-kurt/gofpdf"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
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
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
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
		rec, total, err := h.svc.List(ctx, f)
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

	rec, _, err := h.svc.List(ctx, f)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// customerOwnedLoan fetches a loan by id and verifies it belongs to
// customerID, returning ErrNotFound (not a 403) on any mismatch so a
// customer probing another customer's loan id can't even learn it exists.
func (h *Handler) customerOwnedLoan(c *gin.Context, loanID, customerID uint) (*Loan, error) {
	ctx := platform.RequestContext(c)
	l, err := h.svc.Get(ctx, loanID, nil)
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
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	l, err := h.customerOwnedLoan(c, loanID, customerID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, l)
}

// CustomerCreateExtensionRequest backs POST
// /customer/loans/:id/extension-request — same ownership check as
// CustomerGetLoan, then calls CreateExtensionRequest with
// RequestedBy: "Customer".
func (h *Handler) CustomerCreateExtensionRequest(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
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
		RequestedBy: RequestedByCustomer,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
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
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, _, err := h.svc.ListRequests(ctx, LoanRequestFilter{LoanID: loanID})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// CustomerCreateReleaseRequest backs POST
// /customer/loans/:id/release-request — same pattern as
// CustomerCreateExtensionRequest.
func (h *Handler) CustomerCreateReleaseRequest(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
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
		RequestedBy: RequestedByCustomer,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, rec)
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
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		httpx.FailErr(c, err)
		return
	}

	var req razorpayCreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	result, err := h.svc.CreateRazorpayOrder(ctx, loanID, req.Amount, req.Type)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, result)
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
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		httpx.FailErr(c, err)
		return
	}

	var req razorpayVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	l, err := h.svc.VerifyAndRecordRazorpayPayment(ctx, loanID, RazorpayVerifyInput{
		OrderID:   req.OrderID,
		PaymentID: req.PaymentID,
		Signature: req.Signature,
		Amount:    req.Amount,
		Type:      req.Type,
	})
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, l)
}

// CustomerListLoanPayments backs GET /customer/loans/:id/payments —
// ownership-checked, thin wrap of the loan's payment ledger, for the Loan
// Detail screen's payment history section.
func (h *Handler) CustomerListLoanPayments(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		httpx.FailErr(c, err)
		return
	}
	rec, err := h.svc.paymentRepo.FindByLoanID(ctx, loanID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// CustomerCheckIndemnityBondEsign backs GET
// /customer/loans/:id/indemnity-bond/esign/status — ownership-checked poll
// of the eSign request a staff member already started for this loan (see
// Service.StartIndemnityBondSign's deliverBy=BondDeliverDashboard path,
// which is what actually gets the signing URL to the customer in the first
// place — this endpoint only reports status, it never starts a new
// request). Same underlying Service.CheckIndemnityBondSign the staff
// handler (StartIndemnityBondEsign's sibling) calls, just reachable from
// the customer's own JWT instead of an employee's.
func (h *Handler) CustomerCheckIndemnityBondEsign(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if _, err := h.customerOwnedLoan(c, loanID, customerID); err != nil {
		httpx.FailErr(c, err)
		return
	}
	ctx := platform.RequestContext(c)
	rec, status, err := h.svc.CheckIndemnityBondSign(ctx, loanID, nil)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, gin.H{
		"loan":   rec,
		"status": status.Status,
	})
}

// CustomerListPayments backs GET /customer/payments — every payment across
// every loan belonging to the authenticated customer, newest first,
// paginated via limit/offset, backing the Payments tab's global history
// list. No branch scoping — a customer's loans may span branches.
func (h *Handler) CustomerListPayments(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	if limit > 0 {
		rec, err := h.svc.paymentRepo.FindByCustomerID(ctx, customerID, limit+1, offset)
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
	rec, err := h.svc.paymentRepo.FindByCustomerID(ctx, customerID, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}

// CustomerPaymentReceipt backs GET /customer/payments/:paymentId/receipt —
// ownership-checked via the payment's parent loan (404 on mismatch, same
// convention as the other customer routes), then generates and serves a
// one-page PDF receipt inline, mirroring internal/reports/export.go's
// gofpdf usage (buildPDF) rather than indemnitybond.go's chromedp-based
// renderer, since a receipt needs no multi-language HTML/CSS layout.
func (h *Handler) CustomerPaymentReceipt(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	paymentID, err := httpx.IDParam(c, "paymentId")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	payment, err := h.svc.paymentRepo.FindByID(ctx, paymentID)
	if err != nil {
		httpx.FailErr(c, ErrNotFound)
		return
	}
	l, err := h.customerOwnedLoan(c, payment.LoanID, customerID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	buf, err := renderPaymentReceiptPDF(l, payment)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"receipt-%d.pdf\"", payment.ID))
	c.Data(http.StatusOK, "application/pdf", buf)
}

// --- Customer-facing PDF house style ---------------------------------------
//
// Matches the staff web app's print documents (the Gold Loan Pledge Slip and
// the indemnity bond), whose stylesheet lives in frontend/lib/print.ts:
// a Times/Georgia serif face, a centred uppercase masthead over a grey
// subtitle, bordered tables with cream header cells, right-aligned figures,
// and ruled signature lines. Customer-app documents are built through the
// helpers below so a receipt printed from a phone is recognisably the same
// document family as a slip printed at the branch counter.
//
// Colours are the print stylesheet's, not the mobile app's theme — these are
// documents meant to be printed on white paper, where the app's gold-on-ivory
// palette reads as coloured noise and costs toner for no gain.
var (
	pdfInk      = [3]int{0x1a, 0x1a, 0x1a} // body text            (print.ts: #1a1a1a)
	pdfSubtitle = [3]int{0x55, 0x55, 0x55} // h2 subtitle          (#555)
	pdfMutedTxt = [3]int{0x66, 0x66, 0x66} // .muted notes         (#666)
	pdfBorder   = [3]int{0x99, 0x99, 0x99} // th/td borders        (#999)
	pdfThFill   = [3]int{0xf3, 0xed, 0xe1} // th background        (#f3ede1)
	pdfSigRule  = [3]int{0x33, 0x33, 0x33} // signature rules      (#333)
)

const (
	pdfMarginX  = 15.0
	pdfPageMaxY = 258.0 // leave room for the footer/signature block
	pdfRowH     = 8.0
	// Serif face: gofpdf's built-in "Times" is the closest core-font analogue
	// to the print stylesheet's Georgia/'Times New Roman' stack.
	pdfFace = "Times"
)

// fmtINR formats an amount the Indian way (1,43,350.00) to match the pledge
// slip's figures. The rupee sign itself is deliberately omitted: gofpdf's
// core fonts are Latin-1 (cp1252) encoded and have no glyph for U+20B9, so
// emitting it produces a mojibake byte rather than a symbol — "Rs." is what
// the existing receipts already used for the same reason.
func fmtINR(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	s := fmt.Sprintf("%.2f", v)
	intPart, frac, _ := strings.Cut(s, ".")

	// Indian grouping: last three digits, then two at a time.
	var grouped string
	if len(intPart) <= 3 {
		grouped = intPart
	} else {
		head, tail := intPart[:len(intPart)-3], intPart[len(intPart)-3:]
		var parts []string
		for len(head) > 2 {
			parts = append([]string{head[len(head)-2:]}, parts...)
			head = head[:len(head)-2]
		}
		if head != "" {
			parts = append([]string{head}, parts...)
		}
		grouped = strings.Join(parts, ",") + "," + tail
	}
	out := "Rs. " + grouped + "." + frac
	if neg {
		out = "-" + out
	}
	return out
}

// pdfDoc wraps a gofpdf document in the house style above. Both customer
// documents are built through it rather than each hand-rolling its own fonts
// and spacing — that divergence is what made them look like they came from
// different systems.
type pdfDoc struct {
	pdf    *gofpdf.Fpdf
	pageW  float64
	bodyW  float64
	title  string
	failed error
}

// newPDFDoc starts a document with the centred masthead. `title` is the
// document's own name ("Payment Receipt"), rendered as the grey subtitle
// under the company name, exactly as the pledge slip's h1/h2 pair.
func newPDFDoc(title string) *pdfDoc {
	pdf := gofpdf.New("P", "mm", "A4", "")
	d := &pdfDoc{pdf: pdf, title: title}
	d.pageW, _ = pdf.GetPageSize()
	d.bodyW = d.pageW - 2*pdfMarginX
	pdf.SetTitle(title, true)
	pdf.SetMargins(pdfMarginX, 15, pdfMarginX)
	pdf.SetAutoPageBreak(false, 15)
	// Repeated on every page so a long statement's later pages are still
	// identifiable on their own once printed and separated.
	pdf.SetHeaderFunc(d.masthead)
	pdf.AddPage()
	return d
}

func (d *pdfDoc) masthead() {
	d.pdf.SetY(15)
	d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
	d.pdf.SetFont(pdfFace, "B", 17)
	d.pdf.CellFormat(0, 8, "AMBIKA GOLD FINANCE", "", 1, "C", false, 0, "")
	d.pdf.SetFont(pdfFace, "", 12)
	d.pdf.SetTextColor(pdfSubtitle[0], pdfSubtitle[1], pdfSubtitle[2])
	d.pdf.CellFormat(0, 7, d.title, "", 1, "C", false, 0, "")
	d.pdf.Ln(5)
}

func (d *pdfDoc) breakIfNeeded(need float64) {
	if d.pdf.GetY()+need > pdfPageMaxY {
		d.pdf.AddPage()
	}
}

// infoPair is one label/value cell pair in the two-column info grid.
type infoPair struct{ Label, Value string }

// infoGrid renders the bordered label/value block the pledge slip opens with:
// two label+value pairs per line, labels on a cream ground. An odd final pair
// leaves its right half blank rather than stretching, keeping the grid square.
func (d *pdfDoc) infoGrid(pairs []infoPair) {
	labelW := 32.0
	valueW := d.bodyW/2 - labelW
	for i := 0; i < len(pairs); i += 2 {
		d.breakIfNeeded(pdfRowH)
		d.pdf.SetX(pdfMarginX)
		d.pdf.SetDrawColor(pdfBorder[0], pdfBorder[1], pdfBorder[2])
		for j := 0; j < 2; j++ {
			if i+j < len(pairs) {
				p := pairs[i+j]
				d.pdf.SetFont(pdfFace, "B", 10)
				d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
				d.pdf.SetFillColor(pdfThFill[0], pdfThFill[1], pdfThFill[2])
				d.pdf.CellFormat(labelW, pdfRowH, p.Label, "1", 0, "L", true, 0, "")
				d.pdf.SetFont(pdfFace, "", 10)
				d.pdf.CellFormat(valueW, pdfRowH, p.Value, "1", 0, "L", false, 0, "")
			} else {
				// Blank filler cells so the outer border stays rectangular.
				d.pdf.CellFormat(labelW, pdfRowH, "", "1", 0, "L", false, 0, "")
				d.pdf.CellFormat(valueW, pdfRowH, "", "1", 0, "L", false, 0, "")
			}
		}
		d.pdf.Ln(-1)
	}
	d.pdf.Ln(6)
}

// pdfCol describes one column of a data table. Num right-aligns the cell, the
// same as the print stylesheet's .num class.
type pdfCol struct {
	Title string
	W     float64
	Num   bool
}

// table renders a bordered table with cream header cells. `total`, when
// non-nil, is rendered as a bold closing row (the pledge slip's Total line);
// its entries line up with `cols` positionally.
func (d *pdfDoc) table(cols []pdfCol, rows [][]string, total []string) {
	header := func() {
		d.pdf.SetX(pdfMarginX)
		d.pdf.SetFont(pdfFace, "B", 10)
		d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
		d.pdf.SetFillColor(pdfThFill[0], pdfThFill[1], pdfThFill[2])
		d.pdf.SetDrawColor(pdfBorder[0], pdfBorder[1], pdfBorder[2])
		// Header captions are centred regardless of the column's own
		// alignment — matching the pledge slip, where numeric columns have
		// right-aligned figures under a centred caption.
		for _, c := range cols {
			d.pdf.CellFormat(c.W, pdfRowH, c.Title, "1", 0, "C", true, 0, "")
		}
		d.pdf.Ln(-1)
	}

	d.breakIfNeeded(pdfRowH * 2)
	header()

	for _, r := range rows {
		// A table continuing onto a new page repeats its header, so the
		// columns stay readable rather than arriving unlabelled.
		if d.pdf.GetY()+pdfRowH > pdfPageMaxY {
			d.pdf.AddPage()
			header()
		}
		d.pdf.SetX(pdfMarginX)
		d.pdf.SetFont(pdfFace, "", 10)
		d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
		for i, c := range cols {
			cell := ""
			if i < len(r) {
				cell = r[i]
			}
			align := "L"
			if c.Num {
				align = "R"
			}
			d.pdf.CellFormat(c.W, pdfRowH, cell, "1", 0, align, false, 0, "")
		}
		d.pdf.Ln(-1)
	}

	if total != nil {
		d.breakIfNeeded(pdfRowH)
		d.pdf.SetX(pdfMarginX)
		d.pdf.SetFont(pdfFace, "B", 10)
		d.pdf.SetFillColor(pdfThFill[0], pdfThFill[1], pdfThFill[2])
		for i, c := range cols {
			cell := ""
			if i < len(total) {
				cell = total[i]
			}
			align := "L"
			if c.Num {
				align = "R"
			}
			d.pdf.CellFormat(c.W, pdfRowH, cell, "1", 0, align, true, 0, "")
		}
		d.pdf.Ln(-1)
	}
	d.pdf.Ln(6)
}

// note renders a plain line; `muted` styles it as the stylesheet's .muted
// grey aside (used for empty states and parenthetical amounts).
func (d *pdfDoc) note(text string, muted bool) {
	d.breakIfNeeded(pdfRowH)
	d.pdf.SetX(pdfMarginX)
	if muted {
		d.pdf.SetFont(pdfFace, "I", 10)
		d.pdf.SetTextColor(pdfMutedTxt[0], pdfMutedTxt[1], pdfMutedTxt[2])
	} else {
		d.pdf.SetFont(pdfFace, "B", 11)
		d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
	}
	d.pdf.CellFormat(0, 7, text, "", 1, "L", false, 0, "")
}

// signatures renders the ruled signature row the branch documents close with.
func (d *pdfDoc) signatures(labels ...string) {
	need := 32.0
	d.breakIfNeeded(need)
	y := d.pdf.GetY() + 24
	if y > pdfPageMaxY {
		d.pdf.AddPage()
		y = d.pdf.GetY() + 24
	}
	colW := d.bodyW / float64(len(labels))
	d.pdf.SetDrawColor(pdfSigRule[0], pdfSigRule[1], pdfSigRule[2])
	d.pdf.SetFont(pdfFace, "", 10)
	d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
	for i, label := range labels {
		x := pdfMarginX + float64(i)*colW
		// Rule sits above the caption, matching .sig span's border-top.
		d.pdf.Line(x+6, y, x+colW-6, y)
		d.pdf.SetXY(x, y+1)
		d.pdf.CellFormat(colW, 7, label, "", 0, "C", false, 0, "")
	}
	d.pdf.SetY(y + 10)
}

// finish stamps the generated-on line and renders the document.
func (d *pdfDoc) finish() ([]byte, error) {
	if d.failed != nil {
		return nil, d.failed
	}
	d.pdf.Ln(4)
	d.breakIfNeeded(8)
	d.pdf.SetX(pdfMarginX)
	d.pdf.SetFont(pdfFace, "I", 9)
	d.pdf.SetTextColor(pdfMutedTxt[0], pdfMutedTxt[1], pdfMutedTxt[2])
	d.pdf.CellFormat(0, 6, "Generated on "+time.Now().Format("02 Jan 2006 15:04"), "", 1, "L", false, 0, "")

	var buf bytes.Buffer
	if err := d.pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// renderPaymentReceiptPDF renders a one-page receipt for a single
// LoanPayment, laid out like the branch's Gold Loan Pledge Slip: the shared
// masthead, a bordered info grid, the payment itself as a small table with
// the amount picked out, and signature rules.
func renderPaymentReceiptPDF(l *Loan, p *LoanPayment) ([]byte, error) {
	d := newPDFDoc("Payment Receipt")

	d.infoGrid([]infoPair{
		{"Loan No", l.LoanNumber},
		{"Date", p.PaidOn.Format("02/01/2006")},
		{"Customer", l.Customer.Name},
		{"Method", p.Method},
		{"Type", p.Type},
		{"Reference", p.Reference},
	})

	amountW := 45.0
	d.table(
		[]pdfCol{
			{Title: "Description", W: d.bodyW - amountW},
			{Title: "Amount", W: amountW, Num: true},
		},
		[][]string{
			{"Payment received", fmtINR(p.Amount)},
		},
		[]string{"Balance outstanding after this payment", fmtINR(p.RunningBalance)},
	)

	d.note("Amount received: "+fmtINR(p.Amount), false)
	d.note("This receipt is valid only for the payment referenced above.", true)

	d.signatures("Customer Signature", "Cashier", "Branch Manager")
	return d.finish()
}

// --- Customer mobile app — batch 5: Documents ------------------------------

// CustomerLoanStatement backs GET /customer/loans/:id/statement —
// ownership-checked via customerOwnedLoan (404 on mismatch, same convention
// as every other route in this file), then generates and serves a PDF
// listing every LoanPayment against the loan plus a summary header,
// mirroring renderPaymentReceiptPDF's label/value row() helper for the
// header and a simple looped-row table for the payments.
func (h *Handler) CustomerLoanStatement(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	loanID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	l, err := h.customerOwnedLoan(c, loanID, customerID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	payments, err := h.svc.paymentRepo.FindByLoanID(ctx, l.ID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	buf, err := renderLoanStatementPDF(l, payments)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"statement-%s.pdf\"", l.LoanNumber))
	c.Data(http.StatusOK, "application/pdf", buf)
}

// renderLoanStatementPDF renders the loan's summary as a bordered info grid
// followed by a table of every payment against it (date, type, amount,
// method, reference, running balance) with a total row — the same house
// style as renderPaymentReceiptPDF and the branch's pledge slip. A loan with
// no payments yet still renders a valid one-page PDF, with a plain
// "No payments recorded yet" line instead of an empty table.
func renderLoanStatementPDF(l *Loan, payments []LoanPayment) ([]byte, error) {
	d := newPDFDoc("Loan Statement")

	d.infoGrid([]infoPair{
		{"Loan No", l.LoanNumber},
		{"Date", time.Now().Format("02/01/2006")},
		{"Customer", l.Customer.Name},
		{"Principal", fmtINR(l.PrincipalAmount)},
		{"Opened", l.OpenedDate.Format("02 Jan 2006")},
		{"Due Date", l.DueDate.Format("02 Jan 2006")},
	})

	if len(payments) == 0 {
		d.note("No payments recorded yet.", true)
	} else {
		// Widths total d.bodyW (180mm at A4 with 15mm margins).
		cols := []pdfCol{
			{Title: "#", W: 10},
			{Title: "Date", W: 24},
			{Title: "Type", W: 28},
			{Title: "Method", W: 24},
			{Title: "Reference", W: 44},
			{Title: "Amount", W: 25, Num: true},
			{Title: "Balance", W: 25, Num: true},
		}
		rows := make([][]string, 0, len(payments))
		var totalPaid float64
		for i, p := range payments {
			totalPaid += p.Amount
			rows = append(rows, []string{
				strconv.Itoa(i + 1),
				p.PaidOn.Format("02/01/2006"),
				p.Type,
				p.Method,
				p.Reference,
				fmtINR(p.Amount),
				fmtINR(p.RunningBalance),
			})
		}
		d.table(cols, rows, []string{"", "Total", "", "", "", fmtINR(totalPaid), ""})
	}

	d.note("Current outstanding: "+fmtINR(l.TotalOutstandingBalance), false)

	d.signatures("Customer Signature", "Cashier", "Branch Manager")
	return d.finish()
}
