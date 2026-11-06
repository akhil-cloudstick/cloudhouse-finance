package main

// Offline documents. When the server cannot be reached, the page asks for a document here instead: the same HTML
// templates the backend uses (copied into ./templates) are filled from the loan this PC holds, and the page prints
// the result. Online, the backend still makes every document, so nothing here changes what it produces.
//
// The data builders follow backend/modules/Loan/controllers (pledge_slip.go, statement.go, release_agreement.go) on
// purpose: keep them in step when those change.

import (
	"embed"
	"encoding/json"
	"fmt"
	"html"
	"html/template"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

//go:embed templates/*.html
var docTemplates embed.FS

var docFuncs = template.FuncMap{"inc": func(i int) int { return i + 1 }, "wt": docWeight}

func docTemplate(file string) (*template.Template, error) {
	b, err := docTemplates.ReadFile("templates/" + file)
	if err != nil {
		return nil, fmt.Errorf("document template %s: %w", file, err)
	}
	return template.New(file).Funcs(docFuncs).Parse(string(b))
}

// ---- what the page sends -------------------------------------------------------------------------------------

type docOrnament struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	Purity       string  `json:"purity"`
	GrossWeight  float64 `json:"grossWeight"`
	NetWeight    float64 `json:"netWeight"`
	Quantity     int     `json:"quantity"`
	GoldValue    float64 `json:"goldValue"`
	ReleasedAt   *string `json:"releasedAt"`
	DeductionWeight float64 `json:"deductionWeight"`
}

type docPayment struct {
	ID                   int     `json:"id"`
	ProcessingFeeApplied float64 `json:"processingFeeApplied"`
	Amount               float64 `json:"amount"`
	Type                 string  `json:"type"`
	PaidOn               string  `json:"paidOn"`
	InterestApplied      float64 `json:"interestApplied"`
	PenalInterestApplied float64 `json:"penalInterestApplied"`
	PrincipalApplied     float64 `json:"principalApplied"`
	RunningBalance       float64 `json:"runningBalance"`
}

type docTopUp struct {
	Amount     float64 `json:"amount"`
	OccurredOn string  `json:"occurredOn"`
	Status     string  `json:"status"`
}

type docLoan struct {
	LoanNumber               string        `json:"loanNumber"`
	Status                   string        `json:"status"`
	IsOverdue                bool          `json:"isOverdue"`
	DaysOverdue              int           `json:"daysOverdue"`
	OpenedDate               string        `json:"openedDate"`
	DueDate                  string        `json:"dueDate"`
	ClosedAt                 string        `json:"closedAt"`
	PrincipalAmount          float64       `json:"principalAmount"`
	EligibleLoanAmount       float64       `json:"eligibleLoanAmount"`
	TotalNetWeight           float64       `json:"totalNetWeight"`
	TotalGoldValue           float64       `json:"totalGoldValue"`
	SchemeInterestRate       float64       `json:"schemeInterestRate"`
	SchemeLtvPercent         float64       `json:"schemeLtvPercent"`
	OutstandingAmount        float64       `json:"outstandingAmount"`
	AccruedInterest          float64       `json:"accruedInterest"`
	InterestPaid             float64       `json:"interestPaid"`
	PenalInterestPaid        float64       `json:"penalInterestPaid"`
	OutstandingInterest      float64       `json:"outstandingInterest"`
	AccruedPenalInterest     float64       `json:"accruedPenalInterest"`
	OutstandingPenalInterest float64       `json:"outstandingPenalInterest"`
	OutstandingProcessingFee float64       `json:"outstandingProcessingFee"`
	TotalOutstandingBalance  float64       `json:"totalOutstandingBalance"`
	SettlementAmount         float64       `json:"settlementAmount"`
	TotalPaid                float64       `json:"totalPaid"`
	Branch                   struct{ Name string } `json:"branch"`
	Customer                 struct {
		Name    string `json:"name"`
		Code    string `json:"code"`
		ID      int    `json:"id"`
		Phone   string `json:"phone"`
		Address string `json:"address"`
		// only on the bond
		Age          *int   `json:"age"`
		DOB          string `json:"dob"`
		PAN          string `json:"pan"`
		AadhaarLast4 string `json:"aadhaarLast4"`
		Aadhaar      string `json:"aadhaar"` // the whole number, only when the person typed it in the form (the pre-save preview)
	} `json:"customer"`
	Scheme    struct{ Name string } `json:"scheme"`
	Ornaments []docOrnament        `json:"ornaments"`
	Payments  []docPayment         `json:"payments"`
	TopUps    []docTopUp           `json:"localTopUps"`
	// TML documents
	SchemeRateTiers      []docRateTier `json:"schemeRateTiers"`
	SchemeMinimumDays    int           `json:"schemeMinimumDays"`
	SchemeDurationMonths int           `json:"schemeDurationMonths"`
}

type docProfile struct {
	Name         string `json:"name"`
	LegalName    string `json:"legalName"`
	AddressLine  string `json:"addressLine"`
	ContactPhone string `json:"contactPhone"`
	KMLRegNo     string `json:"kmlRegNo"`
	Policy       string `json:"policy"`
	BrandColor   string `json:"brandColor"`
	// the lender's own identity, printed on the GML deed
	LenderAge     string `json:"lenderAge"`
	LenderPan     string `json:"lenderPan"`
	LenderAadhaar string `json:"lenderAadhaar"`
}

type docInput struct {
	Loan         docLoan    `json:"loan"`
	Person       docPerson  `json:"person"`
	PersonalLoan docPersonalLoan `json:"personalLoan"`
	Investment   docInvestment   `json:"investment"`
	Receipt      docReceipt      `json:"receipt"`
	Profile      docProfile `json:"profile"`
	SingleBranch bool       `json:"singleBranch"`
}

// RenderOfflineDocument fills one of the bundled templates and returns the finished HTML.
// kind: "pledge-slip", "statement", "release-agreement"; lang: "en" or "ml" (release agreement only).
func (a *App) RenderOfflineDocument(kind, lang, inputJSON string) (string, error) {
	var in docInput
	if err := json.Unmarshal([]byte(inputJSON), &in); err != nil {
		return "", fmt.Errorf("document data: %w", err)
	}
	switch kind {
	case "pledge-slip":
		return docPledgeSlip(in)
	case "statement":
		return docStatement(in)
	case "release-agreement":
		return docReleaseAgreement(in, lang)
	case "bond":
		return docBond(in, lang)
	case "personal-loan-bond":
		return docPersonalLoanBond(in, lang)
	case "investment-bond":
		return docInvestmentBond(in)
	case "tml-pledge-slip":
		return docTMLSlip(in)
	case "tml-statement":
		return docTMLStatement(in)
	case "partial-release-receipt":
		return docPartialReceipt(in, lang)
	}
	return "", fmt.Errorf("document %q cannot be made offline yet", kind)
}

// ---- shared helpers (same output as the backend's) -----------------------------------------------------------

var docHexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func docBrand(c string) template.CSS {
	if docHexColor.MatchString(c) {
		return template.CSS(c)
	}
	return "#423591"
}

func docTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

func docWeight(w float64) string {
	s := strconv.FormatFloat(w, 'f', 3, 64)
	if strings.HasSuffix(s, "0") {
		s = s[:len(s)-1]
	}
	return s
}

func docMoney(v float64) string { return fmt.Sprintf("%.2f", v) }

func docDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func docFirst(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func docNormalizeBreaks(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, `\n`, "\n")
}

func docFormatEnIN(n float64) string {
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
	last3, rest := s[len(s)-3:], s[:len(s)-3]
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

func docRupees(n float64) string {
	cents := int64(math.Round(math.Abs(n) * 100))
	s := fmt.Sprintf("%s.%02d", docFormatEnIN(float64(cents/100)), cents%100)
	if n < 0 && cents != 0 {
		return "₹-" + s
	}
	return "₹" + s
}

func docSlipDate(t time.Time) string {
	if t.IsZero() || t.Year() <= 1 {
		return "—"
	}
	return t.Format("02-01-2006")
}

func docDateOnly(t time.Time) string {
	if t.IsZero() {
		return "-"
	}
	return t.Format("02-Jan-2006")
}

func docRun(tmpl *template.Template, data any, what string) (string, error) {
	var sb strings.Builder
	if err := tmpl.Execute(&sb, data); err != nil {
		return "", fmt.Errorf("%s: render template: %w", what, err)
	}
	return sb.String(), nil
}

// ---- pledge slip ---------------------------------------------------------------------------------------------

type docSlipOrnament struct {
	Name, Purity, NetWeight, Value string
	Quantity                       int
	Photo                          template.URL
}

type docDistRow struct {
	Date, Amount string
	Initial      bool
}

type docSlipData struct {
	Brand                                                                     template.CSS
	LegalName, Descriptor, RegLabel, Phones, AddressLine                      string
	LoanNumber, Today, CustomerName, CustomerCode, Phone, Address, BranchName string
	SchemeName, SchemeRate, SchemeLTV, Opened                                 string
	Ornaments                                                                 []docSlipOrnament
	TotalNetWeight, TotalGoldValue                                            string
	Principal, Eligible                                                       string
	Distribution                                                              []docDistRow
	Esign                                                                     bool
	LenderSignature                                                           template.HTML
}

// docDistribution: the initial amount and each top-up that was really paid out; nothing when there were no top-ups.
func docDistribution(l docLoan) []docDistRow {
	var ups []docTopUp
	for _, t := range l.TopUps {
		if t.Status == "" || t.Status == "Active" {
			ups = append(ups, t)
		}
	}
	if len(ups) == 0 {
		return nil
	}
	initial := l.PrincipalAmount
	for _, t := range ups {
		initial -= t.Amount
	}
	out := []docDistRow{{Date: docSlipDate(docTime(l.OpenedDate)), Amount: docRupees(math.Max(math.Round(initial*100)/100, 0)), Initial: true}}
	for _, t := range ups {
		out = append(out, docDistRow{Date: docSlipDate(docTime(t.OccurredOn)), Amount: docRupees(t.Amount)})
	}
	return out
}

func docPledgeSlip(in docInput) (string, error) {
	tmpl, err := docTemplate("pledge_slip.html")
	if err != nil {
		return "", err
	}
	l, p := in.Loan, in.Profile
	regLabel := ""
	if p.KMLRegNo != "" {
		policy := strings.ToUpper(docFirst(p.Policy, "KML"))
		regLabel = policy + " Reg. No: " + p.KMLRegNo
	}
	custCode := l.Customer.Code
	if custCode == "" {
		custCode = fmt.Sprintf("%d", l.Customer.ID)
	}
	rows := make([]docSlipOrnament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		rows = append(rows, docSlipOrnament{Name: o.Name, Purity: o.Purity, NetWeight: docWeight(o.NetWeight), Quantity: o.Quantity, Value: docRupees(o.GoldValue)})
	}
	branch := ""
	if !in.SingleBranch {
		branch = docDash(l.Branch.Name)
	}
	data := docSlipData{
		Brand:      docBrand(p.BrandColor),
		LegalName:  strings.ToUpper(docFirst(p.LegalName, p.Name, "CloudHouse Finance")),
		Descriptor: "Gold Loans & Finance",
		RegLabel:   regLabel, Phones: p.ContactPhone, AddressLine: docNormalizeBreaks(p.AddressLine),
		LoanNumber: l.LoanNumber, Today: docSlipDate(time.Now()),
		CustomerName: l.Customer.Name, CustomerCode: custCode,
		Phone: docDash(l.Customer.Phone), Address: docDash(l.Customer.Address), BranchName: branch,
		SchemeName: l.Scheme.Name, SchemeRate: fmt.Sprintf("%v", l.SchemeInterestRate), SchemeLTV: fmt.Sprintf("%v", l.SchemeLtvPercent),
		Opened:         docSlipDate(docTime(l.OpenedDate)),
		Ornaments:      rows,
		TotalNetWeight: docWeight(l.TotalNetWeight), TotalGoldValue: docRupees(l.TotalGoldValue),
		Principal: docRupees(l.PrincipalAmount), Eligible: docRupees(l.EligibleLoanAmount),
		Distribution: docDistribution(l),
	}
	return docRun(tmpl, data, "pledge slip")
}

// ---- loan statement ------------------------------------------------------------------------------------------

type docStmtOrnament struct {
	Name, Purity, Gross, Net, Value string
	Qty                             int
}
type docStmtPayment struct{ Date, Type, Amount, Interest, Penal, Principal, Balance string }
type docStmtLine struct{ Label, Value string }

type docStmtData struct {
	Brand                                                          template.CSS
	Business, Branch, Generated                                    string
	LoanNumber, Status, Customer, Phone, Scheme, Rate, Opened, Due string
	Ornaments                                                      []docStmtOrnament
	TotalGross, TotalNet, TotalValue                               string
	Payments                                                       []docStmtPayment
	TotalPaid                                                      string
	BalanceDate                                                    string
	Balance                                                        []docStmtLine
	TotalOutstanding, Settlement                                   string
}

func docStatement(in docInput) (string, error) {
	tmpl, err := docTemplate("statement.html")
	if err != nil {
		return "", err
	}
	l, p := in.Loan, in.Profile
	status := l.Status
	if l.IsOverdue && !strings.EqualFold(status, "Overdue") {
		status = fmt.Sprintf("%s (overdue by %d days)", status, l.DaysOverdue)
	}
	d := docStmtData{
		Brand: docBrand(p.BrandColor), Business: docFirst(p.Name, "Gold Loan Statement"), Generated: time.Now().Format("02-Jan-2006 15:04"),
		LoanNumber: l.LoanNumber, Status: status,
		Customer: fmt.Sprintf("%s (%s)", l.Customer.Name, l.Customer.Code), Phone: docDash(l.Customer.Phone), Scheme: l.Scheme.Name,
		Rate: fmt.Sprintf("%.2f%% p.a.", l.SchemeInterestRate), Opened: docDateOnly(docTime(l.OpenedDate)), Due: docDateOnly(docTime(l.DueDate)),
		BalanceDate: time.Now().Format("02-Jan-2006"),
	}
	if !in.SingleBranch {
		d.Branch = l.Branch.Name
	}
	var gross, net, value float64
	for _, o := range l.Ornaments {
		if o.ReleasedAt != nil && *o.ReleasedAt != "" {
			continue
		}
		d.Ornaments = append(d.Ornaments, docStmtOrnament{Name: o.Name, Purity: o.Purity, Gross: docMoney(o.GrossWeight), Net: docMoney(o.NetWeight), Qty: o.Quantity, Value: docMoney(o.GoldValue)})
		gross += o.GrossWeight
		net += o.NetWeight
		value += o.GoldValue
	}
	d.TotalGross, d.TotalNet, d.TotalValue = docMoney(gross), docMoney(net), docMoney(value)
	var paid float64
	for _, pay := range l.Payments {
		d.Payments = append(d.Payments, docStmtPayment{
			Date: docDateOnly(docTime(pay.PaidOn)), Type: pay.Type, Amount: docMoney(pay.Amount), Interest: docMoney(pay.InterestApplied),
			Penal: docMoney(pay.PenalInterestApplied), Principal: docMoney(pay.PrincipalApplied), Balance: docMoney(pay.RunningBalance),
		})
		paid += pay.Amount
	}
	d.TotalPaid = docMoney(paid)
	d.Balance = []docStmtLine{
		{"Principal Sanctioned", docMoney(l.PrincipalAmount)},
		{"Principal Outstanding", docMoney(l.OutstandingAmount)},
		{"Interest Accrued", docMoney(l.AccruedInterest)},
		{"Interest Paid", docMoney(l.InterestPaid)},
		{"Interest Outstanding", docMoney(l.OutstandingInterest)},
	}
	if l.AccruedPenalInterest > 0 || l.OutstandingPenalInterest > 0 {
		d.Balance = append(d.Balance, docStmtLine{"Penal Interest Accrued", docMoney(l.AccruedPenalInterest)}, docStmtLine{"Penal Interest Outstanding", docMoney(l.OutstandingPenalInterest)})
	}
	if l.OutstandingProcessingFee > 0 {
		d.Balance = append(d.Balance, docStmtLine{"Processing Fee Outstanding", docMoney(l.OutstandingProcessingFee)})
	}
	d.TotalOutstanding = docMoney(l.TotalOutstandingBalance)
	if l.SettlementAmount > 0 {
		d.Settlement = docMoney(l.SettlementAmount)
	}
	return docRun(tmpl, d, "loan statement")
}

// ---- release agreement (FORM 7) ------------------------------------------------------------------------------

const docBlank = "                "

var docMonthsEn = [12]string{"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"}
var docMonthsMl = [12]string{"ജനുവരി", "ഫെബ്രുവരി", "മാർച്ച്", "ഏപ്രിൽ", "മേയ്", "ജൂൺ", "ജൂലൈ", "ഓഗസ്റ്റ്", "സെപ്റ്റംബർ", "ഒക്ടോബർ", "നവംബർ", "ഡിസംബർ"}

var docOnes = [20]string{"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"}
var docTens = [10]string{"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"}

func docTwo(n int) string {
	if n < 20 {
		return docOnes[n]
	}
	if n%10 == 0 {
		return docTens[n/10]
	}
	return docTens[n/10] + " " + docOnes[n%10]
}

func docThree(n int) string {
	var parts []string
	if h := n / 100; h > 0 {
		parts = append(parts, docOnes[h]+" Hundred")
	}
	if r := n % 100; r > 0 {
		parts = append(parts, docTwo(r))
	}
	return strings.Join(parts, " ")
}

func docWords(amount float64) string {
	n := int64(math.Round(math.Abs(amount)))
	if n == 0 {
		return "Zero"
	}
	var parts []string
	for _, u := range []struct {
		div  int64
		name string
	}{{1e7, "Crore"}, {1e5, "Lakh"}, {1e3, "Thousand"}} {
		if q := n / u.div; q > 0 {
			parts = append(parts, docThree(int(q))+" "+u.name)
		}
		n %= u.div
	}
	if n > 0 {
		parts = append(parts, docThree(int(n)))
	}
	return strings.Join(parts, " ")
}

func docRelDate(t time.Time, lang string) string {
	if t.IsZero() {
		return docBlank
	}
	months := docMonthsEn
	if lang == "ml" {
		months = docMonthsMl
	}
	return fmt.Sprintf("%02d %s %d", t.Day(), months[int(t.Month())-1], t.Year())
}

func docRelAmount(n float64) string {
	if n <= 0 {
		return docBlank
	}
	return docFormatEnIN(n)
}

// docFineWeight: fine gold for a purity written as "22K", "916" or "91.6"; the net weight when it cannot be read.
var docKarat = regexp.MustCompile(`^(\d{1,2})\s*[kK]`)

func docFineWeight(net float64, purity string) float64 {
	if m := docKarat.FindStringSubmatch(strings.TrimSpace(purity)); m != nil {
		if k, err := strconv.Atoi(m[1]); err == nil && k > 0 && k <= 24 {
			return net * float64(k) / 24
		}
	}
	if f, err := strconv.ParseFloat(strings.TrimSpace(purity), 64); err == nil {
		switch {
		case f > 100 && f <= 1000:
			return net * f / 1000
		case f > 0 && f <= 100:
			return net * f / 100
		}
	}
	return net
}

type docRelOrnament struct {
	Name        string
	Quantity    int
	GrossWeight float64
	NetWeight   float64
	FineWeight  float64
	Value       string
}

type docRelData struct {
	LoanNumber, BranchName, CustomerName, CustomerAddress, CustomerCareOf string
	LenderSignature                                                      template.HTML
	Style                                                                template.CSS
	Blank                                                                string
	LenderName, LenderAddress, LenderPhone, LenderEmail, LenderKMLRegNo  string
	CustomerLine                                                         template.HTML
	BorrowedDate, BorrowedAmount, ReturnedDate, ReturnedAmount           string
	TotalInterest, AmountWordsLine                                       string
	Ornaments                                                            []docRelOrnament
}

func docReleaseStyle(lang string) string {
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
.owner-sig .slot{height:46px;display:flex;align-items:flex-end}
.owner-sig .sig-img{max-height:44px;max-width:170px;display:block}
.owner-sig .sig-line{margin-top:0}
`
	if lang == "ml" {
		style += `body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif}`
	}
	return style
}

func docReleaseAgreement(in docInput, lang string) (string, error) {
	file := "kml_release_agreement_english.html"
	if lang == "ml" {
		file = "kml_release_agreement_malayalam.html"
	} else {
		lang = "en"
	}
	tmpl, err := docTemplate(file)
	if err != nil {
		return "", err
	}
	l, p := in.Loan, in.Profile
	customerName := html.EscapeString(l.Customer.Name)
	if strings.TrimSpace(customerName) == "" {
		customerName = docBlank
	}
	address := html.EscapeString(l.Customer.Address)
	var parts []string
	if lang == "ml" {
		parts = append(parts, fmt.Sprintf("ഉപഭോക്താവ് <b>%s</b>", customerName))
		if address != "" {
			parts = append(parts, fmt.Sprintf("വിലാസം <b>%s</b>", address))
		}
	} else {
		parts = append(parts, fmt.Sprintf("Customer <b>%s</b>", customerName))
		if address != "" {
			parts = append(parts, fmt.Sprintf("address <b>%s</b>", address))
		}
	}
	returned := docTime(l.ClosedAt)
	if returned.IsZero() && len(l.Payments) > 0 {
		for _, pay := range l.Payments {
			if t := docTime(pay.PaidOn); t.After(returned) {
				returned = t
			}
		}
	}
	if returned.IsZero() {
		returned = time.Now()
	}
	words := docBlank
	if l.TotalPaid > 0 {
		suffix := "Only"
		if lang == "ml" {
			suffix = "മാത്രം"
		}
		words = docWords(l.TotalPaid) + " " + suffix
	}
	orn := make([]docRelOrnament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		orn = append(orn, docRelOrnament{Name: o.Name, Quantity: o.Quantity, GrossWeight: o.GrossWeight, NetWeight: o.NetWeight, FineWeight: docFineWeight(o.NetWeight, o.Purity), Value: docRelAmount(o.GoldValue)})
	}
	addr := docNormalizeBreaks(p.AddressLine)
	if strings.TrimSpace(addr) == "" {
		addr = docBlank
	}
	d := docRelData{
		LoanNumber: l.LoanNumber, BranchName: l.Branch.Name, CustomerName: l.Customer.Name, CustomerAddress: l.Customer.Address,
		Style: template.CSS(docReleaseStyle(lang)), Blank: docBlank,
		LenderName:    docFirst(p.LegalName, "CHITTILAPILLY THOMMANA FINANCIERS AND INVESTMENTS"),
		LenderAddress: addr, LenderPhone: "+919037374004", LenderEmail: "chittilapillythommanafinancier@gmail.com",
		LenderKMLRegNo: docFirst(p.KMLRegNo, "32080354468"),
		CustomerLine:   template.HTML(strings.Join(parts, " ")), //nolint:gosec // built above from escaped customer text plus fixed <b> markup
		BorrowedDate:   docRelDate(docTime(l.OpenedDate), lang), BorrowedAmount: docRelAmount(l.PrincipalAmount),
		ReturnedDate: docRelDate(returned, lang), ReturnedAmount: docRelAmount(l.TotalPaid),
		TotalInterest: docRelAmount(l.InterestPaid + l.PenalInterestPaid), AmountWordsLine: words, Ornaments: orn,
	}
	return docRun(tmpl, d, "release agreement")
}
