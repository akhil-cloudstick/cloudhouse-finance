package reports

import (
	"cloudhouse/backend/internal/platform"
	"bytes"
	"context"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jung-kurt/gofpdf"
	"github.com/xuri/excelize/v2"
)

// reportKeys maps each report's URL key (GET /reports/:key/export) to a
// function returning its full (unpaginated — exports need every matching
// row, not just the current page), un-typed row slice + totals. Kept as one
// table so the export handler stays generic instead of a 15-way switch
// duplicated across JSON/xlsx/pdf.
func (h *Handler) reportRows(ctx context.Context, key string, f Filter) (rows any, totals any, err error) {
	switch key {
	case "disbursement":
		return call2(h.svc.Disbursement(ctx, f))
	case "personal-loans":
		return call2(h.svc.PersonalLoans(ctx, f))
	case "loans-status":
		return call2(h.svc.LoanStatus(ctx, f, ""))
	case "interest-collection":
		return call2(h.svc.InterestCollection(ctx, f))
	case "outstanding-principal":
		return call2(h.svc.OutstandingPrincipal(ctx, f))
	case "payment-collection":
		return call2(h.svc.PaymentCollection(ctx, f))
	case "gold-weight":
		return call2(h.svc.GoldWeight(ctx, f))
	case "packets":
		return call2(h.svc.Packets(ctx, f))
	case "bank-pledge":
		return call2(h.svc.BankPledge(ctx, f))
	case "loan-extensions":
		return call2(h.svc.LoanExtensions(ctx, f))
	case "gold-release":
		return call2(h.svc.GoldRelease(ctx, f))
	case "auctions":
		return call2(h.svc.Auctions(ctx, f))
	case "expense-cashflow":
		return call2(h.svc.ExpenseCashflow(ctx, f))
	case "kyc":
		return call2(h.svc.KYC(ctx, f))
	case "gold-rate-history":
		return call2(h.svc.GoldRateHistory(ctx, f))
	case "employee-performance":
		return call2(h.svc.EmployeePerformance(ctx, f))
	case "communication-history":
		return call2(h.svc.CommunicationHistory(ctx, f, ""))
	case "investments-deposit-register":
		return call2(h.svc.DepositRegister(ctx, f))
	case "investments-interest-payout-register":
		return call2(h.svc.InterestPayoutRegister(ctx, f))
	case "investments-maturity-register":
		return call2(h.svc.MaturityRegister(ctx, f))
	case "balance-sheet":
		return call2(h.svc.BalanceSheet(f))
	case "profit-loss":
		return call2(h.svc.ProfitAndLoss(f))
	default:
		return nil, nil, fmt.Errorf("unknown report key %q", key)
	}
}

// call2 adapts a (rows, totals, error) triple returning a concrete slice
// type into the any/any/error shape reportRows needs, without a 15-way type
// switch at each call site.
func call2[T any, U any](rows []T, totals U, err error) (any, any, error) {
	return rows, totals, err
}

// Export handles GET /reports/:key/export?format=xlsx|pdf, ignoring
// pagination (Page/PageSize) — the file must contain every row matching the
// filters, not just the on-screen page.
func (h *Handler) Export(c *gin.Context) {
	ctx := platform.RequestContext(c)
	key := c.Param("key")
	format := c.DefaultQuery("format", "xlsx")
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}

	// Balance Sheet / Statement of P&L are printed financial statements
	// (bold subtotal rows, indented sub-items, a fixed Particulars/Amount
	// layout with a letterhead) rather than a tabular listing of many
	// records — the generic reflection-based toTable/BuildXLSX/BuildPDF
	// path below (built for the other 17 reports) would just dump their
	// Label/Amount/Style/Indent fields as flat columns, losing exactly the
	// formatting a real Division III statement needs. These two keys get
	// their own dedicated builder instead.
	if key == "balance-sheet" || key == "profit-loss" {
		h.exportStatement(c, key, format, f)
		return
	}

	// Balance Sheet / Statement of P&L are printed financial statements
	// (bold subtotal rows, indented sub-items, a fixed Particulars/Amount
	// layout with a letterhead) rather than a tabular listing of many
	// records — the generic reflection-based toTable/BuildXLSX/BuildPDF
	// path below (built for the other 17 reports) would just dump their
	// Label/Amount/Style/Indent fields as flat columns, losing exactly the
	// formatting a real Division III statement needs. These two keys get
	// their own dedicated builder instead.
	if key == "balance-sheet" || key == "profit-loss" {
		h.exportStatement(c, key, format, f)
		return
	}

	// Form G is a fixed-layout statutory statement, not a repeated-row
	// listing — it can't go through toTable's reflection-based generic
	// table builder below, so it's special-cased here with its own
	// dedicated buildFormGXLSX/buildFormGPDF (see formg.go).
	if key == "form-g" {
		h.exportFormG(c, f, format)
		return
	}

	// Form G is a fixed-layout statutory statement, not a repeated-row
	// listing — it can't go through toTable's reflection-based generic
	// table builder below, so it's special-cased here with its own
	// dedicated buildFormGXLSX/buildFormGPDF (see formg.go).
	if key == "form-g" {
		h.exportFormG(c, f, format)
		return
	}

	rows, _, err := h.reportRows(ctx, key, f)
	if err != nil {
		badRequest(c, err)
		return
	}

	headers, data := toTable(rows)
	filename := fmt.Sprintf("%s-%s.%s", key, time.Now().Format("20060102-150405"), format)

	switch format {
	case "xlsx":
		buf, err := BuildXLSX(key, headers, data)
		if err != nil {
			serverError(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := BuildPDF(h.svc.BusinessName(ctx), key, headers, data)
		if err != nil {
			serverError(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/pdf", buf)
	default:
		badRequest(c, fmt.Errorf("format must be xlsx or pdf"))
	}
}

// StatementLine is the common shape BuildStatementXLSX/BuildStatementPDF
// render — BalanceSheetRow and ProfitLossRow both already match it field
// for field, so exportStatement just re-types the slice rather than
// copying data.
type StatementLine struct {
	Label  string
	Amount float64
	Style  string
	Indent int
}

// exportStatement renders Balance Sheet / Statement of P&L as a letterhead
// financial statement (see Export's comment above), instead of the generic
// tabular export every other report uses.
func (h *Handler) exportStatement(c *gin.Context, key, format string, f Filter) {
	var title, asOfLabel string
	var lines []StatementLine

	switch key {
	case "balance-sheet":
		rows, _, err := h.svc.BalanceSheet(f)
		if err != nil {
			serverError(c, err)
			return
		}
		title = "Balance Sheet"
		_, asOf := dateRange(f)
		asOfLabel = "As at " + asOf.Format("02-Jan-2006")
		for _, r := range rows {
			lines = append(lines, StatementLine{Label: r.Label, Amount: r.Amount, Style: r.Style, Indent: r.Indent})
		}
	case "profit-loss":
		rows, _, err := h.svc.ProfitAndLoss(f)
		if err != nil {
			serverError(c, err)
			return
		}
		title = "Statement of Profit and Loss"
		from, to := dateRange(f)
		asOfLabel = fmt.Sprintf("For the period %s to %s", from.Format("02-Jan-2006"), to.Format("02-Jan-2006"))
		for _, r := range rows {
			lines = append(lines, StatementLine{Label: r.Label, Amount: r.Amount, Style: r.Style, Indent: r.Indent})
		}
	}

	filename := fmt.Sprintf("%s-%s.%s", key, time.Now().Format("20060102-150405"), format)
	switch format {
	case "xlsx":
		buf, err := BuildStatementXLSX(title, asOfLabel, lines)
		if err != nil {
			serverError(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := BuildStatementPDF(title, asOfLabel, lines)
		if err != nil {
			serverError(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/pdf", buf)
	default:
		badRequest(c, fmt.Errorf("format must be xlsx or pdf"))
	}
}

// toTable reflects over a []SomeStruct (any of model.go's Row types) into a
// generic header row (from each field's json tag) + string cell rows —
// lets export stay report-agnostic rather than needing a per-report mapping
// to spreadsheet columns.
func toTable(rows any) (headers []string, data [][]string) {
	v := reflect.ValueOf(rows)
	if v.Kind() != reflect.Slice || v.Len() == 0 {
		// Still need headers if the type is known even with zero rows —
		// derive them from the slice's element type.
		if v.Kind() == reflect.Slice {
			headers = fieldHeaders(v.Type().Elem())
		}
		return headers, data
	}
	headers = fieldHeaders(v.Type().Elem())
	for i := 0; i < v.Len(); i++ {
		data = append(data, fieldValues(v.Index(i)))
	}
	return headers, data
}

func fieldHeaders(t reflect.Type) []string {
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	var out []string
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		tag := f.Tag.Get("json")
		if tag == "" || tag == "-" {
			tag = f.Name
		}
		// Strip ",omitempty" etc.
		for i, ch := range tag {
			if ch == ',' {
				tag = tag[:i]
				break
			}
		}
		out = append(out, tag)
	}
	return out
}

func fieldValues(v reflect.Value) []string {
	if v.Kind() == reflect.Ptr {
		if v.IsNil() {
			v = reflect.Value{}
		} else {
			v = v.Elem()
		}
	}
	if !v.IsValid() {
		return nil
	}
	t := v.Type()
	var out []string
	for i := 0; i < t.NumField(); i++ {
		fv := v.Field(i)
		out = append(out, formatCell(fv))
	}
	return out
}

func formatCell(v reflect.Value) string {
	if v.Kind() == reflect.Ptr {
		if v.IsNil() {
			return ""
		}
		v = v.Elem()
	}
	if !v.IsValid() {
		return ""
	}
	if t, ok := v.Interface().(time.Time); ok {
		if t.IsZero() {
			return ""
		}
		return t.Format("2006-01-02")
	}
	switch v.Kind() {
	case reflect.Float32, reflect.Float64:
		return fmt.Sprintf("%.2f", v.Float())
	default:
		return fmt.Sprintf("%v", v.Interface())
	}
}

// BuildXLSX renders headers/data as a single-sheet workbook with a bold
// header row.
func BuildXLSX(sheetName string, headers []string, data [][]string) ([]byte, error) {
	f := excelize.NewFile()
	sheet := "Report"
	f.SetSheetName(f.GetSheetName(0), sheet)

	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	for r, row := range data {
		for c, val := range row {
			cell, _ := excelize.CoordinatesToCellName(c+1, r+2)
			f.SetCellValue(sheet, cell, val)
		}
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// BuildStatementXLSX renders a Balance Sheet/Statement of P&L as a plain
// two-column (Particulars, Amount) sheet — bold rows for Style "header"/
// "total", Amount left blank on "header" rows (pure section titles, no
// figure of their own), indented by Indent levels of 2 spaces each since
// a spreadsheet cell has no padding to reach for.
func BuildStatementXLSX(title, asOfLabel string, lines []StatementLine) ([]byte, error) {
	f := excelize.NewFile()
	sheet := "Statement"
	f.SetSheetName(f.GetSheetName(0), sheet)
	bold, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}

	f.SetCellValue(sheet, "A1", "Ambika Gold Finance")
	f.SetCellStyle(sheet, "A1", "A1", bold)
	f.SetCellValue(sheet, "A2", title)
	f.SetCellStyle(sheet, "A2", "A2", bold)
	f.SetCellValue(sheet, "A3", asOfLabel)

	row := 5
	f.SetCellValue(sheet, fmt.Sprintf("A%d", row), "Particulars")
	f.SetCellValue(sheet, fmt.Sprintf("B%d", row), "Amount (Rs.)")
	f.SetCellStyle(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("B%d", row), bold)
	row++

	for _, l := range lines {
		labelCell := fmt.Sprintf("A%d", row)
		amountCell := fmt.Sprintf("B%d", row)
		f.SetCellValue(sheet, labelCell, strings.Repeat("  ", l.Indent)+l.Label)
		if l.Style != "header" {
			f.SetCellValue(sheet, amountCell, l.Amount)
		}
		if l.Style == "header" || l.Style == "total" {
			f.SetCellStyle(sheet, labelCell, amountCell, bold)
		}
		row++
	}
	f.SetColWidth(sheet, "A", "A", 55)
	f.SetColWidth(sheet, "B", "B", 18)

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// BuildStatementPDF renders a Balance Sheet/Statement of P&L as a
// letterhead + two-column (Particulars, Amount) statement — bold for
// "header"/"total" rows, Amount left blank on "header" rows, Label
// indented per its Indent level (matching a real Division III statement's
// nested "I./​(1)/(a)" layout) rather than the flat multi-column reflected
// table BuildPDF renders for every other report.
func BuildStatementPDF(title, asOfLabel string, lines []StatementLine) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	pdf.AddPage()

	pdf.SetFont("Arial", "B", 14)
	pdf.CellFormat(0, 8, tr("Ambika Gold Finance"), "", 1, "C", false, 0, "")
	pdf.SetFont("Arial", "B", 12)
	pdf.CellFormat(0, 7, tr(title), "", 1, "C", false, 0, "")
	pdf.SetFont("Arial", "", 10)
	pdf.CellFormat(0, 6, tr(asOfLabel), "", 1, "C", false, 0, "")
	pdf.Ln(4)

	pageWidth, _ := pdf.GetPageSize()
	marginL, _, marginR, _ := pdf.GetMargins()
	usable := pageWidth - marginL - marginR
	labelWidth := usable * 0.75
	amountWidth := usable - labelWidth
	const indentStep = 6.0

	pdf.SetFont("Arial", "B", 9)
	pdf.CellFormat(labelWidth, 7, tr("Particulars"), "B", 0, "L", false, 0, "")
	pdf.CellFormat(amountWidth, 7, tr("Amount (Rs.)"), "B", 1, "R", false, 0, "")

	for _, l := range lines {
		bold := l.Style == "header" || l.Style == "total"
		if bold {
			pdf.SetFont("Arial", "B", 9)
		} else {
			pdf.SetFont("Arial", "", 9)
		}
		indent := float64(l.Indent) * indentStep
		if indent > 0 {
			pdf.CellFormat(indent, 6, "", "", 0, "L", false, 0, "")
		}
		pdf.CellFormat(labelWidth-indent, 6, tr(l.Label), "", 0, "L", false, 0, "")
		amountStr := ""
		if l.Style != "header" {
			amountStr = fmt.Sprintf("%.2f", l.Amount)
		}
		pdf.CellFormat(amountWidth, 6, tr(amountStr), "", 1, "R", false, 0, "")
		if pdf.GetY() > 270 {
			pdf.AddPage()
		}
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// BuildPDF renders headers/data as a simple tabular PDF (letterhead-style
// title + table) — a plain, functional layout rather than a polished
// letterhead design, matching this codebase's other export-lite features.
func BuildPDF(businessName, title string, headers []string, data [][]string) ([]byte, error) {
	pdf := gofpdf.New("L", "mm", "A4", "")
	// gofpdf's core "Arial" font expects cp1252/WinAnsi bytes, not UTF-8 —
	// handing it a raw Go string (UTF-8 under the hood) let each multi-byte
	// character's individual bytes get rendered as if they were separate
	// cp1252 characters, which is exactly what turned the title's em dash
	// (—) into "â€”" garbage in the exported PDF. UnicodeTranslatorFromDescriptor
	// re-encodes any UTF-8 string that IS representable in cp1252 (which
	// covers everything this report actually emits — em dashes, quotes,
	// etc.) into the byte sequence the core font actually expects.
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 14)
	pdf.CellFormat(0, 10, businessName+" — "+title, "", 1, "L", false, 0, "")
	pdf.SetFont("Arial", "", 8)

	pageWidth, _ := pdf.GetPageSize()
	marginL, _, marginR, _ := pdf.GetMargins()
	usable := pageWidth - marginL - marginR
	colCount := len(headers)
	if colCount == 0 {
		colCount = 1
	}
	colWidth := usable / float64(colCount)

	pdf.SetFont("Arial", "B", 8)
	for _, hcell := range headers {
		pdf.CellFormat(colWidth, 7, tr(hcell), "1", 0, "L", false, 0, "")
	}
	pdf.Ln(-1)

	pdf.SetFont("Arial", "", 8)
	for _, row := range data {
		for i := 0; i < colCount; i++ {
			val := ""
			if i < len(row) {
				val = row[i]
			}
			pdf.CellFormat(colWidth, 6, tr(val), "1", 0, "L", false, 0, "")
		}
		pdf.Ln(-1)
		if pdf.GetY() > 190 {
			pdf.AddPage()
		}
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
