package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Investment/models"
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
)

const templatesDir = "./templates"

var bondTemplate = mustLoadTemplate("investment_bond", "debenture_subscription_agreement.html")

type InvestmentBondData struct {
	InvestmentNumber    string
	CustomerName        string
	CustomerAddress     string
	PrincipalAmount     float64
	InterestRatePercent float64
	InterestRateType    string
	PayoutFrequency     string
	TenureMonths        int
	MaturityDate        time.Time
	AgreementDate       time.Time
	LegalName           string
	AddressLine         string
	LenderSignature     template.HTML
}

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
	LenderSignature     template.HTML
}

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
	years := float64(data.TenureMonths) / 12
	var projected float64
	if data.InterestRateType == models.InterestRateTypeCompound {
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
		LenderSignature:     data.LenderSignature,
	}
	var sb strings.Builder
	if err := bondTemplate.Execute(&sb, struct {
		investmentBondTemplateData
		Style template.CSS
	}{td, template.CSS(`
body{font-family:'Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0;line-height:1.55;font-size:13.5px;padding:0}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:0.5px}
h3{font-size:14px;margin:20px 0 8px}
table{width:100%;border-collapse:collapse;margin:10px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
td.num,th.num{text-align:right}
.sig-row{display:flex;justify-content:space-between;margin-top:40px;gap:40px}
.sig-row>div{flex:1;text-align:center;font-size:12px}
.sig-line{display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid #333;height:48px}
.sig-line .sig-img{max-height:44px;max-width:170px;display:block}
`)}); err != nil {
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
	result := 1.0
	whole := int(exp)
	frac := exp - float64(whole)
	for i := 0; i < whole; i++ {
		result *= base
	}
	if frac > 0 {
		result *= 1 + frac*(base-1)
	}
	return result
}

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
				WithPreferCSSPageSize(false).
				WithPaperWidth(8.27).
				WithPaperHeight(11.69).
				WithMarginTop(0.75).
				WithMarginBottom(0.55).
				WithMarginLeft(0.6).
				WithMarginRight(0.6).
				WithDisplayHeaderFooter(true).
				WithHeaderTemplate(`
<div style="font-size:9px;width:100%;text-align:center;color:#8a6d1f;font-family:Arial,sans-serif;padding-top:6px">
</div>`).
				WithFooterTemplate(`
<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:Arial,sans-serif;padding-bottom:6px">
Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>`).
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

func investmentBondDataFor(ctx context.Context, inv *models.Investment) InvestmentBondData {
	legalName, addressLine := "", ""
	var signature template.HTML
	if id, ok := config.TenantFromContext(ctx); ok {
		if t, err := common.FindTenantByID(ctx, id); err == nil {
			legalName, addressLine = t.LegalName, t.AddressLine
			signature = common.TenantSignatureImgHTML(t, config.Env.UploadsDir)
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
		LenderSignature:     signature,
	}
}

func renderInvestmentBondPDFForInvestment(ctx context.Context, investmentID uint, branchID *uint) ([]byte, string, error) {
	inv, err := findInvestmentByID(ctx, investmentID, branchID)
	if err != nil {
		return nil, "", common.NewNotFound("investment not found")
	}
	data := investmentBondDataFor(ctx, inv)
	pdfBytes, err := RenderInvestmentBondPDF(data)
	if err != nil {
		return nil, "", err
	}
	filename := fmt.Sprintf("Debenture-Subscription-Agreement-%s.pdf", inv.InvestmentNumber)
	return pdfBytes, filename, nil
}
