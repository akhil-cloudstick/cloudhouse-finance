package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/PersonalLoan/models"
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

// bondBlank stands in for a missing input: faint dots to fill in by hand after printing.
const bondBlank template.HTML = `<span class="blank">..................</span>`

const templatesDir = "./templates"

const (
	BondLangEnglish   = "en"
	BondLangMalayalam = "ml"
)

var bondTemplates = map[string]*template.Template{
	BondLangEnglish:   mustLoadBondTemplate("personal_loan_bond_english.html"),
	BondLangMalayalam: mustLoadBondTemplate("personal_loan_bond_malayalam.html"),
}

func mustLoadBondTemplate(fileName string) *template.Template {
	return template.Must(func() (*template.Template, error) {
		b, err := os.ReadFile(filepath.Join(findTemplatesDir(), fileName))
		if err != nil {
			return nil, fmt.Errorf("personal loan bond: read template: %w", err)
		}
		return template.New("personal_loan_bond").Parse(string(b))
	}())
}

type BondData struct {
	LoanNumber          string
	BorrowerName        string
	FatherName          string
	Age                 int
	Address             string
	District            string
	Village             string
	Taluk               string
	Place               string
	PinCode             string
	AadhaarNumber       string
	MobileNumber        string
	PrincipalAmount     float64
	InterestRatePercent float64
	Day                 int
	Month               string
	Year                int
}

type bondTemplateData struct {
	BondData
	Style                template.CSS
	Blank                template.HTML
	FinancierName        template.HTML
	EstablishmentAddress template.HTML
	Age                  template.HTML
	Aadhaar              template.HTML
	Address              template.HTML
	District             template.HTML
	Village              template.HTML
	Taluk                template.HTML
	Place                template.HTML
	PinCode              template.HTML
	FatherName           template.HTML
	Mobile               template.HTML
	PrincipalAmount      template.HTML
	InterestRate         template.HTML
	BorrowerName         template.HTML
}

func bondOrBlank(s string) template.HTML {
	if strings.TrimSpace(s) == "" {
		return bondBlank
	}
	return template.HTML(template.HTMLEscapeString(s)) //nolint:gosec // escaped above
}

func bondAgeOrBlank(age int) template.HTML {
	if age <= 0 {
		return bondBlank
	}
	return template.HTML(fmt.Sprintf("%d", age))
}

func bondAadhaarOrBlank(aadhaar string) template.HTML { return bondOrBlank(aadhaar) }

func bondInrOrBlank(amount float64) template.HTML {
	if amount <= 0 {
		return bondBlank
	}
	return template.HTML(fmt.Sprintf("%.0f", amount))
}

func bondRateOrBlank(rate float64) template.HTML {
	if rate <= 0 {
		return bondBlank
	}
	return template.HTML(fmt.Sprintf("%g%%", rate))
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

type bondFinancier struct {
	name, address, regNo string
}

func (f bondFinancier) establishment(lang string) template.HTML {
	var parts []string
	if f.address != "" {
		parts = append(parts, template.HTMLEscapeString(f.address))
	}
	if lang == BondLangEnglish {
		if f.regNo != "" {
			parts = append(parts, "functioning under Registration No. M L L No: "+template.HTMLEscapeString(f.regNo))
		}
		if len(parts) == 0 {
			return ""
		}
		return template.HTML(strings.Join(parts, ", ") + ",") //nolint:gosec // every part is escaped above
	}
	if f.regNo != "" {
		parts = append(parts, "M L L No: "+template.HTMLEscapeString(f.regNo)+" രജിസ്റ്റർ നമ്പറിൽ പ്രവർത്തിച്ചുവരുന്ന")
	}
	return template.HTML(strings.Join(parts, " ")) //nolint:gosec // every part is escaped above
}

func bondFinancierFor(ctx context.Context) bondFinancier {
	if id, ok := config.TenantFromContext(ctx); ok {
		if t, err := common.FindTenantByID(ctx, id); err == nil {
			return bondFinancier{
				name:    firstNonEmpty(t.LegalName, t.Name),
				address: common.NormalizeLineBreaks(t.AddressLine),
				regNo:   t.KMLRegNo,
			}
		}
	}
	return bondFinancier{}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func renderBondHTML(data BondData, financier bondFinancier, lang string) (string, error) {
	td := bondTemplateData{
		BondData: BondData{
			LoanNumber: data.LoanNumber,
			Day:        data.Day,
			Month:      data.Month,
			Year:       data.Year,
		},
		Style: template.CSS(`
body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.7;font-size:14px;padding:0 20px}
h1{font-size:22px;text-align:center;margin:0 0 4px;letter-spacing:1px}
h2{font-size:14px;text-align:center;margin:0 0 22px;font-weight:normal;color:#555}
p{margin:0 0 14px;text-align:justify}
.ennu{margin:36px 0 0;text-align:center}
.blank{color:#b5b5b5;letter-spacing:1px}
.footer-row{margin-top:30px;font-size:13.5px}
.footer-row div{margin-bottom:10px}
.footer-row .r{text-align:right}
.witness{margin-top:36px}
.witness div{margin-bottom:10px}
`),
		Blank:                bondBlank,
		FinancierName:        bondOrBlank(financier.name),
		EstablishmentAddress: financier.establishment(lang),
		Age:                  bondAgeOrBlank(data.Age),
		Aadhaar:              bondAadhaarOrBlank(data.AadhaarNumber),
		Address:              bondOrBlank(data.Address),
		District:             bondOrBlank(data.District),
		Village:              bondOrBlank(data.Village),
		Taluk:                bondOrBlank(data.Taluk),
		Place:                bondOrBlank(data.Place),
		PinCode:              bondOrBlank(data.PinCode),
		FatherName:           bondOrBlank(data.FatherName),
		Mobile:               bondOrBlank(data.MobileNumber),
		PrincipalAmount:      bondInrOrBlank(data.PrincipalAmount),
		InterestRate:         bondRateOrBlank(data.InterestRatePercent),
	}
	td.BorrowerName = bondOrBlank(data.BorrowerName)
	var sb strings.Builder
	if err := bondTemplates[lang].Execute(&sb, td); err != nil {
		return "", fmt.Errorf("personal loan bond: render template: %w", err)
	}
	return sb.String(), nil
}

func GenerateBondPDF(ctx context.Context, loan *models.PersonalLoan, cust *commonModels.Customer, aadhaar, lang string) ([]byte, error) {
	data := bondDataForLoan(loan, cust, aadhaar)
	html, err := renderBondHTML(data, bondFinancierFor(ctx), lang)
	if err != nil {
		return nil, err
	}
	ctx, cancel := chromedp.NewContext(ctx)
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	encoded := base64.StdEncoding.EncodeToString([]byte(html))
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
				WithMarginTop(0.4).
				WithMarginBottom(0.35).
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
		return nil, fmt.Errorf("personal loan bond: render PDF (is Chrome/Chromium installed and on PATH?): %w", err)
	}
	return pdfBytes, nil
}

func bondDataForLoan(loan *models.PersonalLoan, cust *commonModels.Customer, aadhaar string) BondData {
	age := 0
	if cust.Age != nil && *cust.Age > 0 {
		age = *cust.Age
	} else if !cust.DOB.IsZero() {
		age = int(time.Since(cust.DOB).Hours() / 24 / 365.25)
	}
	var ratePercent float64
	if loan.InterestType == models.InterestTypePercentage {
		ratePercent = loan.InterestValue
	}
	signedAt := loan.OpenedDate
	if signedAt.IsZero() {
		signedAt = loan.DisbursedAt
	}
	return BondData{
		LoanNumber:          loan.LoanNumber,
		BorrowerName:        cust.Name,
		FatherName:          cust.FatherName,
		Age:                 age,
		Address:             cust.Address,
		District:            cust.District,
		Village:             cust.Village,
		Taluk:               cust.Taluk,
		Place:               cust.Place,
		PinCode:             cust.PinCode,
		AadhaarNumber:       aadhaar,
		MobileNumber:        cust.Phone,
		PrincipalAmount:     loan.PrincipalAmount,
		InterestRatePercent: ratePercent,
		Day:                 signedAt.Day(),
		Month:               signedAt.Month().String(),
		Year:                signedAt.Year(),
	}
}
