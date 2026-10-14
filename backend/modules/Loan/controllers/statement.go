package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"html/template"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

var statementTemplate = mustLoadTemplate("statement", "statement.html", nil)

type statementOrnament struct {
	Name, Purity, Gross, Net, Value string
	Qty                             int
}

type statementPayment struct{ Date, Type, Amount, Interest, Penal, Principal, Balance string }

type statementLine struct{ Label, Value string }

type statementTemplateData struct {
	Brand                                                          template.CSS
	Business, Branch, Generated                                    string
	LoanNumber, Status, Customer, Phone, Scheme, Rate, Opened, Due string
	Ornaments                                                      []statementOrnament
	TotalGross, TotalNet, TotalValue                               string
	Payments                                                       []statementPayment
	TotalPaid                                                      string
	BalanceDate                                                    string
	Balance                                                        []statementLine
	TotalOutstanding, Settlement                                   string
}

func statementData(ctx context.Context, l *models.Loan) statementTemplateData {
	status := l.Status
	if l.IsOverdue && !strings.EqualFold(status, models.StatusOverdue) {
		status = fmt.Sprintf("%s (overdue by %d days)", status, l.DaysOverdue)
	}
	brand := ""
	if t := tenantForContext(ctx); t != nil {
		brand = t.BrandColor
	}
	d := statementTemplateData{
		Brand: brandColor(brand), Business: businessName(ctx), Generated: time.Now().Format("02-Jan-2006 15:04"),
		LoanNumber: l.LoanNumber, Status: status,
		Customer: fmt.Sprintf("%s (%s)", l.Customer.Name, l.Customer.Code), Phone: dash(l.Customer.Phone), Scheme: l.Scheme.Name,
		Rate: fmt.Sprintf("%.2f%% p.a.", l.SchemeInterestRate), Opened: dateOnly(l.OpenedDate), Due: dateOnly(l.DueDate),
		BalanceDate: time.Now().Format("02-Jan-2006"),
	}
	if !singleBranch(ctx) {
		d.Branch = l.Branch.Name
	}
	var gross, net, value float64
	for _, o := range l.Ornaments {
		if o.ReleasedAt != nil {
			continue
		}
		d.Ornaments = append(d.Ornaments, statementOrnament{
			Name: o.Name, Purity: o.Purity, Gross: money(o.GrossWeight), Net: money(o.NetWeight), Qty: o.Quantity, Value: money(o.GoldValue),
		})
		gross += o.GrossWeight
		net += o.NetWeight
		value += o.GoldValue
	}
	d.TotalGross, d.TotalNet, d.TotalValue = money(gross), money(net), money(value)
	var paid float64
	for _, p := range l.Payments {
		d.Payments = append(d.Payments, statementPayment{
			Date: dateOnly(p.PaidOn), Type: p.Type, Amount: money(p.Amount), Interest: money(p.InterestApplied),
			Penal: money(p.PenalInterestApplied), Principal: money(p.PrincipalApplied), Balance: money(p.RunningBalance),
		})
		paid += p.Amount
	}
	d.TotalPaid = money(paid)
	d.Balance = []statementLine{
		{"Principal Sanctioned", money(l.PrincipalAmount)},
		{"Principal Outstanding", money(l.OutstandingAmount)},
		{"Interest Accrued", money(l.AccruedInterest)},
		{"Interest Paid", money(l.InterestPaid)},
		{"Interest Outstanding", money(l.OutstandingInterest)},
	}
	if l.AccruedPenalInterest > 0 || l.OutstandingPenalInterest > 0 {
		d.Balance = append(d.Balance,
			statementLine{"Penal Interest Accrued", money(l.AccruedPenalInterest)},
			statementLine{"Penal Interest Outstanding", money(l.OutstandingPenalInterest)})
	}
	if l.OutstandingProcessingFee > 0 {
		d.Balance = append(d.Balance, statementLine{"Processing Fee Outstanding", money(l.OutstandingProcessingFee)})
	}
	d.TotalOutstanding = money(l.TotalOutstandingBalance)
	if l.SettlementAmount > 0 {
		d.Settlement = money(l.SettlementAmount)
	}
	return d
}

func loanStatement(ctx context.Context, loanID uint, branchID *uint, format string) (body []byte, contentType, filename string, err error) {
	l, err := GetLoan(ctx, loanID, branchID)
	if err != nil {
		return nil, "", "", err
	}
	var sb strings.Builder
	if err := statementTemplate.Execute(&sb, statementData(ctx, l)); err != nil {
		return nil, "", "", fmt.Errorf("loan statement: render template: %w", err)
	}
	if format == "html" {
		return []byte(sb.String()), "text/html; charset=utf-8", "", nil
	}
	pdfBytes, err := renderA4PDF(sb.String(), "loan statement")
	if err != nil {
		return nil, "", "", err
	}
	return pdfBytes, "application/pdf", fmt.Sprintf("statement-%s.pdf", l.LoanNumber), nil
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
	return t.LegalName, common.NormalizeLineBreaks(t.AddressLine), t.KMLRegNo, commonModels.PolicyOrDefault(t.Policy), t.SingleBranch
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
	data, contentType, filename, err := loanStatement(ctx, loanID, auth.GetBranchScope(c), c.QueryParam("format"))
	if err != nil {
		return common.FailErr(c, err)
	}
	if filename != "" {
		c.Response().Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	}
	return c.Blob(http.StatusOK, contentType, data)
}
