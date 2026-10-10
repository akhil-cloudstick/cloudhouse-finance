package controllers

import (
	"bytes"
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jung-kurt/gofpdf"
	"github.com/labstack/echo/v4"
)

var (
	pdfInk      = [3]int{0x1a, 0x1a, 0x1a}
	pdfSubtitle = [3]int{0x55, 0x55, 0x55}
	pdfMutedTxt = [3]int{0x66, 0x66, 0x66}
	pdfBorder   = [3]int{0x99, 0x99, 0x99}
	pdfThFill   = [3]int{0xf3, 0xed, 0xe1}
	pdfSigRule  = [3]int{0x33, 0x33, 0x33}
)

const (
	pdfMarginX = 15.0
	pdfRowH    = 8.0
	pdfFace    = "Times"
)

type razorpayCreateOrderRequest struct {
	Amount float64 `json:"amount" binding:"required"`
	Type   string  `json:"type" binding:"required"`
}

type razorpayVerifyRequest struct {
	OrderID   string  `json:"order_id" binding:"required"`
	PaymentID string  `json:"payment_id" binding:"required"`
	Signature string  `json:"signature" binding:"required"`
	Amount    float64 `json:"amount" binding:"required"`
	Type      string  `json:"type" binding:"required"`
}

type pdfDoc struct {
	pdf    *gofpdf.Fpdf
	pageW  float64
	bodyW  float64
	title  string
	failed error
}

type infoPair struct{ Label, Value string }

type pdfCol struct {
	Title string
	W     float64
	Num   bool
}

func fmtINR(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	s := fmt.Sprintf("%.2f", v)
	intPart, frac, _ := strings.Cut(s, ".")
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

func newPDFDoc(title string) *pdfDoc {
	pdf := gofpdf.New("P", "mm", "A4", "")
	d := &pdfDoc{pdf: pdf, title: title}
	d.pageW, _ = pdf.GetPageSize()
	d.bodyW = d.pageW - 2*pdfMarginX
	pdf.SetTitle(title, true)
	pdf.SetMargins(pdfMarginX, 15, pdfMarginX)
	pdf.SetAutoPageBreak(false, 15)
	pdf.SetHeaderFunc(d.masthead)
	pdf.AddPage()
	return d
}

func (d *pdfDoc) masthead() {
	d.pdf.SetY(15)
	d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
	d.pdf.SetFont(pdfFace, "B", 17)
	d.pdf.CellFormat(0, 8, "CLOUDHOUSE Finance", "", 1, "C", false, 0, "")
	d.pdf.SetFont(pdfFace, "", 12)
	d.pdf.SetTextColor(pdfSubtitle[0], pdfSubtitle[1], pdfSubtitle[2])
	d.pdf.CellFormat(0, 7, d.title, "", 1, "C", false, 0, "")
	d.pdf.Ln(5)
}

func (d *pdfDoc) breakIfNeeded(need float64) {
	if d.pdf.GetY()+need > 258.0 {
		d.pdf.AddPage()
	}
}

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
				d.pdf.CellFormat(labelW, pdfRowH, "", "1", 0, "L", false, 0, "")
				d.pdf.CellFormat(valueW, pdfRowH, "", "1", 0, "L", false, 0, "")
			}
		}
		d.pdf.Ln(-1)
	}
	d.pdf.Ln(6)
}

func (d *pdfDoc) table(cols []pdfCol, rows [][]string, total []string) {
	header := func() {
		d.pdf.SetX(pdfMarginX)
		d.pdf.SetFont(pdfFace, "B", 10)
		d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
		d.pdf.SetFillColor(pdfThFill[0], pdfThFill[1], pdfThFill[2])
		d.pdf.SetDrawColor(pdfBorder[0], pdfBorder[1], pdfBorder[2])
		for _, c := range cols {
			d.pdf.CellFormat(c.W, pdfRowH, c.Title, "1", 0, "C", true, 0, "")
		}
		d.pdf.Ln(-1)
	}
	d.breakIfNeeded(pdfRowH * 2)
	header()
	for _, r := range rows {
		if d.pdf.GetY()+pdfRowH > 258.0 {
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

func (d *pdfDoc) signatures(labels ...string) {
	need := 32.0
	d.breakIfNeeded(need)
	y := d.pdf.GetY() + 24
	if y > 258.0 {
		d.pdf.AddPage()
		y = d.pdf.GetY() + 24
	}
	colW := d.bodyW / float64(len(labels))
	d.pdf.SetDrawColor(pdfSigRule[0], pdfSigRule[1], pdfSigRule[2])
	d.pdf.SetFont(pdfFace, "", 10)
	d.pdf.SetTextColor(pdfInk[0], pdfInk[1], pdfInk[2])
	for i, label := range labels {
		x := pdfMarginX + float64(i)*colW
		d.pdf.Line(x+6, y, x+colW-6, y)
		d.pdf.SetXY(x, y+1)
		d.pdf.CellFormat(colW, 7, label, "", 0, "C", false, 0, "")
	}
	d.pdf.SetY(y + 10)
}

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

func renderPaymentReceiptPDF(l *models.Loan, p *models.LoanPayment) ([]byte, error) {
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

func renderLoanStatementPDF(l *models.Loan, payments []models.LoanPayment) ([]byte, error) {
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

func customerIDFromContext(c echo.Context) (uint, bool) {
	v, ok := common.Get(c, "customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

func customerOwnedLoan(c echo.Context, loanID, customerID uint) (*models.Loan, error) {
	ctx := auth.RequestContext(c)
	l, err := GetLoan(ctx, loanID, nil)
	if err != nil {
		return nil, err
	}
	if l.CustomerID != customerID {
		return nil, common.NewNotFound("loan not found")
	}
	return l, nil
}

func CustomerListLoans(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	f := LoanFilter{Status: c.QueryParam("status"), CustomerID: customerID}
	if limit > 0 {
		f.Limit, f.Offset = limit, offset
		rec, total, err := listLoans(ctx, f)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := listLoans(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}

func CustomerGetLoan(c echo.Context) error {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	l, err := customerOwnedLoan(c, loanID, customerID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, l)
}

func CustomerCreateExtensionRequest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if _, err := customerOwnedLoan(c, loanID, customerID); err != nil {
		return common.FailErr(c, err)
	}
	var req extensionRequestRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := SaveExtensionRequest(ctx, loanID, ExtensionRequestInput{
		Months:      req.Months,
		Detail:      req.Detail,
		RequestedBy: "Customer",
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func CustomerListLoanRequests(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if _, err := customerOwnedLoan(c, loanID, customerID); err != nil {
		return common.FailErr(c, err)
	}
	rec, _, err := listRequests(ctx, LoanRequestFilter{LoanID: loanID})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func CustomerCreateReleaseRequest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if _, err := customerOwnedLoan(c, loanID, customerID); err != nil {
		return common.FailErr(c, err)
	}
	var req releaseRequestRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := SaveReleaseRequest(ctx, loanID, ReleaseRequestInput{
		Detail:      req.Detail,
		RequestedBy: "Customer",
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func CustomerCreateRazorpayOrder(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if _, err := customerOwnedLoan(c, loanID, customerID); err != nil {
		return common.FailErr(c, err)
	}
	var req razorpayCreateOrderRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	result, err := createRazorpayOrder(ctx, loanID, req.Amount, req.Type)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, result)
}

func CustomerVerifyRazorpayPayment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if _, err := customerOwnedLoan(c, loanID, customerID); err != nil {
		return common.FailErr(c, err)
	}
	var req razorpayVerifyRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	l, err := verifyAndRecordRazorpayPayment(ctx, loanID, RazorpayVerifyInput{
		OrderID:   req.OrderID,
		PaymentID: req.PaymentID,
		Signature: req.Signature,
		Amount:    req.Amount,
		Type:      req.Type,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, l)
}

func CustomerListLoanPayments(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if _, err := customerOwnedLoan(c, loanID, customerID); err != nil {
		return common.FailErr(c, err)
	}
	rec, err := findPaymentByLoanID(ctx, loanID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func CustomerCheckIndemnityBondEsign(c echo.Context) error {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if _, err := customerOwnedLoan(c, loanID, customerID); err != nil {
		return common.FailErr(c, err)
	}
	ctx := auth.RequestContext(c)
	rec, status, err := checkIndemnityBondSign(ctx, loanID, nil)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{
		"loan":   rec,
		"status": status.Status,
	})
}

func CustomerListPayments(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	if limit > 0 {
		rec, err := findPaymentByCustomerID(ctx, customerID, limit+1, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		hasMore := len(rec) > limit
		if hasMore {
			rec = rec[:limit]
		}
		return common.SuccessList(c, page, limit, common.NextPages(page, hasMore), rec)
	}
	rec, err := findPaymentByCustomerID(ctx, customerID, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}

func CustomerPaymentReceipt(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	paymentID, err := common.IDParam(c, "payment_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	payment, err := findPaymentByID(ctx, paymentID)
	if err != nil {
		return common.FailErr(c, common.NewNotFound("loan not found"))
	}
	l, err := customerOwnedLoan(c, payment.LoanID, customerID)
	if err != nil {
		return common.FailErr(c, err)
	}
	buf, err := renderPaymentReceiptPDF(l, payment)
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"receipt-%d.pdf\"", payment.ID))
	return c.Blob(http.StatusOK, "application/pdf", buf)
}

func CustomerLoanStatement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	l, err := customerOwnedLoan(c, loanID, customerID)
	if err != nil {
		return common.FailErr(c, err)
	}
	payments, err := findPaymentByLoanID(ctx, l.ID)
	if err != nil {
		return common.FailErr(c, err)
	}
	buf, err := renderLoanStatementPDF(l, payments)
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"statement-%s.pdf\"", l.LoanNumber))
	return c.Blob(http.StatusOK, "application/pdf", buf)
}
