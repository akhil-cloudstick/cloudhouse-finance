package loan

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// BondOrnament is one row of the pledge agreement's schedule table, mirrors
// frontend/modules/loans/utils/indemnityBond.ts's IndemnityBondOrnament.
type BondOrnament struct {
	Name        string
	Purity      string
	GrossWeight float64
	NetWeight   float64
	Value       float64
}

// BondData carries everything the pledge agreement template needs, resolved
// from a Loan + its preloaded Customer/Branch/Ornaments (see Service.
// StartIndemnityBondSign) — mirrors the fields frontend/modules/loans/
// utils/indemnityBond.ts's printIndemnityBond() assembles, so the eSigned
// PDF matches what staff already see on the pre-save print preview.
type BondData struct {
	LoanNumber      string
	CustomerName    string
	Age             int // 0 means unknown (customer has no DOB on file) — rendered as a blank
	Address         string
	BranchName      string
	Phone           string
	PAN             string
	Aadhaar         string // full 12-digit number, decrypted on demand — see Service.bondDataForLoan
	PrincipalAmount float64
	InterestRate    float64
	Ornaments       []BondOrnament
	Day             int
	Month           string // full month name, e.g. "August"
	Year            int
	// BusinessName is the tenant's own display name (multi-tenancy plan,
	// Step 9) — populated by bondDataForLoan via Service.businessName, never
	// left as a hardcoded lender name in the template itself.
	BusinessName string
}

// blank is the placeholder used wherever the frontend template falls back
// to "________________" for a missing field.
const blank = "________________"

// lenderName/lenderRegNo are the fixed lender-side particulars printed on
// every pledge agreement — same fixed text as the branch's paper form,
// not driven by loan data.
const lenderName = "Rinkesh Lalitbhai Soni"
const lenderRegNo = "GMLVAL2627000029"

func orBlank(s string) string {
	if strings.TrimSpace(s) == "" {
		return blank
	}
	return s
}

func ageOrBlank(age int) string {
	if age <= 0 {
		return "____"
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

func rateOrBlank(rate float64) string {
	if rate <= 0 {
		return blank
	}
	return fmt.Sprintf("%g%%", rate)
}

// bondTemplate is the single English "Agreement of Pledge of Movable"
// template — the branch's standard pledge deed, replacing the old
// multi-language indemnity bond. Direct port of frontend/modules/loans/
// utils/indemnityBond.ts's printIndemnityBond(), same wording, same
// structure, wrapped in the same print.ts body/table/ol styling so the
// eSigned PDF matches what staff already see when printing it by hand.
var bondTemplate = template.Must(
	template.New("bond_en").Funcs(template.FuncMap{"inc": func(i int) int { return i + 1 }}).Parse(bondHTMLEnglish),
)

// bondPageStyle mirrors frontend/common/utils/print.ts's openPrintWindow
// stylesheet (minus the .noprint print button, irrelevant for a PDF render),
// but with a standard sans-serif body font (Mona Sans, falling back to each
// OS's own UI font) instead of that stylesheet's Georgia/serif — this
// template is bond-only, so the swap doesn't touch any other printed doc.
const bondPageStyle = `
body{font-family:'Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.55;font-size:14px;padding:0 20px}
h1{font-size:20px;text-align:center;margin:0 0 2px;letter-spacing:1px}
h2{font-size:15px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol li{margin-bottom:10px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
.sig div{flex:1;text-align:center}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
`

const bondHTMLEnglish = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Agreement of Pledge of Movable — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>AGREEMENT OF PLEDGE OF MOVABLE</h1>
<h2>Gold Loan Account No. {{.LoanNumber}}</h2>
<p>MEMORANDUM OF AGREEMENT, made the <b>{{printf "%02d" .Day}}</b> day of <b>{{.Month}}, {{.Year}}</b> BETWEEN</p>
<p>
<b>{{.CustomerName}}</b><br>
Age :- <b>{{.Age}}</b>, business :- {{.Blank}}<br>
Aadhar Card No. <b>{{.Aadhaar}}</b><br>
Pan Card No. <b>{{.PAN}}</b><br>
Residing at :- <b>{{.Address}}</b>
</p>
<p>(Hereinafter called &quot;the borrower&quot;) of the one part.</p>
<p>AND</p>
<p>
<b>{{.LenderName}}</b><br>
Age :- {{.Blank}}, business :- {{.Blank}}<br>
Aadhar Card No. {{.Blank}}<br>
Pan Card No. {{.Blank}}<br>
Residing at :- {{.Blank}}
</p>
<p>(Hereinafter called &quot;the lander&quot;) of the other part.</p>
<p>The lender carrying on business of money-lending under certificate of registration number <b>{{.LenderRegNo}}</b> of the other part.</p>
<p>The Money lender and borrower are collectively referred to as the &quot;Parties&quot;.</p>
<p><b>WHEREBY IT IS AGREED AS FOLLOWS</b></p>
<ol>
<li><b>Covenant to pay</b><br>In Consideration of the loan of Rs <b>{{.PrincipalAmount}}</b> advance by the lender to the borrower, the borrower hereby covenants with the lender that he will repay the said loan on or before {{.Blank}} with interest at <b>{{.InterestRate}}</b> percent per annum from the date of execution of this agreement.</li>
<li><b>Pledge Clause</b><br>The Lender has lent the sum of Rs <b>{{.PrincipalAmount}}</b> (the receipt of which the borrower hereby acknowledges) and borrower has delivered to the lender article belonging to the borrower and specified in the schedule hereto to be held by him as security for the repayment of the aforesaid loan in the manner herein provided,
<ol type="a">
<li><b>Right to Extraordinary Expenses</b> — The lender is entitled to receive from the borrower extraordinary expenses incurred by him for the preservation of the good pledged.</li>
<li><b>Expenses of Repairs</b> — The Expenses of keeping the said articles in a good state of repair and in proper working order.</li>
<li><b>Other Costs</b> — All other costs, charges and expenses (if any) which the lender may be entitled by law to add to his security.</li>
</ol>
</li>
<li><b>Lender's Liability for Losses</b><br>The Lander shall not liable to the borrower for any involuntary losses which may occur during his custody of the said articles (goods) or by reason of the sale thereof.</li>
<li><b>Right of Lender</b><br>The Borrower further covenants with the lender that in case any interest payable hereunder is not paid within 30 days after the due date, the whole sum hereby secured shall become payable at once, and in case of default in the payment of the principal money hereby secured with interest thereon on the aforesaid or in the performance of any of the covenants by the borrower hereinbefore contained the lender may enforce all or any of the remedies of a Pawnee provided by law provided that in case of sale of any part of the pledged property, a previous notice of two months shall be given to the borrower.</li>
<li><b>Power of Sale</b>
<ol type="a">
<li>The power of sale conferred by law on the lender shall be exercisable by public auction or private contract in respect of the entire articles in one lot or in several lots at the discretion of the lender;</li>
<li>Before exercising such power of sale as aforesaid the lender shall give at least two months' notice to the borrower.</li>
</ol>
<p>इसके साक्ष्य स्वरूप, मैंने/हमने यह क्षतिपूर्ति बंधपत्र आज <b>{{.Day}}</b> {{.Month}}, {{.Year}} को स्वेच्छा से एवं बिना किसी दबाव के निष्पादित किया है।</p>
<p>नाम: <b>{{.CustomerName}}</b><br>पता: <b>{{.Address}}</b></p>
<p>मोबाइल नं.: <b>{{.Phone}}</b></p>
</body></html>`

const bondHTMLGujarati = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>વળતર બોન્ડ — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>વળતર બોન્ડ (INDEMNITY BOND)</h1>
<p>તારીખ: {{printf "%02d" .Day}} / {{.MonthNum}} / {{.Year}}</p>
<p>પ્રતિ,<br>શાખા વ્યવસ્થાપકશ્રી,<br>{{.BusinessName}} (NBFC)<br>{{.BranchName}} શાખા</p>
<p><b>વિષય: ગોલ્ડ લોન એકાઉન્ટ નં. {{.LoanNumber}} અંગે વળતર બોન્ડ</b></p>
<p>હું/અમે, શ્રી/શ્રીમતી <b>{{.CustomerName}}</b>, ઉંમર <b>{{.Age}}</b> વર્ષ, રહેવાસી <b>{{.Address}}</b>, આથી સોગંદપૂર્વક જાહેર કરું/કરીએ છું/છીએ અને બાંહેધરી આપું/આપીએ છીએ કે:</p>
<ol>
<li>હું/અમે ઉપરોક્ત ગોલ્ડ લોન એકાઉન્ટના કાયદેસર લોનધારક (Borrower) છીએ.</li>
<li>ઉપરોક્ત ગોલ્ડ લોનની સુરક્ષા (Security) તરીકે મેં/અમે બેંક/NBFC પાસે સોનાના દાગીના/વસ્તુઓ ગીરવે મૂકેલ છે.</li>
<li>હું/અમે આથી જાહેર કરું/કરીએ છીએ કે બેંક/NBFC પાસે ગીરવે મૂકવામાં આવેલ તમામ સોનાના દાગીના/વસ્તુઓ મારા/અમારા કાયદેસરના અને સંપૂર્ણ માલિકીના છે. આ સોના પર અન્ય કોઈપણ વ્યક્તિનો માલિકી હક, હિત, દાવો, ગીરો, અધિકાર અથવા અન્ય કોઈ પ્રકારનો હક નથી.</li>
<li>હું/અમે વધુમાં જાહેર કરું/કરીએ છીએ કે ગીરવે મૂકવામાં આવેલ સોનું કાયદેસર રીતે પ્રાપ્ત કરાયેલ છે અને તે કોઈપણ ગેરકાયદેસર પ્રવૃત્તિ, ચોરી, છેતરપિંડી, ગુનાહિત કૃત્ય, મની લોન્ડરિંગ અથવા અન્ય કોઈ ગેરકાયદેસર સ્ત્રોતમાંથી પ્રાપ્ત થયેલ નથી.</li>
<li>ઉપરોક્ત સોનાની માલિકી, સ્ત્રોત, ગીરો અથવા તેની મુક્તિ સંબંધિત કોઈપણ પ્રકારના દાવા, વિવાદ, નુકસાન, જવાબદારી, ખર્ચ, કાનૂની કાર્યવાહી અથવા અન્ય પરિણામો માટે હું/અમે સંપૂર્ણપણે જવાબદાર રહીશ/રહીશું અને બેંક/NBFC તથા તેના અધિકારીઓ, કર્મચારીઓ અને પ્રતિનિધિઓને આવા તમામ નુકસાન, ખર્ચ અને જવાબદારીઓ સામે સંપૂર્ણ વળતર (Indemnity) આપવા તથા તેમને નિર્દોષ રાખવા સંમત છીએ.</li>
<li>જો ભવિષ્યમાં કોઈપણ વ્યક્તિ અથવા સંસ્થા ઉપરોક્ત સોનાની માલિકી, કબજો અથવા તેના સ્ત્રોત અંગે કોઈ દાવો, વાંધો અથવા કાનૂની કાર્યવાહી કરે, તો તે અંગેનો સંપૂર્ણ ખર્ચ, જવાબદારી અને તેનો નિકાલ હું/અમે મારી/અમારી જવાબદારી પર કરીશ/કરીશું અને તેનાથી બેંક/NBFCને થનારા તમામ નુકસાન, ખર્ચ અથવા જવાબદારીઓ માટે હું/અમે સંપૂર્ણ વળતર આપીશ/આપીશું.</li>
<li>હું/અમે જાહેર કરું/કરીએ છીએ કે આ બોન્ડમાં દર્શાવેલ તમામ વિગતો મારી/અમારી જાણ અને માન્યતા મુજબ સાચી, સંપૂર્ણ અને યથાર્થ છે. બેંક/NBFC આ ઘોષણા પર વિશ્વાસ રાખીને ગોલ્ડ લોન મંજૂર કરે છે અથવા ચાલુ રાખે છે તે બાબત મને/અમને સંપૂર્ણ જાણ છે.</li>
<li>આ વળતર બોન્ડ મારા/અમારા તેમજ મારા/અમારા કાનૂની વારસદારો, પ્રતિનિધિઓ, વહીવટદારો અને ઉત્તરાધિકારીઓ પર બંધનકર્તા રહેશે અને આ બોન્ડ હેઠળની તમામ જવાબદારીઓ પૂર્ણ ન થાય ત્યાં સુધી અમલમાં રહેશે.</li>
</ol>
<p><b>The Schedule herein referred to</b></p>
<table>
<thead><tr><th>Sr. no</th><th>Description of the Article</th><th>Carat</th><th class="num">Gross Weight</th><th class="num">Net Weight</th><th class="num">Estimated Value</th></tr></thead>
<tbody>
{{range $i, $o := .Ornaments}}<tr><td>{{inc $i}}</td><td>{{$o.Name}}</td><td>{{$o.Purity}}</td><td class="num">{{printf "%.1f" $o.GrossWeight}}</td><td class="num">{{printf "%.1f" $o.NetWeight}}</td><td class="num">{{printf "%.0f" $o.Value}}</td></tr>
{{else}}<tr><td colspan="6" style="text-align:center;color:#777">{{.Blank}}</td></tr>
{{end}}
</tbody>
</table>
<p><b>Total Estimated Value :- Rs. {{.TotalValue}}/-</b></p>
<p><b>Total Loan Advanced :- Rs. {{.PrincipalAmount}}/-</b></p>
<p>Place :- {{.BranchName}}</p>
<p>Date :- {{printf "%02d" .Day}} / {{.Month}} / {{.Year}}</p>
<div class="sig">
<div>The Borrower<span>Name: {{.CustomerName}}</span></div>
<div>The Lander<span>{{.LenderName}}</span></div>
</div>
<p style="margin-top:20px"><b>IN WITNESS WHEREOF Etc.</b></p>
<div class="sig">
<div><span>Name: {{.Blank}}<br>Residing at</span></div>
<div><span>Name: {{.Blank}}<br>Residing at</span></div>
</div>
</body></html>`

// bondTemplateData wraps BondData with the extra pre-formatted fields the
// template above references — kept separate from BondData itself so
// BondData stays a plain, easily-constructed value in service.go.
type bondTemplateData struct {
	BondData
	Style           template.CSS
	Blank           string
	LenderName      string
	LenderRegNo     string
	Age             string
	Aadhaar         string
	PAN             string
	Address         string
	BranchName      string
	PrincipalAmount string
	InterestRate    string
	TotalValue      string
}

// renderBondHTML executes the template against data, returning the full
// HTML document string ready to hand to RenderIndemnityBondPDF.
func renderBondHTML(data BondData) (string, error) {
	var totalValue float64
	for _, o := range data.Ornaments {
		totalValue += o.Value
	}
	td := bondTemplateData{
		BondData: BondData{
			LoanNumber: data.LoanNumber,
			Ornaments:  data.Ornaments,
			Day:        data.Day,
			Month:      data.Month,
			Year:       data.Year,
		},
		Style:           template.CSS(bondPageStyle),
		Blank:           blank,
		LenderName:      lenderName,
		LenderRegNo:     lenderRegNo,
		Age:             ageOrBlank(data.Age),
		Aadhaar:         aadhaarOrBlank(data.Aadhaar),
		PAN:             orBlank(data.PAN),
		Address:         orBlank(data.Address),
		BranchName:      orBlank(data.BranchName),
		PrincipalAmount: inrOrBlank(data.PrincipalAmount),
		InterestRate:    rateOrBlank(data.InterestRate),
		TotalValue:      inrOrBlank(totalValue),
	}
	td.CustomerName = orBlank(data.CustomerName)

	var sb strings.Builder
	if err := bondTemplate.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("pledge agreement: render template: %w", err)
	}
	return sb.String(), nil
}

// RenderIndemnityBondPDF renders the pledge agreement for the given loan/
// customer data into a PDF, via a headless Chromium tab driven by chromedp.
// Requires a Chrome/Chromium binary on the host; chromedp returns a clear
// error if none is found.
func RenderIndemnityBondPDF(data BondData) ([]byte, error) {
	html, err := renderBondHTML(data)
	if err != nil {
		return nil, err
	}

	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// base64, not template.URLQueryEscaper(html): QueryEscape encodes spaces
	// as "+", which is only meaningful inside an actual query string —
	// Chromium never decodes a data: URI's payload that way, so every space
	// in the bond rendered as a literal "+" (e.g. "AGREEMENT+OF+PLEDGE").
	// Base64 has no such ambiguity.
	encoded := base64.StdEncoding.EncodeToString([]byte(html))
	var pdfBytes []byte
	err = chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8;base64,"+encoded),
		chromedp.WaitReady("body"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			// A4 (8.27in x 11.69in), explicit rather than left to
			// PreferCSSPageSize -- Chromium's default paper size is US
			// Letter and headless PrintToPDF doesn't reliably honor a
			// page's own @page CSS. MarginTop/MarginBottom are
			// deliberately generous (vs. the ~0.4in default) to reserve
			// blank header/footer space on every printed page.
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(false).
				WithPaperWidth(8.27).
				WithPaperHeight(11.69).
				WithMarginTop(0.9).
				WithMarginBottom(0.8).
				WithMarginLeft(0.6).
				WithMarginRight(0.6).
				Do(ctx)
			if err != nil {
				return err
			}
			pdfBytes = buf
			return nil
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("pledge agreement: render PDF (is Chrome/Chromium installed and on PATH?): %w", err)
	}
	return pdfBytes, nil
}
