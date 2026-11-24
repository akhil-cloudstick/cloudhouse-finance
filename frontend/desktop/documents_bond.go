package main

// Offline pledge agreement (indemnity bond). The same templates and page styles the backend uses, filled from the loan this
// PC holds. Follows backend/modules/Loan/controllers/indemnity_bond.go and tml_documents.go: keep them in step.
//
// What differs from the server's PDF: only the last 4 digits of a customer's Aadhaar are on this PC (the full number is
// encrypted on the server), so it is printed masked; the customer / ornament photos and the logo of the TML sheet are left
// blank.

import (
	"encoding/base64"
	"fmt"
	"html/template"
	"math"
	"strings"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

const docBondBlank = "                "

type docBondOrnament struct {
	Name        string
	Quantity    int
	Purity      string
	GrossWeight float64
	NetWeight   float64
	Value       float64
}

type docBondDisbursement struct {
	Date    time.Time
	Amount  float64
	Initial bool
}

type docBondDistRow struct {
	Date    string
	Amount  string
	Initial bool
}

type docBondItem struct {
	Name string
	Qty  int
}

// docBondData is BondData of the backend.
type docBondData struct {
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
	Ornaments       []docBondOrnament
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
	Disbursements   []docBondDisbursement
	Witness1Name    string
	Witness2Name    string
	OpenedDate      time.Time
	CreatedByName   string
	Brand           string
	Phones          string
	CustomerPhoto   template.URL
	OverallPhoto    template.URL
	Logo            template.URL
}

// docBondTemplateData is bondTemplateData of the backend (the embedded data is overridden by the display strings).
type docBondTemplateData struct {
	docBondData
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
	Distribution       []docBondDistRow
	LoanDateDisplay    string
	PrintTime          string
	Items              []docBondItem
	GrossTotal         string
	NetTotal           string
	ReceiptAmount      string
	TotalQty           int
	PacketQR           template.URL
	PrintClock         string
	PadRows            []int
	AddressLines       []string
}

func docOrBlank(s string) string {
	if strings.TrimSpace(s) == "" {
		return docBondBlank
	}
	return s
}

func docAgeFromDOB(dob string, now time.Time) int {
	t := docTime(dob)
	if t.IsZero() || t.Year() <= 1900 {
		return 0
	}
	age := now.Year() - t.Year()
	if now.YearDay() < t.YearDay() {
		age--
	}
	if age < 0 || age > 130 {
		return 0
	}
	return age
}

func docQR(text string) template.URL {
	png, err := qrcode.Encode(text, qrcode.Medium, 256)
	if err != nil {
		return ""
	}
	return template.URL("data:image/png;base64," + base64.StdEncoding.EncodeToString(png)) //nolint:gosec // generated PNG + base64 only
}

func docLenderAadhaar(aadhaar string) string {
	if len(aadhaar) != 12 {
		return "XXXX XXXX XXXX"
	}
	return aadhaar[0:4] + " " + aadhaar[4:8] + " " + aadhaar[8:12]
}

const docTmlZoomFrom = 11

func docTmlZoomCSS(items int, policy string) string {
	if policy != "TML" {
		return ""
	}
	css := ""
	if items > 5 {
		css += "\n.items.main td,.items.main th{padding-top:1px;padding-bottom:1px}.items.main td{font-size:12.5px;line-height:16px}.mid{margin-top:12px}.pay{margin-top:18px}.recv{margin-top:6px}.foot{margin-top:10px}.cut{margin:4px 0 5px}"
	}
	switch {
	case items <= 7:
	case items <= 10:
		css += "\n.orn{font-size:11.5px;line-height:14px}.orn u{font-size:13px}"
	case items <= 12:
		css += "\n.orn{left:210px;width:124px;font-size:10px;line-height:12.5px}.orn u{font-size:12px}"
	default:
		css += "\n.orn{left:210px;width:122px;font-size:9px;line-height:11.5px;column-count:2;column-gap:4px}.orn u{font-size:11px;display:block;column-span:all}.orn .oi{break-inside:avoid}"
	}
	if items >= docTmlZoomFrom {
		z := math.Max(0.85, 1-0.02*float64(items-docTmlZoomFrom+1))
		css += fmt.Sprintf("\nbody{zoom:%.2f}", z)
	}
	return css
}

// docBondFile picks the template and style the backend would: by the business's policy and the language asked for.
func docBondFile(policy, lang string) (file, style string) {
	switch policy {
	case "GML":
		if lang == "gu" {
			return "gml_bond_gujarati.html", bondStyleGu
		}
		return "gml_bond_english.html", bondStyleEn
	case "TML":
		if lang == "ta" {
			return "tml_bond_tamil.html", bondStyleTml
		}
		return "tml_bond_english.html", bondStyleTml
	}
	if lang == "ml" {
		return "kml_bond_malayalam.html", bondStyleMl
	}
	return "kml_bond_english.html", bondStyleEn
}

func docBond(in docInput, lang string) (string, error) {
	l, p := in.Loan, in.Profile
	policy := strings.ToUpper(docFirst(p.Policy, "KML"))
	if policy != "GML" && policy != "TML" {
		policy = "KML"
	}
	file, style := docBondFile(policy, lang)
	tmpl, err := docTemplate(file)
	if err != nil {
		return "", err
	}
	now := time.Now()
	age := docAgeFromDOB(l.Customer.DOB, now)
	if age == 0 && l.Customer.Age != nil && *l.Customer.Age > 0 {
		age = *l.Customer.Age
	}
	orn := make([]docBondOrnament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		orn = append(orn, docBondOrnament{Name: o.Name, Quantity: o.Quantity, Purity: o.Purity, GrossWeight: o.GrossWeight, NetWeight: o.NetWeight, Value: o.GoldValue})
	}
	aadhaar := l.Customer.Aadhaar
	if aadhaar == "" && l.Customer.AadhaarLast4 != "" {
		aadhaar = "XXXX XXXX " + l.Customer.AadhaarLast4
	}
	addressLine := docNormalizeBreaks(p.AddressLine)
	place := l.Branch.Name
	if in.SingleBranch && addressLine != "" {
		place = addressLine
	}
	data := docBondData{
		OpenedDate: docTime(l.OpenedDate), Brand: p.BrandColor, Phones: p.ContactPhone,
		LoanNumber: l.LoanNumber, CustomerName: l.Customer.Name, Age: age, Address: l.Customer.Address, BranchName: place,
		Phone: l.Customer.Phone, PAN: l.Customer.PAN, Aadhaar: aadhaar, PrincipalAmount: l.PrincipalAmount, InterestRate: l.SchemeInterestRate,
		Ornaments: orn, Day: now.Day(), Month: now.Month().String(), Year: now.Year(),
		BusinessName: docFirst(p.Name, "Gold Loan Statement"), LegalName: p.LegalName, AddressLine: addressLine, KMLRegNo: p.KMLRegNo,
		LenderAge: p.LenderAge, LenderPAN: p.LenderPan, LenderAadhaar: p.LenderAadhaar, Policy: policy, DueDate: docTime(l.DueDate),
	}
	// the initial amount and each paid-out top-up, as the backend lists them under the agreement
	if ups := docActiveTopUps(l); len(ups) > 0 {
		initial := l.PrincipalAmount
		for _, t := range ups {
			initial -= t.Amount
		}
		data.Disbursements = append(data.Disbursements, docBondDisbursement{Date: docTime(l.OpenedDate), Amount: math.Max(math.Round(initial*100)/100, 0), Initial: true})
		for _, t := range ups {
			data.Disbursements = append(data.Disbursements, docBondDisbursement{Date: docTime(t.OccurredOn), Amount: t.Amount})
		}
	}

	var totalValue float64
	for _, o := range data.Ornaments {
		totalValue += o.Value
	}
	itemNames := make([]string, 0, len(data.Ornaments))
	itemWeights := make([]string, 0, len(data.Ornaments))
	for _, o := range data.Ornaments {
		itemNames = append(itemNames, o.Name)
		itemWeights = append(itemWeights, docWeight(o.NetWeight)+" GM")
	}
	itemNamesStr := strings.Join(itemNames, ", ")
	if itemNamesStr == "" {
		itemNamesStr = docBondBlank
	}
	itemWeightsStr := strings.Join(itemWeights, ", ")
	if itemWeightsStr == "" {
		itemWeightsStr = docBondBlank
	}
	money0 := func(v float64) string {
		if v <= 0 {
			return docBondBlank
		}
		return fmt.Sprintf("%.0f", v)
	}
	ageStr := docBondBlank
	if data.Age > 0 {
		ageStr = fmt.Sprintf("%d", data.Age)
	}
	rateStr := docBondBlank
	if data.InterestRate > 0 {
		rateStr = fmt.Sprintf("%g%%", data.InterestRate)
	}
	dueStr := docBondBlank
	if !data.DueDate.IsZero() {
		dueStr = data.DueDate.Format("02-01-2006")
	}
	monthAbbrev := data.Month
	if len(monthAbbrev) > 3 {
		monthAbbrev = monthAbbrev[:3]
	}
	td := docBondTemplateData{
		docBondData:        data,
		Style:              template.CSS(":root{--brand:" + string(docBrand(data.Brand)) + "}" + style + docTmlZoomCSS(len(data.Ornaments), data.Policy)),
		Blank:              docBondBlank,
		LenderName:         docFirst(data.LegalName, data.BusinessName, "CloudHouse Finance"),
		LenderRegNo:        docFirst(data.KMLRegNo, "DEMO-0000000000"),
		LenderAge:          docFirst(data.LenderAge, "—"),
		LenderBusiness:     docFirst(data.LegalName, data.BusinessName, "CloudHouse Finance"),
		LenderAadhaar:      docLenderAadhaar(data.LenderAadhaar),
		LenderPAN:          docFirst(data.LenderPAN, "AAAAA0000A"),
		LenderAddress:      docOrBlank(data.AddressLine),
		LenderAddressShort: strings.TrimSpace(data.AddressLine),
		Age:                ageStr,
		Aadhaar:            docOrBlank(data.Aadhaar),
		PAN:                docOrBlank(data.PAN),
		Address:            docOrBlank(data.Address),
		BranchName:         docOrBlank(data.BranchName),
		PrincipalAmount:    money0(data.PrincipalAmount),
		InterestRate:       rateStr,
		TotalValue:         money0(totalValue),
		Mobile:             docOrBlank(data.Phone),
		DateDisplay:        fmt.Sprintf("%02d %s %d", data.Day, strings.ToUpper(monthAbbrev), data.Year),
		ItemNames:          itemNamesStr,
		ItemWeights:        itemWeightsStr,
		AmountWords:        docWords(data.PrincipalAmount),
		DueDate:            dueStr,
	}
	td.CustomerName = docOrBlank(data.CustomerName)
	td.LoanDateDisplay = now.Format("02-01-2006")
	if !data.OpenedDate.IsZero() {
		td.LoanDateDisplay = data.OpenedDate.Format("02-01-2006")
	}
	td.PrintTime = now.Format("02-01-2006 03:04 PM")
	td.PacketQR = docQR(data.LoanNumber)
	for _, ln := range strings.Split(strings.TrimSpace(data.AddressLine), "\n") {
		if ln = strings.TrimSpace(ln); ln != "" {
			td.AddressLines = append(td.AddressLines, ln)
		}
	}
	td.PrintClock = now.Format("03:04 PM")
	var gross, net float64
	for _, o := range data.Ornaments {
		qty := o.Quantity
		if qty < 1 {
			qty = 1
		}
		td.Items = append(td.Items, docBondItem{Name: o.Name, Qty: qty})
		td.TotalQty += qty
		gross += o.GrossWeight
		net += o.NetWeight
	}
	for i := len(td.Items); i < 4; i++ {
		td.PadRows = append(td.PadRows, i)
	}
	td.GrossTotal = docWeight(gross)
	td.NetTotal = docWeight(net)
	td.ReceiptAmount = fmt.Sprintf("%.2f", data.PrincipalAmount)
	for _, d := range data.Disbursements {
		td.Distribution = append(td.Distribution, docBondDistRow{Date: d.Date.Format("02/01/2006"), Amount: fmt.Sprintf("%.0f", d.Amount), Initial: d.Initial})
	}
	return docRun(tmpl, td, "pledge agreement")
}

func docActiveTopUps(l docLoan) []docTopUp {
	var ups []docTopUp
	for _, t := range l.TopUps {
		if t.Status == "" || t.Status == "Active" {
			ups = append(ups, t)
		}
	}
	return ups
}
