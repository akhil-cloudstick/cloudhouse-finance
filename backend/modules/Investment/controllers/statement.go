package controllers

import (
	"bytes"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Investment/models"
	"context"
	"fmt"
	"time"

	"github.com/jung-kurt/gofpdf"
)

func investmentStatement(ctx context.Context, investmentID uint, branchID *uint) (data []byte, filename string, err error) {
	inv, err := getInvestment(ctx, investmentID, branchID)
	if err != nil {
		return nil, "", err
	}
	businessName := businessName(ctx)
	if singleBranch(ctx) {
		inv.Branch.Name = ""
	}
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetTitle(fmt.Sprintf("Investment Statement %s", inv.InvestmentNumber), true)
	pdf.AddPage()
	writeInvestmentStatementHeader(pdf, businessName, inv)
	writeInvestmentSummary(pdf, inv)
	const allRows = 100000
	if inv.Engine == models.EngineLive {
		txs, err := findTransactions(ctx, investmentID, allRows, 0)
		if err != nil {
			return nil, "", err
		}
		writeInvestmentTransactions(pdf, txs)
	} else {
		payouts, err := findPayouts(ctx, investmentID, allRows, 0)
		if err != nil {
			return nil, "", err
		}
		writeInvestmentPayouts(pdf, payouts)
	}
	writeInvestmentBalanceSummary(pdf, inv)
	writeStatementFooter(pdf)
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), fmt.Sprintf("statement-%s.pdf", inv.InvestmentNumber), nil
}

func writeInvestmentStatementHeader(pdf *gofpdf.Fpdf, business string, inv *models.Investment) {
	pdf.SetFont("Arial", "B", 16)
	pdf.CellFormat(0, 9, business, "", 1, "C", false, 0, "")
	pdf.SetFont("Arial", "B", 12)
	pdf.CellFormat(0, 7, "Investment Statement", "", 1, "C", false, 0, "")
	pdf.SetFont("Arial", "", 9)
	pdf.CellFormat(0, 5, "Generated "+time.Now().Format("02-Jan-2006 15:04"), "", 1, "C", false, 0, "")
	if inv.Branch.Name != "" {
		pdf.CellFormat(0, 5, "Branch: "+inv.Branch.Name, "", 1, "C", false, 0, "")
	}
	pdf.Ln(3)
}

func writeInvestmentSummary(pdf *gofpdf.Fpdf, inv *models.Investment) {
	sectionTitle(pdf, "Investment Details")
	kv(pdf, "Investment Number", inv.InvestmentNumber)
	kv(pdf, "Status", inv.Status)
	kv(pdf, "Customer", fmt.Sprintf("%s (%s)", inv.Customer.Name, inv.Customer.Code))
	kv(pdf, "Phone", inv.Customer.Phone)
	kv(pdf, "Plan", inv.Plan.Name)
	rateBasis := "p.a."
	if inv.InterestRateType == models.InterestRateTypeSimple {
		rateBasis = "p.a. simple"
	} else {
		rateBasis = "p.a. compound"
	}
	kv(pdf, "Interest Rate", fmt.Sprintf("%.2f%% %s", inv.InterestRatePercent, rateBasis))
	kv(pdf, "Payout Frequency", inv.PayoutFrequency)
	kv(pdf, "Started On", dateOnlyInv(inv.StartDate))
	kv(pdf, "Maturity Date", dateOnlyInv(inv.MaturityDate))
}

func writeInvestmentTransactions(pdf *gofpdf.Fpdf, txs []models.InvestmentTransaction) {
	sectionTitle(pdf, "Transactions")
	if len(txs) == 0 {
		pdf.SetFont("Arial", "I", 9)
		pdf.CellFormat(0, 6, "No transactions recorded against this investment yet.", "", 1, "L", false, 0, "")
		return
	}
	headers := []string{"Date", "Type", "Amount", "Principal", "Interest", "Principal After", "Interest After"}
	widths := []float64{22, 24, 22, 22, 22, 30, 28}
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
	for i := len(txs) - 1; i >= 0; i-- {
		t := txs[i]
		if pdf.GetY() > 250 {
			pdf.AddPage()
		}
		pdf.CellFormat(widths[0], 6, dateOnlyInv(t.OccurredOn), "1", 0, "L", false, 0, "")
		pdf.CellFormat(widths[1], 6, t.Type, "1", 0, "L", false, 0, "")
		pdf.CellFormat(widths[2], 6, money(t.Amount), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[3], 6, money(t.PrincipalAmount), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[4], 6, money(t.InterestAmount), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[5], 6, money(t.PrincipalAfter), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[6], 6, money(t.InterestAfter), "1", 1, "R", false, 0, "")
	}
}

func writeInvestmentPayouts(pdf *gofpdf.Fpdf, payouts []models.InvestmentPayout) {
	sectionTitle(pdf, "Payout Schedule")
	if len(payouts) == 0 {
		pdf.SetFont("Arial", "I", 9)
		pdf.CellFormat(0, 6, "No payouts scheduled against this investment.", "", 1, "L", false, 0, "")
		return
	}
	headers := []string{"Due Date", "Amount", "Status", "Paid On"}
	widths := []float64{30, 30, 30, 30}
	pdf.SetFont("Arial", "B", 9)
	pdf.SetFillColor(248, 245, 235)
	for i, h := range headers {
		align := "L"
		if i == 1 {
			align = "R"
		}
		pdf.CellFormat(widths[i], 7, h, "1", 0, align, true, 0, "")
	}
	pdf.Ln(-1)
	pdf.SetFont("Arial", "", 9)
	for _, p := range payouts {
		if pdf.GetY() > 250 {
			pdf.AddPage()
		}
		label := "Interest"
		if p.IsPrincipalReturn {
			label = "Interest + Principal"
		}
		paidOn := "-"
		if p.PaidAt != nil {
			paidOn = dateOnlyInv(*p.PaidAt)
		}
		pdf.CellFormat(widths[0], 6, dateOnlyInv(p.DueDate), "1", 0, "L", false, 0, "")
		pdf.CellFormat(widths[1], 6, money(p.Amount), "1", 0, "R", false, 0, "")
		pdf.CellFormat(widths[2], 6, fmt.Sprintf("%s (%s)", p.Status, label), "1", 0, "L", false, 0, "")
		pdf.CellFormat(widths[3], 6, paidOn, "1", 1, "L", false, 0, "")
	}
}

func writeInvestmentBalanceSummary(pdf *gofpdf.Fpdf, inv *models.Investment) {
	sectionTitle(pdf, "Balance as of "+time.Now().Format("02-Jan-2006"))
	kv(pdf, "Principal Amount", money(inv.PrincipalAmount))
	if inv.Engine == models.EngineLive {
		kv(pdf, "Outstanding Principal", money(inv.OutstandingPrincipal))
		kv(pdf, "Interest Accrued", money(inv.AccruedInterest))
		kv(pdf, "Interest Withdrawn", money(inv.InterestWithdrawn))
		kv(pdf, "Outstanding Interest", money(inv.OutstandingInterest))
	} else {
		kv(pdf, "Total Interest Paid", money(inv.TotalInterestPaid))
	}
}

func dateOnlyInv(t time.Time) string {
	if t.IsZero() {
		return "-"
	}
	return t.Format("02-Jan-2006")
}

func businessName(ctx context.Context) string {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return "Investment Statement"
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil || t.Name == "" {
		return "Investment Statement"
	}
	return t.Name
}

func singleBranch(ctx context.Context) bool {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return false
	}
	t, err := common.FindTenantByID(ctx, id)
	return err == nil && t.SingleBranch
}

func money(v float64) string {
	return fmt.Sprintf("%.2f", v)
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

func writeStatementFooter(pdf *gofpdf.Fpdf) {
	pdf.Ln(6)
	pdf.SetFont("Arial", "I", 8)
	pdf.SetTextColor(110, 110, 110)
	pdf.MultiCell(0, 4,
		"This is a computer-generated statement and does not require a signature. "+
			"For any discrepancy, please contact your branch.",
		"", "L", false)
	pdf.SetTextColor(0, 0, 0)
}
