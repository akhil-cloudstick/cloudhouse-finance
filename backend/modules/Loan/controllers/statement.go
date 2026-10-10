package controllers

import (
	"bytes"
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/jung-kurt/gofpdf"
)

func loanStatement(ctx context.Context, loanID uint, branchID *uint) (data []byte, filename string, err error) {
	l, err := GetLoan(ctx, loanID, branchID)
	if err != nil {
		return nil, "", err
	}
	businessName := businessName(ctx)
	if singleBranch(ctx) {
		l.Branch.Name = ""
	}
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetTitle(fmt.Sprintf("Loan Statement %s", l.LoanNumber), true)
	pdf.AddPage()
	writeStatementHeader(pdf, businessName, l)
	writeLoanSummary(pdf, l)
	writeOrnaments(pdf, l)
	writePayments(pdf, l)
	writeBalanceSummary(pdf, l)
	writeStatementFooter(pdf)
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), fmt.Sprintf("statement-%s.pdf", l.LoanNumber), nil
}

func businessName(ctx context.Context) string {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return "Gold Loan Statement"
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil || t.Name == "" {
		return "Gold Loan Statement"
	}
	return t.Name
}

func brandedMessage(ctx context.Context, format string, args ...any) string {
	msg := fmt.Sprintf(format, args...)
	return strings.ReplaceAll(msg, "CloudHouse Finance", businessName(ctx))
}

func money(v float64) string {
	return fmt.Sprintf("%.2f", v)
}

func dateOnly(t time.Time) string {
	if t.IsZero() {
		return "-"
	}
	return t.Format("02-Jan-2006")
}

func writeStatementHeader(pdf *gofpdf.Fpdf, business string, l *models.Loan) {
	pdf.SetFont("Arial", "B", 16)
	pdf.CellFormat(0, 9, business, "", 1, "C", false, 0, "")
	pdf.SetFont("Arial", "B", 12)
	pdf.CellFormat(0, 7, "Gold Loan Statement", "", 1, "C", false, 0, "")
	pdf.SetFont("Arial", "", 9)
	pdf.CellFormat(0, 5, "Generated "+time.Now().Format("02-Jan-2006 15:04"), "", 1, "C", false, 0, "")
	if l.Branch.Name != "" {
		pdf.CellFormat(0, 5, "Branch: "+l.Branch.Name, "", 1, "C", false, 0, "")
	}
	pdf.Ln(3)
}

func kv(pdf *gofpdf.Fpdf, label, value string) {
	pdf.SetFont("Arial", "", 9)
	pdf.CellFormat(45, 6, label, "", 0, "L", false, 0, "")
	pdf.SetFont("Arial", "B", 9)
	pdf.CellFormat(50, 6, value, "", 1, "L", false, 0, "")
}

func sectionTitle(pdf *gofpdf.Fpdf, title string) {
	pdf.Ln(2)
	pdf.SetFont("Arial", "B", 10)
	pdf.SetFillColor(240, 236, 220)
	pdf.CellFormat(0, 7, "  "+title, "", 1, "L", true, 0, "")
	pdf.Ln(1)
}

func writeLoanSummary(pdf *gofpdf.Fpdf, l *models.Loan) {
	sectionTitle(pdf, "Loan Details")
	status := l.Status
	if l.IsOverdue && !strings.EqualFold(status, models.StatusOverdue) {
		status = fmt.Sprintf("%s (overdue by %d days)", status, l.DaysOverdue)
	}
	kv(pdf, "Loan Number", l.LoanNumber)
	kv(pdf, "Status", status)
	kv(pdf, "Customer", fmt.Sprintf("%s (%s)", l.Customer.Name, l.Customer.Code))
	kv(pdf, "Phone", l.Customer.Phone)
	kv(pdf, "Scheme", l.Scheme.Name)
	kv(pdf, "Interest Rate", fmt.Sprintf("%.2f%% p.a.", l.SchemeInterestRate))
	kv(pdf, "Opened On", dateOnly(l.OpenedDate))
	kv(pdf, "Due On", dateOnly(l.DueDate))
}

func writeOrnaments(pdf *gofpdf.Fpdf, l *models.Loan) {
	sectionTitle(pdf, "Pledged Ornaments")
	active := make([]models.Ornament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		if o.ReleasedAt == nil {
			active = append(active, o)
		}
	}
	if len(active) == 0 {
		pdf.SetFont("Arial", "I", 9)
		pdf.CellFormat(0, 6, "No ornaments recorded.", "", 1, "L", false, 0, "")
		return
	}
	headers := []string{"Item", "Purity", "Gross (g)", "Net (g)", "Qty", "Value"}
	widths := []float64{60, 22, 25, 25, 15, 33}
	pdf.SetFont("Arial", "B", 9)
	pdf.SetFillColor(248, 245, 235)
	for i, h := range headers {
		align := "L"
		if i >= 2 {
			align = "R"
		}
		pdf.CellFormat(widths[i], 7, h, "1", 0, align, true, 0, "")
	}
	pdf.Ln(-1)
	pdf.SetFont("Arial", "", 9)
	var totalGross, totalNet, totalValue float64
	for _, o := range active {
		pdf.CellFormat(widths[0], 6, truncate(o.Name, 38), "1", 0, "L", false, 0, "")
		pdf.CellFormat(widths[1], 6, o.Purity, "1", 0, "L", false, 0, "")
		pdf.CellFormat(widths[2], 6, fmt.Sprintf("%.2f", o.GrossWeight), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[3], 6, fmt.Sprintf("%.2f", o.NetWeight), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[4], 6, fmt.Sprintf("%d", o.Quantity), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[5], 6, money(o.GoldValue), "1", 1, "R", false, 0, "")
		totalGross += o.GrossWeight
		totalNet += o.NetWeight
		totalValue += o.GoldValue
	}
	pdf.SetFont("Arial", "B", 9)
	pdf.CellFormat(widths[0]+widths[1], 6, "Total", "1", 0, "L", false, 0, "")
	pdf.CellFormat(widths[2], 6, fmt.Sprintf("%.2f", totalGross), "1", 0, "R", false, 0, "")
	pdf.CellFormat(widths[3], 6, fmt.Sprintf("%.2f", totalNet), "1", 0, "R", false, 0, "")
	pdf.CellFormat(widths[4], 6, "", "1", 0, "R", false, 0, "")
	pdf.CellFormat(widths[5], 6, money(totalValue), "1", 1, "R", false, 0, "")
}

func writePayments(pdf *gofpdf.Fpdf, l *models.Loan) {
	sectionTitle(pdf, "Payment History")
	if len(l.Payments) == 0 {
		pdf.SetFont("Arial", "I", 9)
		pdf.CellFormat(0, 6, "No payments recorded against this loan yet.", "", 1, "L", false, 0, "")
		return
	}
	headers := []string{"Date", "Type", "Amount", "Interest", "Penal", "Principal", "Balance"}
	widths := []float64{24, 30, 25, 22, 20, 25, 34}
	pdf.SetFont("Arial", "B", 8)
	pdf.SetFillColor(248, 245, 235)
	for i, h := range headers {
		align := "L"
		if i >= 2 {
			align = "R"
		}
		pdf.CellFormat(widths[i], 7, h, "1", 0, align, true, 0, "")
	}
	pdf.Ln(-1)
	pdf.SetFont("Arial", "", 8)
	var totalPaid float64
	for _, p := range l.Payments {
		if pdf.GetY() > 250 {
			pdf.AddPage()
		}
		pdf.CellFormat(widths[0], 6, dateOnly(p.PaidOn), "1", 0, "L", false, 0, "")
		pdf.CellFormat(widths[1], 6, truncate(p.Type, 18), "1", 0, "L", false, 0, "")
		pdf.CellFormat(widths[2], 6, money(p.Amount), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[3], 6, money(p.InterestApplied), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[4], 6, money(p.PenalInterestApplied), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[5], 6, money(p.PrincipalApplied), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[6], 6, money(p.RunningBalance), "1", 1, "R", false, 0, "")
		totalPaid += p.Amount
	}
	pdf.SetFont("Arial", "B", 8)
	pdf.CellFormat(widths[0]+widths[1], 6, "Total Paid", "1", 0, "L", false, 0, "")
	pdf.CellFormat(widths[2], 6, money(totalPaid), "1", 0, "R", false, 0, "")
	pdf.CellFormat(widths[3]+widths[4]+widths[5]+widths[6], 6, "", "1", 1, "R", false, 0, "")
}

func writeBalanceSummary(pdf *gofpdf.Fpdf, l *models.Loan) {
	sectionTitle(pdf, "Balance as of "+time.Now().Format("02-Jan-2006"))
	kv(pdf, "Principal Sanctioned", money(l.PrincipalAmount))
	kv(pdf, "Principal Outstanding", money(l.OutstandingAmount))
	kv(pdf, "Interest Accrued", money(l.AccruedInterest))
	kv(pdf, "Interest Paid", money(l.InterestPaid))
	kv(pdf, "Interest Outstanding", money(l.OutstandingInterest))
	if l.AccruedPenalInterest > 0 || l.OutstandingPenalInterest > 0 {
		kv(pdf, "Penal Interest Accrued", money(l.AccruedPenalInterest))
		kv(pdf, "Penal Interest Outstanding", money(l.OutstandingPenalInterest))
	}
	if l.OutstandingProcessingFee > 0 {
		kv(pdf, "Processing Fee Outstanding", money(l.OutstandingProcessingFee))
	}
	pdf.Ln(2)
	pdf.SetFont("Arial", "B", 11)
	pdf.SetFillColor(240, 236, 220)
	pdf.CellFormat(60, 8, "  Total Outstanding", "1", 0, "L", true, 0, "")
	pdf.CellFormat(50, 8, money(l.TotalOutstandingBalance), "1", 1, "R", true, 0, "")
	if l.SettlementAmount > 0 {
		pdf.SetFont("Arial", "B", 10)
		pdf.CellFormat(60, 7, "  Settlement Amount Today", "1", 0, "L", false, 0, "")
		pdf.CellFormat(50, 7, money(l.SettlementAmount), "1", 1, "R", false, 0, "")
	}
}

func writeStatementFooter(pdf *gofpdf.Fpdf) {
	pdf.Ln(6)
	pdf.SetFont("Arial", "I", 8)
	pdf.SetTextColor(110, 110, 110)
	pdf.MultiCell(0, 4,
		"This is a computer-generated statement and does not require a signature. "+
			"Interest is accrued up to the generation date shown above and will continue to "+
			"accrue until the loan is settled. For any discrepancy, please contact your branch.",
		"", "L", false)
	pdf.SetTextColor(0, 0, 0)
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	if max <= 1 {
		return s[:max]
	}
	return s[:max-1] + "."
}

func lenderProfile(ctx context.Context) (legalName, addressLine, kmlRegNo, policy string) {
	legalName, addressLine, kmlRegNo, policy, _ = lenderProfileFull(ctx)
	return legalName, addressLine, kmlRegNo, policy
}

func documentBranchName(ctx context.Context, name string) string {
	if singleBranch(ctx) {
		return ""
	}
	return dash(name)
}

func bondPlace(single bool, branchName, addressLine string) string {
	if single && addressLine != "" {
		return addressLine
	}
	return branchName
}

func singleBranch(ctx context.Context) bool {
	_, _, _, _, single := lenderProfileFull(ctx)
	return single
}

func lenderProfileFull(ctx context.Context) (legalName, addressLine, kmlRegNo, policy string, singleBranch bool) {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return "", "", "", "", false
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return "", "", "", "", false
	}
	return t.LegalName, t.AddressLine, t.KMLRegNo, commonModels.PolicyOrDefault(t.Policy), t.SingleBranch
}

func tenantAllowsLanguage(ctx context.Context, lang string) bool {
	if lang == BondLangEnglish {
		return true
	}
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return false
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return false
	}
	return common.TenantHasLanguage(t, lang)
}

func lenderIdentity(ctx context.Context) (age, pan, aadhaar string) {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return "", "", ""
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return "", "", ""
	}
	return t.LenderAge, t.LenderPAN, t.LenderAadhaar
}

func GetLoanStatement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	data, filename, err := loanStatement(ctx, loanID, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	return c.Blob(http.StatusOK, "application/pdf", data)
}
