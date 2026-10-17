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
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

const blank = "                "

var onesWords = [20]string{
	"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
	"Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
	"Seventeen", "Eighteen", "Nineteen",
}

var tensWords = [10]string{"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"}

const templatesDir = "./templates"

var resolvedTemplatesDir = findTemplatesDir()

var bondTemplateFuncs = template.FuncMap{"inc": func(i int) int { return i + 1 }, "wt": fmtWeight}

// fmtWeight prints a gold weight exactly as stored (up to 3 decimals), never
// fewer than 2, so 12.345 stays 12.345 and 10 prints as 10.00.
func fmtWeight(w float64) string {
	s := strconv.FormatFloat(w, 'f', 3, 64)
	if strings.HasSuffix(s, "0") {
		s = s[:len(s)-1]
	}
	return s
}

var bondDocs = map[string]map[string]bondDoc{
	commonModels.PolicyKML: {
		BondLangEnglish:   {mustLoadTemplate("bond_kml_en", "kml_bond_english.html", bondTemplateFuncs), bondPageStyle},
		BondLangMalayalam: {mustLoadTemplate("bond_kml_ml", "kml_bond_malayalam.html", bondTemplateFuncs), bondPageStyleMalayalam},
	},
	commonModels.PolicyGML: {
		BondLangEnglish:  {mustLoadTemplate("bond_gml_en", "gml_bond_english.html", bondTemplateFuncs), bondPageStyle},
		BondLangGujarati: {mustLoadTemplate("bond_gml_gu", "gml_bond_gujarati.html", bondTemplateFuncs), bondPageStyleGujarati},
	},
	commonModels.PolicyTML: {
		BondLangEnglish: {mustLoadTemplate("bond_tml_en", "tml_bond_english.html", bondTemplateFuncs), bondPageStyleTML},
		BondLangTamil:   {mustLoadTemplate("bond_tml_ta", "tml_bond_tamil.html", bondTemplateFuncs), bondPageStyleTML},
	},
}

const bondPageStyle = `
body{font-family:'Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0;line-height:1.55;font-size:14px;padding:0}
h1{font-size:20px;text-align:center;margin:0 0 2px;letter-spacing:1px}
h2{font-size:15px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol li{margin-bottom:10px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
.sig{break-inside:avoid}
.sig>div{flex:1;text-align:center;position:relative}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
/* Absolutely positioned — sits inside the existing blank gap the .sig
 * span's own 44px margin-top already reserves, rather than adding its
 * own height to the flow (which would push the Lender's line lower than
 * the image-less Borrower's line beside it — see print.ts's identical
 * fix for the on-screen/print copy of this same bond). */
.lender-sig{position:absolute;top:22px;left:50%;transform:translateX(-50%);width:130px}
.lender-sig img{width:100%;max-height:40px;object-fit:contain;display:block}
/* The KML letter has no Borrower/Lender row; the lender signs over the
 * "Loan Sanctioned" line instead, right-aligned. The <img> only exists when
 * the business has uploaded a signature, so the line keeps a fixed gap above
 * it for a wet-ink signature either way. */
.sanction-sig{width:210px;margin:-30px 0 0 auto;text-align:center}
.sanction-sig .slot{height:46px;display:flex;align-items:flex-end;justify-content:center}
.sanction-sig .sig-img{max-height:44px;max-width:170px;display:block}
.sanction-sig span{display:block;border-top:1px solid #333;padding-top:4px;margin-top:2px;font-size:12.5px}
/* No forced page-break here (unlike the Gujarati deed's .sig-page below) —
 * this bond's whole point is fitting the short KML letterhead letter onto
 * ONE A4 page for a plain print. The signature/release block now just
 * flows naturally after the main content. This does mean a bond sent for
 * Aadhaar eSign no longer has a guaranteed page-bottom landing spot for
 * Setu's stamp the way the old forced-second-page version did — re-verify
 * StartIndemnityBondSign's eSign stamp placement after this change. */
.sig-page{}
/* GML deeds only (gml-bond-english/gujarati.html): the Schedule, Place/Date
 * and the signing block are one .deed-end page that always starts on a fresh
 * sheet, so the Schedule is never separated from the signatures. min-height is
 * the A4 printable height (11.69in less the 0.75in header and 0.55in footer
 * bands = 10.39in = 264mm, minus a hair so it never spills onto a blank page),
 * and .sig-bottom's margin-top:auto pins the Borrower/Lender row to the bottom
 * of that page. UPDATE: no longer pinned — a fixed 56px gap follows the Place/Date lines instead, so the last page is not mostly empty space; the eSign stamp position is measured from the rendered block (see esignSlotsJS), not fixed. */
.deed-end{page-break-before:always;break-inside:avoid}
.deed-end .sig-bottom{margin-top:56px}
/* Borrower/Lender row: a taller gap between the party label and its line, so the 36pt eSign stamp (data-esign-dy) fits between them instead of overlapping "The Borrower". The lender image is re-seated to match. */
.deed-end .sig-bottom .sig span{margin-top:68px}
.deed-end .sig-bottom .sig:last-child .lender-sig{top:42px}
`

const bondPageStyleMalayalam = `
body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;margin:0;line-height:1.6;font-size:14px;padding:0}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:.3px}
h2{font-size:14px;text-align:center;margin:0 0 10px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #999;padding:4px 7px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol{padding-left:22px} ol li{margin-bottom:8px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:20px}
.sig{break-inside:avoid}
.sig>div{flex:1;text-align:center}
.sig span{display:block;border-top:1px solid #333;padding-top:4px;margin-top:16px;font-size:12.5px}
/* Lender's signature over the "Loan Sanctioned" line — see bondPageStyle. */
.sanction-sig{width:210px;margin:-30px 0 0 auto;text-align:center}
.sanction-sig .slot{height:46px;display:flex;align-items:flex-end;justify-content:center}
.sanction-sig .sig-img{max-height:44px;max-width:170px;display:block}
.sanction-sig span{display:block;border-top:1px solid #333;padding-top:4px;margin-top:2px;font-size:12.5px}
/* No forced page-break — see bondPageStyle's .sig-page comment. */
.sig-page{}
`

const bondPageStyleGujarati = `
body{font-family:'Noto Sans Gujarati','Shruti','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;margin:0;line-height:1.7;font-size:14px;padding:0}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:.3px}
h2{font-size:14px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol{padding-left:22px} ol li{margin-bottom:12px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
.sig{break-inside:avoid}
.sig>div{flex:1;text-align:center;position:relative}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
/* Absolutely positioned — sits inside the existing blank gap the .sig
 * span's own 44px margin-top already reserves, rather than adding its
 * own height to the flow (which would push the Lender's line lower than
 * the image-less Borrower's line beside it — see print.ts's identical
 * fix for the on-screen/print copy of this same bond). */
.lender-sig{position:absolute;top:22px;left:50%;transform:translateX(-50%);width:130px}
.lender-sig img{width:100%;max-height:40px;object-fit:contain;display:block}
/* GML deeds only (gml-bond-english/gujarati.html): the Schedule, Place/Date
 * and the signing block are one .deed-end page that always starts on a fresh
 * sheet, so the Schedule is never separated from the signatures. min-height is
 * the A4 printable height (11.69in less the 0.75in header and 0.55in footer
 * bands = 10.39in = 264mm, minus a hair so it never spills onto a blank page),
 * and .sig-bottom's margin-top:auto pins the Borrower/Lender row to the bottom
 * of that page. UPDATE: no longer pinned — a fixed 56px gap follows the Place/Date lines instead, so the last page is not mostly empty space; the eSign stamp position is measured from the rendered block (see esignSlotsJS), not fixed. */
.deed-end{page-break-before:always;break-inside:avoid}
.deed-end .sig-bottom{margin-top:56px}
/* Borrower/Lender row: a taller gap between the party label and its line, so the 36pt eSign stamp (data-esign-dy) fits between them instead of overlapping "The Borrower". The lender image is re-seated to match. */
.deed-end .sig-bottom .sig span{margin-top:68px}
.deed-end .sig-bottom .sig:last-child .lender-sig{top:42px}
`

const (
	BondLangEnglish   = "en"
	BondLangMalayalam = "ml"
	BondLangGujarati  = "gu"
	BondLangTamil     = "ta"
)

func validBondLang(lang string) bool {
	return lang == BondLangEnglish || lang == BondLangMalayalam || lang == BondLangGujarati || lang == BondLangTamil
}

var pdfPagePattern = regexp.MustCompile(`(?s)/Type\s*/Page[^s]`)

type BondOrnament struct {
	Name        string
	Quantity    int
	Purity      string
	GrossWeight float64
	NetWeight   float64
	Value       float64
}

type BondData struct {
	LoanNumber      string
	CustomerName    string
	Age             int
	Address         string
	BranchName      string
	Phone           string
	PAN             string
	Aadhaar         string
	PrincipalAmount float64
	InterestRate    float64
	Ornaments       []BondOrnament
	Day             int
	Month           string
	Year            int
	BusinessName    string
	LegalName       string
	AddressLine     string
	KMLRegNo        string
	LenderAge       string
	LenderPAN       string
	LenderAadhaar   string
	Policy          string
	DueDate         time.Time
	LenderSignature template.HTML
	Disbursements   []BondDisbursement
	Witness1Name    string
	Witness2Name    string
	// TML pledge-book sheet only (tml_bond_*.html): loan date, lender phones and the two photos.
	OpenedDate    time.Time
	CreatedByName string
	Brand         string
	Phones        string
	CustomerPhoto template.URL
	OverallPhoto  template.URL
	Logo          template.URL
}

type tmlBondItem struct {
	Name string
	Qty  int
}

type BondDisbursement struct {
	Date    time.Time
	Amount  float64
	Initial bool
}

type bondDistRow struct {
	Date    string
	Amount  string
	Initial bool
}

type bondDoc struct {
	tmpl  *template.Template
	style string
}

type bondTemplateData struct {
	BondData
	Style              template.CSS
	Blank              string
	LenderName         string
	LenderRegNo        string
	LenderAge          string
	LenderBusiness     string
	LenderAadhaar      string
	LenderPAN          string
	LenderAddress      string
	LenderAddressShort string
	Age                string
	Aadhaar            string
	PAN                string
	Address            string
	BranchName         string
	PrincipalAmount    string
	InterestRate       string
	TotalValue         string
	DueDate            string
	Mobile             string
	DateDisplay        string
	ItemNames          string
	ItemWeights        string
	AmountWords        string
	Distribution       []bondDistRow
	LoanDateDisplay    string
	PrintTime          string
	Items              []tmlBondItem
	GrossTotal         string
	NetTotal           string
	ReceiptAmount      string // principal to 2 decimals, for the gold loan receipt
	TotalQty           int
	PacketQR           template.URL
	PrintClock         string
	PadRows            []int
	AddressLines       []string
}

// Signer roles stamped on the GML pledge agreement's eSign slots (data-esign-role in the templates).
const (
	RoleGMLEsignWitness1 = "gml_esign_witness1"
	RoleGMLEsignWitness2 = "gml_esign_witness2"
	RoleGMLEsignBorrower = "gml_esign_borrower"
)

type startIndemnityBondEsignRequest struct {
	Lang        string             `json:"lang"`
	Document    string             `json:"document"` // "" / "bond" = pledge agreement, "slip" = pledge slip
	RedirectURL string             `json:"redirect_url" binding:"required"`
	DeliverBy   string             `json:"deliver_by"`
	Witnesses   []bondWitnessInput `json:"witnesses"`
}

// bondWitnessInput is one extra signer (a witness) who signs their own box on the
// same pledge agreement with their own Aadhaar.
type bondWitnessInput struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

type indemnityBondPreviewOrnament struct {
	Name        string  `json:"name"`
	Purity      string  `json:"purity"`
	GrossWeight float64 `json:"gross_weight"`
	NetWeight   float64 `json:"net_weight"`
	Value       float64 `json:"value"`
}

type indemnityBondPreviewRequest struct {
	LoanNumber      string                         `json:"loan_number"`
	Name            string                         `json:"name"`
	DOB             string                         `json:"dob"`
	Address         string                         `json:"address"`
	BranchName      string                         `json:"branch_name"`
	Phone           string                         `json:"phone"`
	PAN             string                         `json:"pan"`
	Aadhaar         string                         `json:"aadhaar"`
	PrincipalAmount float64                        `json:"principal_amount"`
	InterestRate    float64                        `json:"interest_rate"`
	DueDate         string                         `json:"due_date"`
	Ornaments       []indemnityBondPreviewOrnament `json:"ornaments"`
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func orBlank(s string) string {
	if strings.TrimSpace(s) == "" {
		return blank
	}
	return s
}

func ageOrBlank(age int) string {
	if age <= 0 {
		return blank
	}
	return fmt.Sprintf("%d", age)
}

func aadhaarOrBlank(aadhaar string) string {
	if strings.TrimSpace(aadhaar) == "" {
		return blank
	}
	return aadhaar
}

func inrOrBlank(amount float64) string {
	if amount <= 0 {
		return blank
	}
	return fmt.Sprintf("%.0f", amount)
}

func monthAbbrev(month string) string {
	if len(month) <= 3 {
		return month
	}
	return month[:3]
}

func rateOrBlank(rate float64) string {
	if rate <= 0 {
		return blank
	}
	return fmt.Sprintf("%g%%", rate)
}

func dueDateOrBlank(dueDate time.Time) string {
	if dueDate.IsZero() {
		return blank
	}
	return dueDate.Format("02-01-2006")
}

func twoDigitWords(n int) string {
	if n < 20 {
		return onesWords[n]
	}
	t, o := n/10, n%10
	if o == 0 {
		return tensWords[t]
	}
	return tensWords[t] + "-" + onesWords[o]
}

func threeDigitWords(n int) string {
	h, rest := n/100, n%100
	var parts []string
	if h > 0 {
		parts = append(parts, onesWords[h]+" Hundred")
	}
	if rest > 0 {
		parts = append(parts, twoDigitWords(rest))
	}
	return strings.Join(parts, " ")
}

func amountInWords(amount float64) string {
	n := int64(math.Round(math.Abs(amount)))
	if n == 0 {
		return "Zero"
	}
	crore := n / 1e7
	n %= 1e7
	lakh := n / 1e5
	n %= 1e5
	thousand := n / 1e3
	n %= 1e3
	hundred := n
	var parts []string
	if crore > 0 {
		parts = append(parts, threeDigitWords(int(crore))+" Crore")
	}
	if lakh > 0 {
		parts = append(parts, threeDigitWords(int(lakh))+" Lakh")
	}
	if thousand > 0 {
		parts = append(parts, threeDigitWords(int(thousand))+" Thousand")
	}
	if hundred > 0 {
		parts = append(parts, threeDigitWords(int(hundred)))
	}
	return strings.Join(parts, " ")
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

func mustLoadTemplate(templateName, fileName string, funcs template.FuncMap) *template.Template {
	b, err := os.ReadFile(filepath.Join(resolvedTemplatesDir, fileName))
	if err != nil {
		panic(fmt.Sprintf("pledge agreement: read template %s: %v", fileName, err))
	}
	return template.Must(template.New(templateName).Funcs(funcs).Parse(string(b)))
}

func bondDocFor(policy, lang string) bondDoc {
	family, ok := bondDocs[commonModels.PolicyOrDefault(policy)]
	if !ok {
		family = bondDocs[commonModels.PolicyKML]
	}
	if doc, ok := family[lang]; ok {
		return doc
	}
	if doc, ok := family[BondLangEnglish]; ok {
		return doc
	}
	return bondDocs[commonModels.PolicyKML][BondLangEnglish]
}

func renderBondHTML(data BondData, lang string) (string, error) {
	var totalValue float64
	for _, o := range data.Ornaments {
		totalValue += o.Value
	}
	doc := bondDocFor(data.Policy, lang)
	tmpl, style := doc.tmpl, doc.style
	itemNames := make([]string, 0, len(data.Ornaments))
	itemWeights := make([]string, 0, len(data.Ornaments))
	for _, o := range data.Ornaments {
		itemNames = append(itemNames, o.Name)
		itemWeights = append(itemWeights, fmtWeight(o.NetWeight)+" GM")
	}
	itemNamesStr := strings.Join(itemNames, ", ")
	if itemNamesStr == "" {
		itemNamesStr = blank
	}
	itemWeightsStr := strings.Join(itemWeights, ", ")
	if itemWeightsStr == "" {
		itemWeightsStr = blank
	}
	td := bondTemplateData{
		BondData:           data,
		Style:              template.CSS(":root{--brand:" + string(brandColor(data.Brand)) + "}" + style + tmlZoomCSS(len(data.Ornaments), data.Policy)),
		Blank:              blank,
		LenderName:         firstNonEmpty(data.LegalName, data.BusinessName, "CloudHouse Finance"),
		LenderRegNo:        firstNonEmpty(data.KMLRegNo, "DEMO-0000000000"),
		LenderAge:          firstNonEmpty(data.LenderAge, "—"),
		LenderBusiness:     firstNonEmpty(data.LegalName, data.BusinessName, "CloudHouse Finance"),
		LenderAadhaar:      lenderAadhaarDisplay(data.LenderAadhaar),
		LenderPAN:          firstNonEmpty(data.LenderPAN, "AAAAA0000A"),
		LenderAddress:      orBlank(data.AddressLine),
		LenderAddressShort: strings.TrimSpace(data.AddressLine),
		Age:                ageOrBlank(data.Age),
		Aadhaar:            aadhaarOrBlank(data.Aadhaar),
		PAN:                orBlank(data.PAN),
		Address:            orBlank(data.Address),
		BranchName:         orBlank(data.BranchName),
		PrincipalAmount:    inrOrBlank(data.PrincipalAmount),
		InterestRate:       rateOrBlank(data.InterestRate),
		TotalValue:         inrOrBlank(totalValue),
		Mobile:             orBlank(data.Phone),
		DateDisplay:        fmt.Sprintf("%02d %s %d", data.Day, strings.ToUpper(monthAbbrev(data.Month)), data.Year),
		ItemNames:          itemNamesStr,
		ItemWeights:        itemWeightsStr,
		AmountWords:        amountInWords(data.PrincipalAmount),
		DueDate:            dueDateOrBlank(data.DueDate),
	}
	td.CustomerName = orBlank(data.CustomerName)
	td.LoanDateDisplay = time.Now().Format("02-01-2006")
	if !data.OpenedDate.IsZero() {
		td.LoanDateDisplay = data.OpenedDate.Format("02-01-2006")
	}
	td.PrintTime = time.Now().Format("02-01-2006 03:04 PM")
	td.PacketQR = qrDataURL(data.LoanNumber)
	for _, ln := range strings.Split(strings.TrimSpace(data.AddressLine), "\n") {
		if ln = strings.TrimSpace(ln); ln != "" {
			td.AddressLines = append(td.AddressLines, ln)
		}
	}
	td.PrintClock = time.Now().Format("03:04 PM")
	var gross, net float64
	for _, o := range data.Ornaments {
		qty := max(o.Quantity, 1)
		td.Items = append(td.Items, tmlBondItem{Name: o.Name, Qty: qty})
		td.TotalQty += qty
		gross += o.GrossWeight
		net += o.NetWeight
	}
	for i := len(td.Items); i < 4; i++ {
		td.PadRows = append(td.PadRows, i)
	}
	td.GrossTotal = fmtWeight(gross)
	td.NetTotal = fmtWeight(net)
	td.ReceiptAmount = fmt.Sprintf("%.2f", data.PrincipalAmount)
	for _, d := range data.Disbursements {
		td.Distribution = append(td.Distribution, bondDistRow{
			Date:    d.Date.Format("02/01/2006"),
			Amount:  fmt.Sprintf("%.0f", d.Amount),
			Initial: d.Initial,
		})
	}
	var sb strings.Builder
	if err := tmpl.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("pledge agreement: render template: %w", err)
	}
	return sb.String(), nil
}

func RenderIndemnityBondPDF(data BondData, lang string) ([]byte, error) {
	pdfBytes, _, err := RenderIndemnityBondPDFWithSlots(data, lang)
	return pdfBytes, err
}

func RenderIndemnityBondPDFWithSlots(data BondData, lang string) ([]byte, []config.SignatureSlot, error) {
	html, err := renderBondHTML(data, lang)
	if err != nil {
		return nil, nil, err
	}
	return renderA4PDFWithSlots(html, "pledge agreement")
}

func CountPDFPages(pdfBytes []byte) int {
	matches := pdfPagePattern.FindAllIndex(pdfBytes, -1)
	if len(matches) > 0 {
		return len(matches)
	}
	return 1
}

func lenderAadhaarDisplay(aadhaar string) string {
	if len(aadhaar) != 12 {
		return "XXXX XXXX XXXX"
	}
	return aadhaar[0:4] + " " + aadhaar[4:8] + " " + aadhaar[8:12]
}

func renderIndemnityBondPDFForLoan(ctx context.Context, loanID uint, branchID *uint, lang string) ([]byte, string, error) {
	if !validBondLang(lang) {
		return nil, "", common.NewBadRequest("lang must be \"en\", \"ml\", \"gu\" or \"ta\"")
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, "", common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, "", common.NewNotFound("loan not found")
	}
	pdfBytes, err := RenderIndemnityBondPDF(bondDataForLoan(ctx, l), lang)
	if err != nil {
		return nil, "", err
	}
	filename := "Pledge-Agreement-" + l.LoanNumber + ".pdf"
	switch lang {
	case BondLangMalayalam:
		filename = "Pledge-Agreement-Malayalam-" + l.LoanNumber + ".pdf"
	case BondLangGujarati:
		filename = "Pledge-Agreement-Gujarati-" + l.LoanNumber + ".pdf"
	case BondLangTamil:
		filename = "Pledge-Agreement-Tamil-" + l.LoanNumber + ".pdf"
	}
	return pdfBytes, filename, nil
}

func startIndemnityBondSign(ctx context.Context, loanID uint, branchID *uint, lang string, redirectURL string, deliverBy string, witnesses []bondWitnessInput) (*config.SignatureRequest, error) {
	if config.Esign == nil || config.IsDemoRun(ctx) {
		return nil, common.NewUnavailable("indemnity bond eSign is not configured")
	}
	if !validBondLang(lang) {
		return nil, common.NewBadRequest("lang must be \"en\", \"ml\", \"gu\" or \"ta\"")
	}
	if !tenantAllowsLanguage(ctx, lang) {
		return nil, common.NewForbidden("this business is not set up to issue documents in that language")
	}
	if deliverBy == "" {
		deliverBy = "open"
	}
	if deliverBy != "open" && deliverBy != "whatsapp" && deliverBy != "dashboard" {
		return nil, common.NewBadRequest("deliver_by must be \"open\", \"whatsapp\" or \"dashboard\"")
	}
	// One witness is enough; a second is optional.
	if len(witnesses) > 2 {
		return nil, common.NewBadRequest("at most two witnesses are allowed")
	}
	witnessSigners := make([]config.Signer, 0, len(witnesses))
	for i, w := range witnesses {
		wPhone := digitsOnly(w.Phone)
		if len(wPhone) > 10 {
			wPhone = wPhone[len(wPhone)-10:]
		}
		wName := strings.TrimSpace(w.Name)
		if len(wPhone) != 10 || len(wName) < 3 {
			return nil, common.NewBadRequest(fmt.Sprintf("witness %d needs a name and a 10-digit mobile number", i+1))
		}
		witnessSigners = append(witnessSigners, config.Signer{Identifier: wPhone, DisplayName: wName})
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	if l.IndemnityBondSignStatus == "sign_complete" {
		return nil, common.NewConflict("this loan's indemnity bond has already been signed")
	}
	if tenantID, ok := config.TenantFromContext(ctx); ok {
		if err := common.CheckAndRecordUsage(config.DB,
			tenantID, common.UsageSetuEsign); err != nil {
			return nil, err
		}
	}
	bond := bondDataForLoan(ctx, l)
	if len(witnessSigners) > 0 {
		bond.Witness1Name = witnessSigners[0].DisplayName
	}
	if len(witnessSigners) > 1 {
		bond.Witness2Name = witnessSigners[1].DisplayName
	}
	pdfBytes, slots, err := RenderIndemnityBondPDFWithSlots(bond, lang)
	if err != nil {
		return nil, err
	}
	var borrowerSlots, witness1Slots, witness2Slots []config.SignatureSlot
	for _, s := range slots {
		switch s.Role {
		case RoleGMLEsignWitness1:
			witness1Slots = append(witness1Slots, s)
		case RoleGMLEsignWitness2:
			witness2Slots = append(witness2Slots, s)
		case RoleGMLEsignBorrower:
			borrowerSlots = append(borrowerSlots, s)
		default: // KML templates mark no role; their only slot is the borrower's
			borrowerSlots = append(borrowerSlots, s)
		}
	}
	// When a box could not be measured (layout without witness boxes, or an
	// over-tall last page) fall back to the SUREPASS_ESIGN_WITNESS*_X/Y positions.
	if len(witnessSigners) > 0 {
		lastPageNo := strconv.Itoa(max(CountPDFPages(pdfBytes), 1))
		if len(witness1Slots) == 0 {
			witness1Slots = []config.SignatureSlot{{Page: lastPageNo, X: config.Env.SurepassEsignWitness1X, Y: config.Env.SurepassEsignWitness1Y, Role: RoleGMLEsignWitness1}}
		}
		if len(witnessSigners) > 1 && len(witness2Slots) == 0 {
			witness2Slots = []config.SignatureSlot{{Page: lastPageNo, X: config.Env.SurepassEsignWitness2X, Y: config.Env.SurepassEsignWitness2Y, Role: RoleGMLEsignWitness2}}
		}
	}
	docTitle := "Pledge Agreement - " + l.LoanNumber
	if lang == BondLangMalayalam {
		docTitle = "Pledge Agreement (Malayalam) - " + l.LoanNumber
	}
	if lang == BondLangTamil {
		docTitle = "Pledge Agreement (Tamil) - " + l.LoanNumber
	}
	doc, err := config.Esign.
		UploadDocument(pdfBytes, docTitle)
	if err != nil {
		return nil, err
	}
	phone := digitsOnly(l.Customer.Phone)
	if len(phone) > 10 {
		phone = phone[len(phone)-10:]
	}
	if len(phone) < 10 {
		phone = "9876543210"
	}
	name := strings.TrimSpace(l.Customer.Name)
	if len(name) < 3 {
		name = "Customer " + l.LoanNumber
	}
	lastPage := strconv.Itoa(CountPDFPages(pdfBytes))
	if lastPage == "" || lastPage == "0" {
		lastPage = "1"
	}
	signer := config.Signer{
		Identifier:  phone,
		DisplayName: name,
		Signature: &config.SignatureConfig{
			OnPages:  []string{lastPage},
			Position: "bottom-right",
			Slots:    borrowerSlots,
		},
	}
	if !l.Customer.DOB.IsZero() {
		signer.BirthYear = strconv.Itoa(l.Customer.DOB.Year())
	}
	signers := []config.Signer{signer}
	if len(witnessSigners) > 0 {
		witnessSlots := [][]config.SignatureSlot{witness1Slots, witness2Slots}
		for i := range witnessSigners {
			witnessSigners[i].Signature = &config.SignatureConfig{OnPages: []string{lastPage}, Slots: witnessSlots[i]}
		}
		signers = append(signers, witnessSigners...)
	}
	req, err := config.Esign.
		CreateSignatureRequestMulti(doc.ID, signers, redirectURL)
	if err != nil {
		return nil, err
	}
	l.IndemnityBondDocumentID = doc.ID
	l.IndemnityBondSignRequestID = req.ID
	l.IndemnityBondSignStatus = req.Status
	if err := persistLoan(ctx, l); err != nil {
		return nil, err
	}
	if req.URL != "" {
		deliverEsignLink(ctx, l, req.URL, lang, deliverBy, phone)
	}
	// Witnesses are not customers, so only WhatsApp can reach them; with other
	// delivery modes the staff hands over the link returned in the response.
	if deliverBy == "whatsapp" {
		for _, w := range req.Signers[1:] {
			deliverEsignLink(ctx, l, w.URL, lang, deliverBy, w.Identifier)
		}
	}
	return req, nil
}

func digitsOnly(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
}

func deliverEsignLink(ctx context.Context, l *models.Loan, url, lang, deliverBy, phone string) {
	langLabel := "English"
	switch lang {
	case BondLangMalayalam:
		langLabel = "Malayalam"
	case BondLangTamil:
		langLabel = "Tamil"
	}
	deliverEsignNotice(ctx, l, "Sign Your Pledge Agreement", fmt.Sprintf(
		"CloudHouse Finance: your %s pledge agreement for loan %s is ready to sign with Aadhaar. Open this link on your own phone to complete it: %s",
		langLabel, l.LoanNumber, url,
	), deliverBy, phone)
}

// deliverEsignNotice sends an eSign link message by WhatsApp or to the customer app.
func deliverEsignNotice(ctx context.Context, l *models.Loan, title, body, deliverBy, phone string) {
	switch deliverBy {
	case "whatsapp":
		if config.WhatsApp == nil || config.IsDemoRun(ctx) {
			log.Printf("indemnity bond: WhatsApp delivery requested for loan %d but no WhatsApp sender is configured", l.ID)
			return
		}
		tenantID, _ := config.TenantFromContext(ctx)
		go func() {
			// A panic in a detached goroutine takes the whole process with it; a failed courtesy message must never do that.
			defer func() {
				if r := recover(); r != nil {
					log.Printf("indemnity bond eSign WhatsApp notification panicked (loan %d): %v", l.ID, r)
				}
			}()
			sendErr := config.WhatsApp.
				Send(ctx, phone, body)
			if sendErr != nil {
				log.Printf("indemnity bond eSign WhatsApp send failed (loan %d, phone %s): %v", l.ID, phone, sendErr)
			}
			if !config.IsDemoRun(ctx) {
				rec := &commonModels.CommunicationLog{
					RecipientPhone:    phone,
					ChatID:            common.NormalizeChatID(phone),
					Channel:           commonModels.ChannelWhatsApp,
					TriggerType:       "indemnity_bond_esign",
					MessageBody:       body,
					RelatedEntityType: "loan",
					RelatedEntityID:   l.ID,
					Status:            commonModels.StatusSent,
				}
				if sendErr != nil {
					rec.Status = commonModels.StatusFailed
					rec.ErrorMessage = sendErr.Error()
				}
				if err := common.CreateBackground(tenantID, rec); err != nil {
					log.Printf("indemnity bond eSign: communication log write failed (loan %d): %v", l.ID, err)
				}
			}
		}()
	case "dashboard":
		if config.IsDemoRun(ctx) {
			log.Printf("indemnity bond: dashboard delivery requested for loan %d but no notifier is configured", l.ID)
			return
		}
		common.NotifyCustomer(ctx, l.CustomerID, "IndemnityBondEsignReady", title, body, "loan", l.ID)
	}
}

// downloadSignedPDF fetches the finished, signed document of a completed eSign request.
func downloadSignedPDF(requestID string) ([]byte, error) {
	signed, err := config.Esign.GetSignedDocument(requestID)
	if err != nil {
		return nil, err
	}
	resp, err := http.Get(signed.DownloadURL)
	if err != nil {
		return nil, fmt.Errorf("esign: download signed document: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("esign: download signed document: unexpected status %d", resp.StatusCode)
	}
	pdfBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("esign: read signed document: %w", err)
	}
	return pdfBytes, nil
}

func checkIndemnityBondSign(ctx context.Context, loanID uint, branchID *uint) (*models.Loan, *config.SignatureStatus, error) {
	if config.Esign == nil || config.IsDemoRun(ctx) {
		return nil, nil, common.NewUnavailable("indemnity bond eSign is not configured")
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, nil, common.NewNotFound("loan not found")
	}
	if l.IndemnityBondSignRequestID == "" {
		return nil, nil, common.NewBadRequest("no indemnity bond eSign has been started for this loan")
	}
	status, err := config.Esign.
		GetSignatureStatus(l.IndemnityBondSignRequestID)
	if err != nil {
		return nil, nil, err
	}
	if status.Status != "sign_complete" {
		l.IndemnityBondSignStatus = status.Status
		if updErr := persistLoan(ctx, l); updErr != nil {
			log.Printf("indemnity bond sign status update failed for loan %d: %v", l.ID, updErr)
		}
		return l, status, nil
	}
	pdfBytes, err := downloadSignedPDF(l.IndemnityBondSignRequestID)
	if err != nil {
		return nil, nil, err
	}
	url, err := common.SaveBytesRecorded(ctx, config.Env.UploadsDir, "indemnity-bond-"+l.LoanNumber+".pdf", pdfBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("indemnity bond: store signed document: %w", err)
	}
	now := time.Now()
	l.IndemnityBondSignStatus = "sign_complete"
	l.IndemnityBondSignedURL = url
	l.IndemnityBondSignedAt = &now
	if err := persistLoan(ctx, l); err != nil {
		return nil, nil, err
	}
	updated, err := findLoanByID(ctx, l.ID)
	if err != nil {
		return nil, nil, err
	}
	return updated, status, nil
}

func StartIndemnityBondEsign(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req startIndemnityBondEsignRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	var signReq *config.SignatureRequest
	if req.Document == "slip" {
		signReq, err = startPledgeSlipSign(ctx, loanID, auth.GetBranchScope(c), req.RedirectURL, req.DeliverBy)
	} else {
		if req.Lang == "" {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
		}
		signReq, err = startIndemnityBondSign(ctx, loanID, auth.GetBranchScope(c), req.Lang, req.RedirectURL, req.DeliverBy, req.Witnesses)
	}
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{
		"id":          signReq.ID,
		"document_id": signReq.DocumentID,
		"status":      signReq.Status,
		"url":         signReq.URL,
		"signers":     signReq.Signers,
	})
}

func CheckIndemnityBondEsign(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	check := checkIndemnityBondSign
	if c.QueryParam("document") == "slip" {
		check = checkPledgeSlipSign
	}
	rec, status, err := check(ctx, loanID, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{
		"loan":    rec,
		"status":  status.Status,
		"signers": status.Signers,
	})
}

func DownloadIndemnityBondPDF(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	lang := common.DefaultQuery(c, "lang", BondLangEnglish)
	pdfBytes, filename, err := renderIndemnityBondPDFForLoan(ctx, loanID, auth.GetBranchScope(c), lang)
	if err != nil {
		return common.FailErr(c, err)
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func PreviewIndemnityBondPDF(c echo.Context) error {
	var req indemnityBondPreviewRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	lang := common.DefaultQuery(c, "lang", BondLangEnglish)
	if !validBondLang(lang) {
		return common.FailErr(c, common.NewBadRequest("lang must be \"en\", \"ml\", \"gu\" or \"ta\""))
	}
	age := 0
	if req.DOB != "" {
		if dob, err := time.Parse("2006-01-02", req.DOB); err == nil {
			age = int(time.Since(dob).Hours() / 24 / 365.25)
		}
	}
	var dueDate time.Time
	if req.DueDate != "" {
		if d, err := time.Parse("2006-01-02", req.DueDate); err == nil {
			dueDate = d
		}
	}
	ornaments := make([]BondOrnament, 0, len(req.Ornaments))
	for _, o := range req.Ornaments {
		ornaments = append(ornaments, BondOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			Value:       o.Value,
		})
	}
	now := time.Now()
	data := BondData{
		LoanNumber:      req.LoanNumber,
		CustomerName:    req.Name,
		Age:             age,
		Address:         req.Address,
		BranchName:      req.BranchName,
		Phone:           req.Phone,
		PAN:             req.PAN,
		Aadhaar:         req.Aadhaar,
		PrincipalAmount: req.PrincipalAmount,
		InterestRate:    req.InterestRate,
		Ornaments:       ornaments,
		Day:             now.Day(),
		Month:           now.Month().String(),
		Year:            now.Year(),
		DueDate:         dueDate,
	}
	fillLenderProfile(auth.RequestContext(c), &data)
	pdfBytes, err := RenderIndemnityBondPDF(data, lang)
	if err != nil {
		return common.FailErr(c, err)
	}
	filename := "Pledge-Agreement-Preview.pdf"
	if lang == BondLangGujarati {
		filename = "Pledge-Agreement-Preview-Gujarati.pdf"
	}
	if lang == BondLangTamil {
		filename = "Pledge-Agreement-Preview-Tamil.pdf"
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}
