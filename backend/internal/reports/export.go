package reports

import (
	"bytes"
	"fmt"
	"net/http"
	"reflect"
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
func (h *Handler) reportRows(key string, f Filter) (rows any, totals any, err error) {
	switch key {
	case "disbursement":
		return call2(h.svc.Disbursement(f))
	case "loans-status":
		return call2(h.svc.LoanStatus(f, ""))
	case "interest-collection":
		return call2(h.svc.InterestCollection(f))
	case "outstanding-principal":
		return call2(h.svc.OutstandingPrincipal(f))
	case "payment-collection":
		return call2(h.svc.PaymentCollection(f))
	case "gold-weight":
		return call2(h.svc.GoldWeight(f))
	case "packets":
		return call2(h.svc.Packets(f))
	case "bank-pledge":
		return call2(h.svc.BankPledge(f))
	case "loan-extensions":
		return call2(h.svc.LoanExtensions(f))
	case "gold-release":
		return call2(h.svc.GoldRelease(f))
	case "auctions":
		return call2(h.svc.Auctions(f))
	case "expense-cashflow":
		return call2(h.svc.ExpenseCashflow(f))
	case "kyc":
		return call2(h.svc.KYC(f))
	case "gold-rate-history":
		return call2(h.svc.GoldRateHistory(f))
	case "employee-performance":
		return call2(h.svc.EmployeePerformance(f))
	case "communication-history":
		return call2(h.svc.CommunicationHistory(f, ""))
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
	key := c.Param("key")
	format := c.DefaultQuery("format", "xlsx")
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return
	}

	rows, _, err := h.reportRows(key, f)
	if err != nil {
		badRequest(c, err)
		return
	}

	headers, data := toTable(rows)
	filename := fmt.Sprintf("%s-%s.%s", key, time.Now().Format("20060102-150405"), format)

	switch format {
	case "xlsx":
		buf, err := buildXLSX(key, headers, data)
		if err != nil {
			serverError(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := buildPDF(key, headers, data)
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

// buildXLSX renders headers/data as a single-sheet workbook with a bold
// header row.
func buildXLSX(sheetName string, headers []string, data [][]string) ([]byte, error) {
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

// buildPDF renders headers/data as a simple tabular PDF (letterhead-style
// title + table) — a plain, functional layout rather than a polished
// letterhead design, matching this codebase's other export-lite features.
func buildPDF(title string, headers []string, data [][]string) ([]byte, error) {
	pdf := gofpdf.New("L", "mm", "A4", "")
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 14)
	pdf.CellFormat(0, 10, "Ambika Gold Finance — "+title, "", 1, "L", false, 0, "")
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
		pdf.CellFormat(colWidth, 7, hcell, "1", 0, "L", false, 0, "")
	}
	pdf.Ln(-1)

	pdf.SetFont("Arial", "", 8)
	for _, row := range data {
		for i := 0; i < colCount; i++ {
			val := ""
			if i < len(row) {
				val = row[i]
			}
			pdf.CellFormat(colWidth, 6, val, "1", 0, "L", false, 0, "")
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
