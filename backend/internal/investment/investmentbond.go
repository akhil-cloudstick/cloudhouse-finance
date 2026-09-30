package investment

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"

	"cloudhouse/backend/internal/platform"
)

// templatesDir/mustLoadTemplate mirror loan/indemnitybond.go's identical
// helpers exactly (same rationale: plain .html files under backend/
// templates/, not compiled into the binary) — kept as this package's own
// copy rather than exported from loan, since investment doesn't otherwise
// depend on loan and a one-off shared helper isn't worth the coupling.
const templatesDir = "./templates"

// findTemplatesDir mirrors loan/indemnitybond.go's: walks up from the working
// directory so `go test` (whose working directory is the package, not
// backend/) finds backend/templates instead of panicking at init.
func findTemplatesDir() string {
	if _, err := os.Stat(templatesDir); err == nil {
		return templatesDir
	}
	dir, err := os.Getwd()
	if err != nil {
		return templatesDir
	}
	for {
		candidate := filepath.Join(dir, "templates")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return templatesDir
		}
		dir = parent
	}
}

func mustLoadTemplate(templateName, fileName string) *template.Template {
	b, err := os.ReadFile(filepath.Join(findTemplatesDir(), fileName))
	if err != nil {
		panic(fmt.Sprintf("debenture subscription agreement: read template %s: %v", fileName, err))
	}
	return template.Must(template.New(templateName).Parse(string(b)))
}

// bondTemplate is the Debenture Subscription Agreement generated for a
// Bond-type investment (InvestmentPlan.ProductType == ProductTypeBond) —
// see model_plan.go's ProductType* doc comment for why this is a
// document-generation-only distinction, not a separate financial engine.
// Loaded from backend/templates/debenture-subscription-agreement.html.
var bondTemplate = mustLoadTemplate("investment_bond", "debenture-subscription-agreement.html")

// bondStyle mirrors loan/releaseagreement.go's releaseAgreementStyle — same
// plain-document CSS (a signature-line table, a data table, no letterhead
// graphics), reused here as its own copy rather than exported cross-package.
const bondStyle = `
body{font-family:'Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.55;font-size:13.5px;padding:0 20px}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:0.5px}
h3{font-size:14px;margin:20px 0 8px}
table{width:100%;border-collapse:collapse;margin:10px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
td.num,th.num{text-align:right}
.sig-row{display:flex;justify-content:space-between;margin-top:40px;gap:40px}
.sig-row>div{flex:1;text-align:center;font-size:12px}
.sig-line{display:block;border-bottom:1px solid #333;height:34px}
`

// InvestmentBondData carries everything the Debenture Subscription
// Agreement template needs, resolved from a Bond-type Investment + its
// preloaded Customer/Plan (see Service.investmentBondDataFor).
type InvestmentBondData struct {
	InvestmentNumber string
	CustomerName     string
	CustomerAddress  string
	PrincipalAmount  float64
	InterestRatePercent float64
	InterestRateType    string // "Simple" | "Compound"
	PayoutFrequency     string
	TenureMonths        int
	MaturityDate        time.Time
	AgreementDate       time.Time

	// LegalName/AddressLine are the issuer's own particulars, taken from
	// the business's tenant profile — same convention as loan.BondData's
	// identical fields (see loan.Service.lenderProfile). Empty falls back
	// to a neutral placeholder rather than another business's name.
	LegalName   string
	AddressLine string
}

// investmentBondTemplateData wraps InvestmentBondData with pre-formatted
// display fields — same convention as loan's bondTemplateData/
// releaseAgreementTemplateData.
type investmentBondTemplateData struct {
	InvestmentNumber    string
	CustomerName        string
	CustomerAddress     string
	LenderName          string
	LenderAddress       string
	IssuerCity          string
	AgreementDate       string
	FaceValuePerUnit    string
	PrincipalAmount     string
	UnitsAllocated      string
	InterestRateDisplay string
	PayoutFrequency     string
	TenureDisplay       string
	MaturityDate        string
	ProjectedReturn     string
	GeneratedOn         string
}

// bondFmtAmount/bondFmtDate mirror loan/releaseagreement.go's
// releaseFmtAmount/releaseFmtDate (own copy, same rationale as bondStyle
// above).
func bondFmtAmount(n float64) string {
	return fmt.Sprintf("₹%s", formatThousands(n))
}

func formatThousands(n float64) string {
	s := fmt.Sprintf("%.2f", n)
	parts := strings.SplitN(s, ".", 2)
	intPart := parts[0]
	neg := strings.HasPrefix(intPart, "-")
	if neg {
		intPart = intPart[1:]
	}
	// Indian digit grouping (last 3 digits, then groups of 2) — matches
	// fmt() elsewhere in this codebase's "en-IN" convention.
	var grouped string
	if len(intPart) > 3 {
		last3 := intPart[len(intPart)-3:]
		rest := intPart[:len(intPart)-3]
		for len(rest) > 2 {
			grouped = "," + rest[len(rest)-2:] + grouped
			rest = rest[:len(rest)-2]
		}
		grouped = rest + grouped + "," + last3
	} else {
		grouped = intPart
	}
	if neg {
		grouped = "-" + grouped
	}
	return grouped + "." + parts[1]
}

func bondFmtDate(t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	return t.Format("02 January 2006")
}

// renderInvestmentBondHTML executes the Debenture Subscription Agreement
// template against data — mirrors loan/partialreleasereceipt.go's
// renderPartialReleaseReceiptHTML structure (English-only, no language
// variants, since this is a reference/internal document, not a statutory
// multi-language form).
func renderInvestmentBondHTML(data InvestmentBondData) (string, error) {
	rateDisplay := fmt.Sprintf("%.2f%% p.a. (%s)", data.InterestRatePercent, data.InterestRateType)
	tenureDisplay := fmt.Sprintf("%d Months", data.TenureMonths)
	if data.TenureMonths%12 == 0 {
		years := data.TenureMonths / 12
		unit := "Year"
		if years != 1 {
			unit = "Years"
		}
		tenureDisplay = fmt.Sprintf("%d Months (%d %s)", data.TenureMonths, years, unit)
	}

	// Projected return over the full tenure — simple approximation (rate ×
	// years × principal for Simple; compounded annually for Compound),
	// shown as a reference figure only. The authoritative payout schedule
	// remains the investment's own Schedule/accrual records — this document
	// never drives payment.
	years := float64(data.TenureMonths) / 12
	var projected float64
	if data.InterestRateType == InterestRateTypeCompound {
		projected = data.PrincipalAmount*mathPow(1+data.InterestRatePercent/100, years) - data.PrincipalAmount
	} else {
		projected = data.PrincipalAmount * (data.InterestRatePercent / 100) * years
	}

	legalName := firstNonEmptyStr(data.LegalName, "the Company")
	td := investmentBondTemplateData{
		InvestmentNumber:    data.InvestmentNumber,
		CustomerName:        orBlankStr(data.CustomerName),
		CustomerAddress:     orBlankStr(data.CustomerAddress),
		LenderName:          legalName,
		LenderAddress:       firstNonEmptyStr(data.AddressLine, "its registered office"),
		IssuerCity:          "Kochi, Kerala",
		AgreementDate:       bondFmtDate(data.AgreementDate),
		FaceValuePerUnit:    bondFmtAmount(1000),
		PrincipalAmount:     bondFmtAmount(data.PrincipalAmount),
		UnitsAllocated:      "",
		InterestRateDisplay: rateDisplay,
		PayoutFrequency:     data.PayoutFrequency,
		TenureDisplay:       tenureDisplay,
		MaturityDate:        bondFmtDate(data.MaturityDate),
		ProjectedReturn:     bondFmtAmount(projected),
		GeneratedOn:         bondFmtDate(time.Now()),
	}

	var sb strings.Builder
	if err := bondTemplate.Execute(&sb, struct {
		investmentBondTemplateData
		Style template.CSS
	}{td, template.CSS(bondStyle)}); err != nil {
		return "", fmt.Errorf("debenture subscription agreement: render template: %w", err)
	}
	return sb.String(), nil
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func orBlankStr(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func mathPow(base, exp float64) float64 {
	// A tiny local pow so this file doesn't need "math" solely for one
	// call — kept simple (repeated squaring not required at this scale;
	// tenure is at most a handful of years).
	result := 1.0
	whole := int(exp)
	frac := exp - float64(whole)
	for i := 0; i < whole; i++ {
		result *= base
	}
	if frac > 0 {
		// Fractional year (e.g. an 18-month tenure = 1.5 years) — linear
		// interpolation is close enough for a reference/projected figure,
		// not an authoritative payout calculation.
		result *= 1 + frac*(base-1)
	}
	return result
}

// investmentBondHeaderTemplate/investmentBondFooterTemplate mirror loan's
// bondHeaderTemplate/bondFooterTemplate (own copy, same rationale as
// bondStyle above) — empty header, page-number footer.
const investmentBondHeaderTemplate = `
<div style="font-size:9px;width:100%;text-align:center;color:#8a6d1f;font-family:Arial,sans-serif;padding-top:6px">
</div>`

const investmentBondFooterTemplate = `
<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:Arial,sans-serif;padding-bottom:6px">
Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>`

// RenderInvestmentBondPDF renders the Debenture Subscription Agreement into
// a PDF via headless Chromium — same chromedp invocation pattern as
// loan.RenderPartialReleaseReceiptPDF.
func RenderInvestmentBondPDF(data InvestmentBondData) ([]byte, error) {
	htmlStr, err := renderInvestmentBondHTML(data)
	if err != nil {
		return nil, err
	}

	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	encoded := base64.StdEncoding.EncodeToString([]byte(htmlStr))
	var pdfBytes []byte
	err = chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8;base64,"+encoded),
		chromedp.WaitReady("body"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(true).
				WithMarginTop(0.7).
				WithMarginBottom(0.7).
				WithMarginLeft(0.6).
				WithMarginRight(0.6).
				WithDisplayHeaderFooter(true).
				WithHeaderTemplate(investmentBondHeaderTemplate).
				WithFooterTemplate(investmentBondFooterTemplate).
				Do(ctx)
			if err != nil {
				return err
			}
			pdfBytes = buf
			return nil
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("debenture subscription agreement: render PDF (is Chrome/Chromium installed and on PATH?): %w", err)
	}
	return pdfBytes, nil
}

// investmentBondDataFor builds RenderInvestmentBondPDF's input from a
// Bond-type Investment (Plan.ProductType == ProductTypeBond) and its
// preloaded Customer — mirrors loan.Service's bondDataForLoan/
// partialReleaseReceiptDataForRequest structure.
func (s *Service) investmentBondDataFor(ctx context.Context, inv *Investment) InvestmentBondData {
	legalName, addressLine := "", ""
	if s.tenantRepo != nil {
		if id, ok := platform.TenantFromContext(ctx); ok {
			if t, err := s.tenantRepo.FindByID(ctx, id); err == nil {
				legalName, addressLine = t.LegalName, t.AddressLine
			}
		}
	}

	return InvestmentBondData{
		InvestmentNumber:    inv.InvestmentNumber,
		CustomerName:        inv.Customer.Name,
		CustomerAddress:     inv.Customer.Address,
		PrincipalAmount:     inv.PrincipalAmount,
		InterestRatePercent: inv.InterestRatePercent,
		InterestRateType:    inv.InterestRateType,
		PayoutFrequency:     inv.PayoutFrequency,
		TenureMonths:        inv.TenureMonths,
		MaturityDate:        inv.MaturityDate,
		AgreementDate:       inv.StartDate,
		LegalName:           legalName,
		AddressLine:         addressLine,
	}
}

// RenderInvestmentBondPDFForInvestment renders the Debenture Subscription
// Agreement PDF for a given investment — the server-side handler for
// GET /investments/:id/bond/pdf. Available for every investment regardless
// of ProductType — the agreement is now the standard document for all
// plans, not just Bond-labeled ones.
func (s *Service) RenderInvestmentBondPDFForInvestment(ctx context.Context, investmentID uint, branchID *uint) ([]byte, string, error) {
	inv, err := s.repo.FindByID(ctx, investmentID, branchID)
	if err != nil {
		return nil, "", ErrInvestmentNotFound
	}

	data := s.investmentBondDataFor(ctx, inv)
	pdfBytes, err := RenderInvestmentBondPDF(data)
	if err != nil {
		return nil, "", err
	}

	filename := fmt.Sprintf("Debenture-Subscription-Agreement-%s.pdf", inv.InvestmentNumber)
	return pdfBytes, filename, nil
}
