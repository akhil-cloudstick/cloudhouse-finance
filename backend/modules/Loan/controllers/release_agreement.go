package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"html"
	"html/template"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

const releaseBlank = "                "

var releaseMonthsEn = [12]string{"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"}

var releaseMonthsMl = [12]string{
	"ജനുവരി", "ഫെബ്രുവരി", "മാർച്ച്", "ഏപ്രിൽ", "മേയ്", "ജൂൺ",
	"ജൂലൈ", "ഓഗസ്റ്റ്", "സെപ്റ്റംബർ", "ഒക്ടോബർ", "നവംബർ", "ഡിസംബർ",
}

var releaseAgreementDocs = map[string]map[string]*template.Template{
	commonModels.PolicyKML: {
		BondLangEnglish:   mustLoadTemplate("release_agreement_kml_en", "kml_release_agreement_english.html", nil),
		BondLangMalayalam: mustLoadTemplate("release_agreement_kml_ml", "kml_release_agreement_malayalam.html", nil),
	},
}

type ReleaseAgreementOrnament struct {
	Name        string
	Purity      string
	Quantity    int
	GrossWeight float64
	NetWeight   float64
	Value       float64
}

type ReleaseAgreementData struct {
	LoanNumber      string
	BranchName      string
	CustomerName    string
	CustomerAddress string
	CustomerCareOf  string
	BorrowedDate    time.Time
	BorrowedAmount  float64
	ReturnedDate    time.Time
	ReturnedAmount  float64
	TotalInterest   float64
	Ornaments       []ReleaseAgreementOrnament
	LegalName       string
	AddressLine     string
	LenderSignature template.HTML
	KMLRegNo        string
	Policy          string
}

type releaseAgreementTemplateData struct {
	ReleaseAgreementData
	Style           template.CSS
	Blank           string
	LenderName      string
	LenderAddress   string
	LenderPhone     string
	LenderEmail     string
	LenderKMLRegNo  string
	CustomerLine    template.HTML
	BorrowedDate    string
	BorrowedAmount  string
	ReturnedDate    string
	ReturnedAmount  string
	TotalInterest   string
	AmountWordsLine string
	Ornaments       []releaseOrnamentTemplateData
}

type releaseOrnamentTemplateData struct {
	Name        string
	Quantity    int
	GrossWeight float64
	NetWeight   float64
	FineWeight  float64
	Value       string
}

func releaseFmtDate(t time.Time, lang string) string {
	if t.IsZero() {
		return releaseBlank
	}
	months := releaseMonthsEn
	if lang == BondLangMalayalam {
		months = releaseMonthsMl
	}
	return fmt.Sprintf("%02d %s %d", t.Day(), months[int(t.Month())-1], t.Year())
}

func releaseFmtAmount(n float64) string {
	if n <= 0 {
		return releaseBlank
	}
	return platformFormatEnIN(n)
}

func releaseFineWeight(netWeight float64, purity string) float64 {
	karat, fineness, err := ParsePurity(purity)
	if err != nil {
		return netWeight
	}
	if karat != nil {
		return netWeight * float64(*karat) / 24
	}
	if fineness != nil {
		return netWeight * *fineness / 100
	}
	return netWeight
}

func releaseAgreementDocFor(policy, lang string) *template.Template {
	family, ok := releaseAgreementDocs[commonModels.PolicyOrDefault(policy)]
	if ok {
		if tmpl, ok := family[lang]; ok {
			return tmpl
		}
		if tmpl, ok := family[BondLangEnglish]; ok {
			return tmpl
		}
	}
	return releaseAgreementDocs[commonModels.PolicyKML][BondLangEnglish]
}

func renderReleaseAgreementHTML(data ReleaseAgreementData, lang string) (string, error) {
	tmpl := releaseAgreementDocFor(data.Policy, lang)
	customerName := html.EscapeString(data.CustomerName)
	if strings.TrimSpace(customerName) == "" {
		customerName = releaseBlank
	}
	careOf := html.EscapeString(data.CustomerCareOf)
	address := html.EscapeString(data.CustomerAddress)
	var customerLineParts []string
	if lang == BondLangMalayalam {
		customerLineParts = append(customerLineParts, fmt.Sprintf("ഉപഭോക്താവ് <b>%s</b>", customerName))
		if careOf != "" {
			customerLineParts = append(customerLineParts, fmt.Sprintf("c/o <b>%s</b>", careOf))
		}
		if address != "" {
			customerLineParts = append(customerLineParts, fmt.Sprintf("വിലാസം <b>%s</b>", address))
		}
	} else {
		customerLineParts = append(customerLineParts, fmt.Sprintf("Customer <b>%s</b>", customerName))
		if careOf != "" {
			customerLineParts = append(customerLineParts, fmt.Sprintf("c/o <b>%s</b>", careOf))
		}
		if address != "" {
			customerLineParts = append(customerLineParts, fmt.Sprintf("address <b>%s</b>", address))
		}
	}
	returnedDate := data.ReturnedDate
	if returnedDate.IsZero() {
		returnedDate = time.Now()
	}
	amountWordsLine := releaseBlank
	if data.ReturnedAmount > 0 {
		suffix := "Only"
		if lang == BondLangMalayalam {
			suffix = "മാത്രം"
		}
		amountWordsLine = amountInWords(data.ReturnedAmount) + " " + suffix
	}
	ornaments := make([]releaseOrnamentTemplateData, 0, len(data.Ornaments))
	for _, o := range data.Ornaments {
		ornaments = append(ornaments, releaseOrnamentTemplateData{
			Name:        o.Name,
			Quantity:    o.Quantity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			FineWeight:  releaseFineWeight(o.NetWeight, o.Purity),
			Value:       releaseFmtAmount(o.Value),
		})
	}
	td := releaseAgreementTemplateData{
		ReleaseAgreementData: data,
		Style:                template.CSS(releaseAgreementStyle(lang)),
		Blank:                releaseBlank,
		LenderName:           firstNonEmpty(data.LegalName, "CHITTILAPILLY THOMMANA FINANCIERS AND INVESTMENTS"),
		LenderAddress:        orBlank(data.AddressLine),
		LenderPhone:          "+919037374004",
		LenderEmail:          "chittilapillythommanafinancier@gmail.com",
		LenderKMLRegNo:       firstNonEmpty(data.KMLRegNo, "32080354468"),
		CustomerLine:         template.HTML(strings.Join(customerLineParts, " ")), //nolint:gosec // built above from html.EscapeString'd customer data plus fixed <b> markup, not raw user input
		BorrowedDate:         releaseFmtDate(data.BorrowedDate, lang),
		BorrowedAmount:       releaseFmtAmount(data.BorrowedAmount),
		ReturnedDate:         releaseFmtDate(returnedDate, lang),
		ReturnedAmount:       releaseFmtAmount(data.ReturnedAmount),
		TotalInterest:        releaseFmtAmount(data.TotalInterest),
		AmountWordsLine:      amountWordsLine,
		Ornaments:            ornaments,
	}
	var sb strings.Builder
	if err := tmpl.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("release agreement: render template: %w", err)
	}
	return sb.String(), nil
}

func releaseAgreementStyle(lang string) string {
	style := `
body{font-family:'Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;margin:0;padding:0}
h1{font-size:20px;letter-spacing:2px;margin:0 0 16px}
p{margin:8px 0}
.hd-table{border:none;margin-bottom:10px}
.hd-table td{border:none;padding:0;vertical-align:top}
.amt-table{width:auto;margin-left:auto;border:none;margin-top:6px}
.amt-table td{border:none;padding:1px 0 1px 24px}
.amt-table td:first-child{padding-left:0}
table:not(.hd-table):not(.amt-table){width:100%;margin-top:14px;border-collapse:separate;border-spacing:0}
table:not(.hd-table):not(.amt-table) th,table:not(.hd-table):not(.amt-table) td{padding:6px 10px;border:1px solid #ccc}
table:not(.hd-table):not(.amt-table) th{background:#ececec;font-size:12px}
.terms{font-size:11px;color:#444;margin-top:16px}
.sig-row{display:flex;justify-content:space-between;margin-top:44px}
.sig-row div{text-align:left}
.sig-line{display:inline-block;border-top:1px solid #333;padding-top:4px;min-width:170px;margin-top:34px}
/* Owner signature: the uploaded image sits in a fixed slot above the line,
 * so the line stays at the same height whether or not one is set. */
.owner-sig .slot{height:46px;display:flex;align-items:flex-end}
.owner-sig .sig-img{max-height:44px;max-width:170px;display:block}
.owner-sig .sig-line{margin-top:0}
`
	if lang == BondLangMalayalam {
		style += `body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif}`
	}
	return style
}

func RenderReleaseAgreementPDF(data ReleaseAgreementData, lang string) ([]byte, error) {
	html, err := renderReleaseAgreementHTML(data, lang)
	if err != nil {
		return nil, err
	}
	return renderA4PDF(html, "release agreement")
}

func releaseAgreementDataForLoan(ctx context.Context, l *models.Loan) ReleaseAgreementData {
	ornaments := make([]ReleaseAgreementOrnament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		ornaments = append(ornaments, ReleaseAgreementOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			Quantity:    o.Quantity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			Value:       o.GoldValue,
		})
	}
	legalName, addressLine, kmlRegNo, policy := lenderProfile(ctx)
	return ReleaseAgreementData{
		LoanNumber:      l.LoanNumber,
		BranchName:      l.Branch.Name,
		CustomerName:    l.Customer.Name,
		CustomerAddress: l.Customer.Address,
		BorrowedDate:    l.OpenedDate,
		BorrowedAmount:  l.PrincipalAmount,
		ReturnedDate:    time.Now(),
		ReturnedAmount:  l.TotalPaid,
		TotalInterest:   l.InterestPaid + l.PenalInterestPaid,
		Ornaments:       ornaments,
		LegalName:       legalName,
		AddressLine:     addressLine,
		KMLRegNo:        kmlRegNo,
		Policy:          policy,
		LenderSignature: lenderSignature(ctx),
	}
}

func renderReleaseAgreementPDFForLoan(ctx context.Context, loanID uint, branchID *uint, lang string) ([]byte, string, error) {
	if lang != BondLangEnglish && lang != BondLangMalayalam {
		return nil, "", common.NewBadRequest("lang must be \"en\", \"ml\" or \"gu\"")
	}
	l, err := GetLoan(ctx, loanID, branchID)
	if err != nil {
		return nil, "", err
	}
	pdfBytes, err := RenderReleaseAgreementPDF(releaseAgreementDataForLoan(ctx, l), lang)
	if err != nil {
		return nil, "", err
	}
	filename := "Release-Agreement-" + l.LoanNumber + ".pdf"
	if lang == BondLangMalayalam {
		filename = "Release-Agreement-Malayalam-" + l.LoanNumber + ".pdf"
	}
	return pdfBytes, filename, nil
}

func platformFormatEnIN(n float64) string {
	i := int64(math.Round(n))
	neg := i < 0
	if neg {
		i = -i
	}
	s := fmt.Sprintf("%d", i)
	if len(s) <= 3 {
		if neg {
			return "-" + s
		}
		return s
	}
	last3 := s[len(s)-3:]
	rest := s[:len(s)-3]
	var groups []string
	for len(rest) > 2 {
		groups = append([]string{rest[len(rest)-2:]}, groups...)
		rest = rest[:len(rest)-2]
	}
	if rest != "" {
		groups = append([]string{rest}, groups...)
	}
	out := strings.Join(groups, ",") + "," + last3
	if neg {
		return "-" + out
	}
	return out
}

func DownloadReleaseAgreementPDF(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	lang := common.DefaultQuery(c, "lang", BondLangEnglish)
	pdfBytes, filename, err := renderReleaseAgreementPDFForLoan(ctx, loanID, auth.GetBranchScope(c), lang)
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}
