package loan

import (
	"ambikagold/backend/internal/platform"
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jung-kurt/gofpdf"
)

// Statement renders a customer-facing account statement for one loan: what
// was pledged, what has been paid, and what is still owed.
//
// This is the document a borrower asks for at the counter — "what do I owe,
// and what have I paid?" — so it is written to be read by someone who does
// not use the software. Every figure on it comes from the same enriched loan
// the app itself displays (Service.Get, which accrues interest to today
// before returning), so the statement can never disagree with the screen it
// was printed from.
//
// The business name in the header is the tenant's own, not a hardcoded one.
// A statement handed to a customer with another business's name on it is the
// most visible possible version of that mistake.
func (s *Service) Statement(ctx context.Context, loanID uint, branchID *uint) (data []byte, filename string, err error) {
	l, err := s.Get(ctx, loanID, branchID)
	if err != nil {
		return nil, "", err
	}

	businessName := s.businessName(ctx)

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

// businessName resolves the tenant's display name for the statement header,
// falling back to a neutral label rather than another business's name if the
// lookup fails for any reason.
func (s *Service) businessName(ctx context.Context) string {
	if s.tenantRepo == nil {
		return "Gold Loan Statement"
	}
	id, ok := platform.TenantFromContext(ctx)
	if !ok {
		return "Gold Loan Statement"
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil || t.Name == "" {
		return "Gold Loan Statement"
	}
	return t.Name
}

// brandedMessage is fmt.Sprintf with one extra step: every literal
// occurrence of "Ambika Gold Finance" in the resulting string is replaced
// with the caller's own tenant name.
//
// Multi-tenancy plan, Step 9. Before this, every SMS/WhatsApp notification
// sent to a borrower — due/overdue reminders, sanction/disbursement,
// payment receipts, auction notices, release and extension decisions —
// named "Ambika Gold Finance" regardless of which business's borrower was
// reading it, the most visible possible version of a tenancy mistake.
// businessName's own fallback (a neutral, non-branded label on any lookup
// failure) applies here too, since this calls it directly — a failed tenant
// lookup never leaks another business's name, it just goes unbranded.
//
// A find-and-replace on the rendered string, not a %s placeholder threaded
// through 26 format strings across 3 files: every call site becomes a
// one-word change (fmt.Sprintf -> s.brandedMessage, ctx as the first arg),
// and the message text itself — the part someone actually has to read for
// correctness — is untouched.
func (s *Service) brandedMessage(ctx context.Context, format string, args ...any) string {
	msg := fmt.Sprintf(format, args...)
	return strings.ReplaceAll(msg, "Ambika Gold Finance", s.businessName(ctx))
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

func writeStatementHeader(pdf *gofpdf.Fpdf, business string, l *Loan) {
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

// kv writes a two-column label/value row, used for the summary blocks.
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

func writeLoanSummary(pdf *gofpdf.Fpdf, l *Loan) {
	sectionTitle(pdf, "Loan Details")

	status := l.Status
	// The stored status does not carry the accrual flags the app shows, so a
	// loan reading "Active" on paper while the branch calls it overdue would
	// be confusing at the counter. Say both.
	if l.IsOverdue && !strings.EqualFold(status, StatusOverdue) {
		status = fmt.Sprintf("%s (overdue by %d days)", status, l.DaysOverdue)
	}

	kv(pdf, "Loan Number", l.LoanNumber)
	kv(pdf, "Status", status)
	kv(pdf, "Customer", fmt.Sprintf("%s (%s)", l.Customer.Name, l.Customer.Code))
	kv(pdf, "Phone", l.Customer.Phone)
	kv(pdf, "Scheme", l.Scheme.Name)
	kv(pdf, "Interest Rate", fmt.Sprintf("%.2f%% p.a.", l.Scheme.InterestRate))
	kv(pdf, "Opened On", dateOnly(l.OpenedDate))
	kv(pdf, "Due On", dateOnly(l.DueDate))
}

func writeOrnaments(pdf *gofpdf.Fpdf, l *Loan) {
	sectionTitle(pdf, "Pledged Ornaments")

	if len(l.Ornaments) == 0 {
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
	for _, o := range l.Ornaments {
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

func writePayments(pdf *gofpdf.Fpdf, l *Loan) {
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
		// Page breaks are checked per row rather than pre-computed: a loan
		// with a long repayment history is exactly the one most likely to be
		// asked for on paper.
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

func writeBalanceSummary(pdf *gofpdf.Fpdf, l *Loan) {
	sectionTitle(pdf, "Balance as of "+time.Now().Format("02-Jan-2006"))

	kv(pdf, "Principal Sanctioned", money(l.PrincipalAmount))
	kv(pdf, "Principal Outstanding", money(l.OutstandingAmount))
	kv(pdf, "Interest Accrued", money(l.AccruedInterest))
	kv(pdf, "Interest Paid", money(l.InterestPaid))
	kv(pdf, "Interest Outstanding", money(l.OutstandingInterest))

	// Penal interest is shown only when it exists. A line reading "0.00"
	// against a penalty invites a question at the counter that has no answer.
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

	// SettlementAmount is what the customer must actually hand over to close
	// the loan today, which is the number they came in to ask for. Shown
	// separately from the running balance so the two are never confused.
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
