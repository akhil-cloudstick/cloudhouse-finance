package controllers

import (
	"bytes"
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/jung-kurt/gofpdf"
	"github.com/labstack/echo/v4"
	"github.com/xuri/excelize/v2"
)

type StatementLine struct {
	Label  string
	Amount float64
	Style  string
	Indent int
}

func reportRows(ctx context.Context, key string, f models.Filter) (rows any, totals any, err error) {
	switch key {
	case "disbursement":
		return call2(disbursementReport(ctx, f))
	case "personal-loans":
		return call2(personalLoans(ctx, f))
	case "loans-status":
		return call2(loanStatus(ctx, f, ""))
	case "interest-collection":
		return call2(interestCollection(ctx, f))
	case "outstanding-principal":
		return call2(outstandingPrincipal(ctx, f))
	case "payment-collection":
		return call2(paymentCollection(ctx, f))
	case "gold-weight":
		return call2(goldWeight(ctx, f))
	case "packets":
		return call2(packetsReport(ctx, f))
	case "bank-pledge":
		return call2(bankPledge(ctx, f))
	case "loan-extensions":
		return call2(loanExtensions(ctx, f))
	case "gold-release":
		return call2(goldRelease(ctx, f))
	case "auctions":
		return call2(auctionsReport(ctx, f))
	case "expense-cashflow":
		return call2(expenseCashflow(ctx, f))
	case "kyc":
		return call2(kycReport(ctx, f))
	case "gold-rate-history":
		return call2(goldRateHistory(ctx, f))
	case "employee-performance":
		return call2(employeePerformance(ctx, f))
	case "communication-history":
		return call2(communicationHistory(ctx, f, ""))
	case "investments-deposit-register":
		return call2(depositRegister(ctx, f))
	case "investments-interest-payout-register":
		return call2(interestPayoutRegister(ctx, f))
	case "investments-maturity-register":
		return call2(maturityRegister(ctx, f))
	case "balance-sheet":
		return call2(balanceSheet(ctx, f))
	case "profit-loss":
		return call2(profitAndLoss(ctx, f))
	default:
		return nil, nil, fmt.Errorf("unknown report key %q", key)
	}
}

func call2[T any, U any](rows []T, totals U, err error) (any, any, error) {
	return rows, totals, err
}

func toTable(rows any) (headers []string, data [][]string) {
	v := reflect.ValueOf(rows)
	if v.Kind() != reflect.Slice || v.Len() == 0 {
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

func BuildStatementXLSX(businessName, title, asOfLabel string, lines []StatementLine) ([]byte, error) {
	f := excelize.NewFile()
	sheet := "Statement"
	f.SetSheetName(f.GetSheetName(0), sheet)
	bold, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}
	f.SetCellValue(sheet, "A1", businessName)
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

func BuildStatementPDF(businessName, title, asOfLabel string, lines []StatementLine) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 14)
	pdf.CellFormat(0, 8, tr(businessName), "", 1, "C", false, 0, "")
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

func BuildPDF(businessName, title string, headers []string, data [][]string) ([]byte, error) {
	pdf := gofpdf.New("L", "mm", "A4", "")
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

func dropColumn(headers []string, data [][]string, name string) ([]string, [][]string) {
	idx := -1
	for i, h := range headers {
		if h == name {
			idx = i
			break
		}
	}
	if idx < 0 {
		return headers, data
	}
	headers = append(append([]string{}, headers[:idx]...), headers[idx+1:]...)
	for r, row := range data {
		if idx < len(row) {
			data[r] = append(append([]string{}, row[:idx]...), row[idx+1:]...)
		}
	}
	return headers, data
}

func exportStatement(c echo.Context, key, format string, f models.Filter) error {
	ctx := auth.RequestContext(c)
	var title, asOfLabel string
	var lines []StatementLine
	switch key {
	case "balance-sheet":
		rows, _, err := balanceSheet(ctx, f)
		if err != nil {
			reportError(c, err)
			return nil
		}
		title = "Balance Sheet"
		_, asOf := dateRange(f)
		asOfLabel = "As at " + asOf.Format("02-Jan-2006")
		for _, r := range rows {
			lines = append(lines, StatementLine{Label: r.Label, Amount: r.Amount, Style: r.Style, Indent: r.Indent})
		}
	case "profit-loss":
		rows, _, err := profitAndLoss(ctx, f)
		if err != nil {
			reportError(c, err)
			return nil
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
		buf, err := BuildStatementXLSX(businessName(ctx), title, asOfLabel, lines)
		if err != nil {
			reportError(c, err)
			return nil
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := BuildStatementPDF(businessName(ctx), title, asOfLabel, lines)
		if err != nil {
			reportError(c, err)
			return nil
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/pdf", buf)
	default:
		badRequest(c, fmt.Errorf("format must be xlsx or pdf"))
	}
	return nil
}

func ExportReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	key := c.Param("key")
	format := common.DefaultQuery(c, "format", "xlsx")
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	if key == "balance-sheet" || key == "profit-loss" {
		exportStatement(c, key, format, f)
		return nil
	}
	if key == "balance-sheet" || key == "profit-loss" {
		exportStatement(c, key, format, f)
		return nil
	}
	if key == "form-g" {
		exportFormG(c, f, format)
		return nil
	}
	if key == "form-g" {
		exportFormG(c, f, format)
		return nil
	}
	rows, _, err := reportRows(ctx, key, f)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	headers, data := toTable(rows)
	if _, single := auth.SingleBranchPin(c); single {
		headers, data = dropColumn(headers, data, "branchName")
	}
	filename := fmt.Sprintf("%s-%s.%s", key, time.Now().Format("20060102-150405"), format)
	switch format {
	case "xlsx":
		buf, err := BuildXLSX(key, headers, data)
		if err != nil {
			reportError(c, err)
			return nil
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := BuildPDF(businessName(ctx), key, headers, data)
		if err != nil {
			reportError(c, err)
			return nil
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/pdf", buf)
	default:
		badRequest(c, fmt.Errorf("format must be xlsx or pdf"))
	}
	return nil
}
