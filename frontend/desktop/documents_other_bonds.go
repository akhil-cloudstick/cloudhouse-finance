package main

// Offline personal loan bond and investment (debenture subscription) bond. The same templates the backend uses, filled from
// what this PC holds. Follows backend/modules/PersonalLoan/controllers/bond.go and Investment/controllers/investment_bond.go.
// As with the loan bond, only the last 4 digits of the Aadhaar are on this PC, so it is printed masked.

import (
	"fmt"
	"html/template"
	"math"
	"strings"
	"time"
)

// docPerson is the customer as this PC holds them (the customers local copy).
type docPerson struct {
	Name         string `json:"name"`
	FatherName   string `json:"fatherName"`
	Address      string `json:"address"`
	District     string `json:"district"`
	Village      string `json:"village"`
	Taluk        string `json:"taluk"`
	Place        string `json:"place"`
	PinCode      string `json:"pinCode"`
	Phone        string `json:"phone"`
	DOB          string `json:"dob"`
	Age          *int   `json:"age"`
	AadhaarLast4 string `json:"aadhaarLast4"`
}

type docPersonalLoan struct {
	LoanNumber      string  `json:"loanNumber"`
	PrincipalAmount float64 `json:"principalAmount"`
	InterestType    string  `json:"interestType"`
	InterestValue   float64 `json:"interestValue"`
	OpenedDate      string  `json:"openedDate"`
	DisbursedAt     string  `json:"disbursedAt"`
}

type docInvestment struct {
	InvestmentNumber    string  `json:"investmentNumber"`
	PrincipalAmount     float64 `json:"principalAmount"`
	InterestRatePercent float64 `json:"interestRatePercent"`
	InterestRateType    string  `json:"interestRateType"`
	PayoutFrequency     string  `json:"payoutFrequency"`
	TenureMonths        int     `json:"tenureMonths"`
	MaturityDate        string  `json:"maturityDate"`
	StartDate           string  `json:"startDate"`
}

const docPLBlank template.HTML = `<span class="blank">..................</span>`

func docPLOrBlank(s string) template.HTML {
	if strings.TrimSpace(s) == "" {
		return docPLBlank
	}
	return template.HTML(template.HTMLEscapeString(s)) //nolint:gosec // escaped above
}

type docPLBondData struct {
	LoanNumber string
	Day        int
	Month      string
	Year       int
}

type docPLBondTemplate struct {
	docPLBondData
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

const docPLBondStyle = `
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
`

func docPLEstablishment(address, regNo, lang string) template.HTML {
	var parts []string
	if address != "" {
		parts = append(parts, template.HTMLEscapeString(address))
	}
	if lang != "ml" {
		if regNo != "" {
			parts = append(parts, "functioning under Registration No. M L L No: "+template.HTMLEscapeString(regNo))
		}
		if len(parts) == 0 {
			return ""
		}
		return template.HTML(strings.Join(parts, ", ") + ",") //nolint:gosec // every part is escaped above
	}
	if regNo != "" {
		parts = append(parts, "M L L No: "+template.HTMLEscapeString(regNo)+" രജിസ്റ്റർ നമ്പറിൽ പ്രവർത്തിച്ചുവരുന്ന")
	}
	return template.HTML(strings.Join(parts, " ")) //nolint:gosec // every part is escaped above
}

func docPersonalLoanBond(in docInput, lang string) (string, error) {
	file := "personal_loan_bond_english.html"
	if lang == "ml" {
		file = "personal_loan_bond_malayalam.html"
	} else {
		lang = "en"
	}
	tmpl, err := docTemplate(file)
	if err != nil {
		return "", err
	}
	l, c, p := in.PersonalLoan, in.Person, in.Profile
	age := docAgeFromDOB(c.DOB, time.Now())
	if age == 0 && c.Age != nil && *c.Age > 0 {
		age = *c.Age
	}
	rate := 0.0
	if l.InterestType == "Percentage" {
		rate = l.InterestValue
	}
	signed := docTime(l.OpenedDate)
	if signed.IsZero() {
		signed = docTime(l.DisbursedAt)
	}
	if signed.IsZero() {
		signed = time.Now()
	}
	aadhaar := ""
	if c.AadhaarLast4 != "" {
		aadhaar = "XXXX XXXX " + c.AadhaarLast4
	}
	html := func(v string) template.HTML { return docPLOrBlank(v) }
	ageH := docPLBlank
	if age > 0 {
		ageH = template.HTML(fmt.Sprintf("%d", age))
	}
	amountH := docPLBlank
	if l.PrincipalAmount > 0 {
		amountH = template.HTML(fmt.Sprintf("%.0f", l.PrincipalAmount))
	}
	rateH := docPLBlank
	if rate > 0 {
		rateH = template.HTML(fmt.Sprintf("%g%%", rate))
	}
	td := docPLBondTemplate{
		docPLBondData:        docPLBondData{LoanNumber: l.LoanNumber, Day: signed.Day(), Month: signed.Month().String(), Year: signed.Year()},
		Style:                template.CSS(docPLBondStyle),
		Blank:                docPLBlank,
		FinancierName:        html(docFirst(p.LegalName, p.Name)),
		EstablishmentAddress: docPLEstablishment(docNormalizeBreaks(p.AddressLine), p.KMLRegNo, lang),
		Age:                  ageH,
		Aadhaar:              html(aadhaar),
		Address:              html(c.Address),
		District:             html(c.District),
		Village:              html(c.Village),
		Taluk:                html(c.Taluk),
		Place:                html(c.Place),
		PinCode:              html(c.PinCode),
		FatherName:           html(c.FatherName),
		Mobile:               html(c.Phone),
		PrincipalAmount:      amountH,
		InterestRate:         rateH,
		BorrowerName:         html(c.Name),
	}
	return docRun(tmpl, td, "personal loan bond")
}

// ---- investment (debenture subscription) bond ----------------------------------------------------------------

func docThousands(n float64) string {
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

func docInvDate(t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	return t.Format("02 January 2006")
}

func docMathPow(base, exp float64) float64 {
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

type docInvBondTemplate struct {
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

const docInvBondStyle = `
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
`

func docInvestmentBond(in docInput) (string, error) {
	tmpl, err := docTemplate("debenture_subscription_agreement.html")
	if err != nil {
		return "", err
	}
	inv, c, p := in.Investment, in.Person, in.Profile
	rateDisplay := fmt.Sprintf("%.2f%% p.a. (%s)", inv.InterestRatePercent, inv.InterestRateType)
	tenureDisplay := fmt.Sprintf("%d Months", inv.TenureMonths)
	if inv.TenureMonths%12 == 0 {
		years := inv.TenureMonths / 12
		unit := "Year"
		if years != 1 {
			unit = "Years"
		}
		tenureDisplay = fmt.Sprintf("%d Months (%d %s)", inv.TenureMonths, years, unit)
	}
	years := float64(inv.TenureMonths) / 12
	var projected float64
	if inv.InterestRateType == "Compound" {
		projected = inv.PrincipalAmount*docMathPow(1+inv.InterestRatePercent/100, years) - inv.PrincipalAmount
	} else {
		projected = inv.PrincipalAmount * (inv.InterestRatePercent / 100) * years
	}
	dash := func(s string) string {
		if strings.TrimSpace(s) == "" {
			return "—"
		}
		return s
	}
	amount := func(n float64) string { return "₹" + docThousands(n) }
	td := docInvBondTemplate{
		InvestmentNumber: inv.InvestmentNumber, CustomerName: dash(c.Name), CustomerAddress: dash(c.Address),
		LenderName: docFirst(p.LegalName, "the Company"), LenderAddress: docFirst(docNormalizeBreaks(p.AddressLine), "its registered office"),
		IssuerCity: "Kochi, Kerala", AgreementDate: docInvDate(docTime(inv.StartDate)), FaceValuePerUnit: amount(1000),
		PrincipalAmount: amount(inv.PrincipalAmount), InterestRateDisplay: rateDisplay, PayoutFrequency: inv.PayoutFrequency,
		TenureDisplay: tenureDisplay, MaturityDate: docInvDate(docTime(inv.MaturityDate)), ProjectedReturn: amount(math.Round(projected*100) / 100),
		GeneratedOn: docInvDate(time.Now()),
	}
	return docRun(tmpl, struct {
		docInvBondTemplate
		Style template.CSS
	}{td, template.CSS(docInvBondStyle)}, "debenture subscription agreement")
}
