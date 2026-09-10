package loan

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"math"
	"regexp"
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

// lenderName/lenderRegNo and the rest are the fixed lender-side particulars
// printed on every pledge agreement — same fixed text as the branch's paper
// form, not driven by loan data.
//
// DEMO PLACEHOLDERS. These identify the lender on a document the borrower
// signs, and the set includes an Aadhaar and a PAN, so they must be replaced
// with the licensee's real particulars before any agreement is executed. The
// values below are deliberately non-resolvable: the Aadhaar is masked rather
// than a 12-digit number that could belong to someone, and the PAN is the
// conventional all-A dummy. Nothing here is wired to config yet; if a
// business-profile table is ever added, move all eight into it.
const lenderName = "CloudHouse Gold Finance"
const lenderRegNo = "DEMO-MLL-0000000000"
const lenderAge = "—"
const lenderBusiness = "CloudHouse Gold Finance"
const lenderAadhaar = "XXXX XXXX XXXX"
const lenderPAN = "AAAAA0000A"
const lenderAddress = "Demo Registered Office, Door No. 0/000, Demo Village, Demo Taluk, Ernakulam District, Kerala, PIN 000000"

// lenderAddressShort/lenderKMLRegNo are the SAME establishment's particulars
// in the short, uppercase letterhead form the two bond templates print in
// their heading, distinct from lenderAddress/lenderRegNo's longer descriptive
// form used in the formal English pledge deed's prose.
//
// DEMO PLACEHOLDERS, on the same terms as the block above — replace with the
// licensee's real registered address and KML/MLL registration number before
// any agreement is executed. Note the heading renders these as "KML Reg No:
// {{.LenderRegNo}}", so lenderKMLRegNo is the bare-number form of
// lenderRegNo, without its "DEMO-MLL-" prefix.
const lenderAddressShort = "DOOR NO. 0/000, DEMO VILLAGE, 000000"
const lenderKMLRegNo = "DEMO-0000000000"

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

// monthAbbrev returns month's first 3 characters ("September" -> "Sep"),
// for bondHTMLMalayalam's "04 SEP 2025"-style DateDisplay — matching the
// branch's own reference letter's date format exactly. Falls back to the
// full string if it's already 3 characters or shorter (defensive only;
// BondData.Month is always a full month name in practice).
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

// onesWords/tensWords/twoDigitWords/threeDigitWords/amountInWords convert a
// rupee amount to English words using Indian numbering (crore/lakh/
// thousand) — mirrors frontend/common/utils/numberToWords.ts's
// numberToIndianWords exactly, so the printed paper copy and the eSigned
// PDF never disagree on the amount-in-words line. bondHTMLMalayalam's own
// reference letter states this figure in English even mid-Malayalam-text
// (e.g. "( Fifteen Thousand only )"), so this is deliberately NOT
// transliterated to Malayalam.
var onesWords = [20]string{
	"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
	"Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
	"Seventeen", "Eighteen", "Nineteen",
}
var tensWords = [10]string{"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"}

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

// bondTemplate is the English translation of bondHTMLMalayalam's own
// promissory-pledge letter (see that template's own doc comment) — same
// wording/structure as the Malayalam version, just in English, rather than
// the old formal "MEMORANDUM OF AGREEMENT... BETWEEN" numbered-clause deed
// this used to be (a document that had, in fact, drifted into a
// syntactically-broken state — stray untranslated Hindi text mid-document,
// missing closing tags, an ornament-schedule table that never rendered —
// before this replacement). Direct port of frontend/modules/loans/utils/
// indemnityBond.ts's printIndemnityBond() "en" branch, same wording, same
// structure, so the eSigned PDF matches what staff already see when
// printing it by hand.
var bondTemplate = template.Must(
	template.New("bond_en").Funcs(template.FuncMap{"inc": func(i int) int { return i + 1 }}).Parse(bondHTMLEnglish),
)

// bondTemplateMl is the Malayalam "ആഭരണ പണയ കരാർ" (Ornament Pledge
// Agreement) template — replaces the branch's old Gujarati paper form
// (that business has no relation to this branch; see lenderName's own doc
// comment) with one modeled on the branch's ACTUAL Malayalam reference
// form. Staff choose which language to print/eSign per loan (see
// StartIndemnityBondSign's lang parameter).
var bondTemplateMl = template.Must(
	template.New("bond_ml").Funcs(template.FuncMap{"inc": func(i int) int { return i + 1 }}).Parse(bondHTMLMalayalam),
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
/* Forces the signature/witness block onto its own final page and pins it
 * to the bottom of that page's printable area — the same corner
 * RenderIndemnityBondPDF's caller stamps the Aadhaar eSign signature onto
 * (position "bottom-right" of the last page, see service.go's
 * StartIndemnityBondSign). Without this the block renders wherever it
 * naturally falls (often near the top of an otherwise-blank last page),
 * leaving a big gap between the signature text and the eSign stamp below
 * it. min-height is the paper's content-box height (11.69in - 0.9in top
 * margin - 0.8in bottom margin ≈ 254mm) minus a safety margin, so it never
 * overflows onto a spurious extra page.
 */
.sig-page{page-break-before:always;min-height:240mm;display:flex;flex-direction:column;justify-content:flex-end}
`

// bondPageStyleMalayalam is bondPageStyle with a font stack that leads with
// a Malayalam-capable face — 'Mona Sans'/plain system-ui has no Malayalam
// glyphs, so Chromium would otherwise fall back to tofu boxes for every
// character. Requires "Noto Sans Malayalam" (or "Nirmala UI") actually
// installed on the host running chromedp — same requirement as internal/
// personalloan/bond.go's own Malayalam template; without it the PDF still
// renders, just via whatever fallback glyphs the OS ships.
const bondPageStyleMalayalam = `
body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.7;font-size:14px;padding:0 20px}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:.3px}
h2{font-size:14px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol{padding-left:22px} ol li{margin-bottom:12px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
.sig div{flex:1;text-align:center}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
/* See bondPageStyle's .sig-page comment — same fix, Malayalam template. */
.sig-page{page-break-before:always;min-height:240mm;display:flex;flex-direction:column;justify-content:flex-end}
`

const bondHTMLEnglish = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>{{.LenderName}} — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>{{.LenderName}}</h1>
<h2>{{.LenderAddressShort}}<br>KML Reg No: {{.LenderRegNo}}</h2>

<table style="border:none;margin:16px 0">
<tr>
<td style="border:none;width:50%">ITEM NAME: {{.ItemNames}}<br>ITEM Weight: {{.ItemWeights}}</td>
<td style="border:none">Loan No. {{.LoanNumber}}<br>Date: {{.DateDisplay}}</td>
</tr>
</table>

<p>CUSTOMER NAME: {{.CustomerName}}<br>CUSTOMER MOB NO: {{.Mobile}}</p>
<p>AMOUNT: {{.PrincipalAmount}}</p>

<p>
I, <b>{{.CustomerName}}</b>, declare that the gold ornaments shown above are my own property and no one else has any claim to them. I have pledged these ornaments with your establishment, <b>{{.LenderName}}</b>, and hereby humbly request that a loan of Rs. <b>{{.PrincipalAmount}}</b> ( {{.AmountWords}} only ), equal to the appraised value of the ornaments, be granted to me at monthly interest.
</p>
<p>Name: {{.CustomerName}}<br>Signature: {{.Blank}}</p>

<h3 style="text-align:center;margin-top:30px">DECLARATION</h3>

<p>
I, <b>{{.CustomerName}}</b>, undertake to pay the interest on the loan of Rs. <b>{{.PrincipalAmount}}</b> availed by me every month without fail, and assure that I will close the loan by repaying the full amount along with interest within one year. If for any reason I am unable to repay the borrowed money with interest, I hereby agree that the owner of <b>{{.LenderName}}</b> shall have the right to auction or sell these ornaments to recover any loss incurred by the establishment, and that I will not raise any claim regarding this thereafter.
</p>

<div class="sig-page">
<p>Name: {{.CustomerName}}<br>Signature: {{.Blank}}</p>
<p style="margin-top:18px"><b>Loan Sanctioned.</b></p>
<p>Date: {{.DateDisplay}}</p>

<hr style="margin-top:40px;border:none;border-top:1px solid #999">
<p style="margin-top:24px"><b>Signature of the person who receives the jewellery back</b></p>
<p>Ornaments received back without any damage.</p>
<p>Date: {{.Blank}}<br>Name: {{.CustomerName}}<br>Signature: {{.Blank}}</p>
</div>
</body></html>`

// bondHTMLMalayalam is the Malayalam "ആഭരണ പണയ കരാർ" (Ornament Pledge
// Agreement) — same clause structure/order/coverage as bondHTMLEnglish
// (a "വാഗ്‌ദത്തം"/promissory-pledge letter, not the formal "MEMORANDUM OF
// AGREEMENT... BETWEEN" numbered-clause deed bondHTMLEnglish uses) —
// verbatim from the branch's own actual reference letter (a filled
// specimen for Loan No. A174, "SANJU R S"), parameterized here for the
// current loan/customer.
//
// Structurally simpler than bondHTMLEnglish: no separate ornament-schedule
// table, no numbered legal clauses (extraordinary expenses, power of sale,
// interpretation clause, etc.) — just the two paragraphs the reference
// letter actually has (an ownership declaration + loan request, then a
// repayment promise with a sale-on-default clause), followed by a built-in
// release-acknowledgment section ("Signature of the person who receives
// the jewellery back / കേടുപാടുകളില്ലാതെ ആഭരണങ്ങൾ തിരികെ ലഭിച്ചു") — this
// ONE document is what's used for both the pledge bond (print/eSign) and
// the release agreement, matching the reference letter's own single-page
// design.
//
// The lender is identified by establishment only (name + KML registration
// + registered address, in the letter's own short letterhead form — see
// lenderAddressShort/lenderKMLRegNo) — no individual proprietor's personal
// age/Aadhaar/PAN, matching that reference form exactly.
const bondHTMLMalayalam = `<!DOCTYPE html><html lang="ml"><head><meta charset="UTF-8"><title>{{.LenderName}} — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>{{.LenderName}}</h1>
<h2>{{.LenderAddressShort}}<br>KML Reg No: {{.LenderRegNo}}</h2>

<table style="border:none;margin:16px 0">
<tr>
<td style="border:none;width:50%">ITEM NAME: {{.ItemNames}}<br>ITEM Weight: {{.ItemWeights}}</td>
<td style="border:none">Loan No. {{.LoanNumber}}<br>Date: {{.DateDisplay}}</td>
</tr>
</table>

<p>CUSTOMER NAME: {{.CustomerName}}<br>CUSTOMER MOB NO: {{.Mobile}}</p>
<p>AMOUNT: {{.PrincipalAmount}}</p>

<p>
ഞാൻ <b>{{.CustomerName}}</b> മുകളിൽ കാണിച്ചിട്ടുള്ള സ്വർണ്ണാഭരണങ്ങൾ എന്റെ സ്വന്തമാണ്. ഇതിന് വേറെ അവകാശികളില്ല. ഈ ആഭരണങ്ങൾ നിങ്ങളുടെ <b>{{.LenderName}}</b> എന്ന സ്ഥാപനത്തിൽ പണയംസ്വീകരിച്ച് ആഭരണത്തിൻ്റെ മതിപ്പുവിലയായ <b>{{.PrincipalAmount}}</b> രൂപ ( {{.AmountWords}} only ) മാസപലിശയ്ക്ക് വായ്‌പയായി തരണമെന്ന് വിനീതമായി അപേക്ഷിക്കുന്നു.
</p>
<p>Name: {{.CustomerName}}<br>Signature: {{.Blank}}</p>

<h3 style="text-align:center;margin-top:30px">വാഗ്‌തദത്തം</h3>

<p>
ഞാൻ <b>{{.CustomerName}}</b> വായ്‌പയായി വാങ്ങിയ <b>{{.PrincipalAmount}}</b> രൂപയുടെ പലിശ മാസാമാസം അടച്ചുതീർത്തു കൊള്ളാമെന്നും, ഒരു വർഷത്തിനുള്ളിൽ മുഴുവൻ തുകയും പലിശയും അടച്ചുതീർത്ത് വായ്‌പ അവസാനിപ്പിക്കുമെന്ന് ഉറപ്പുതരുന്നു. ഏതെങ്കിലും കാരണവശാൽ വായ്‌പവാങ്ങിയ പണം പലിശയോടുകൂടി തിരിച്ചടക്കാൻ എനിക്കു സാധിക്കാതെവന്നാൽ നിങ്ങളുടെ <b>{{.LenderName}}</b> എന്ന സ്ഥാപനത്തിനുവരുന്ന കഷ്ടനഷ്ടങ്ങൾ തീർക്കാൻ, ഈ ആഭരണങ്ങൾ ലേലത്തിൽ വയ്ക്കുകയോ അല്ലെങ്കിൽ വിൽക്കുകയോ ചെയ്ത് സ്ഥാപനത്തിന്റെ നഷ്ടം തീർക്കാൻ സ്ഥാപന ഉടമയ്ക്ക് അവകാശമുണ്ടെന്നും പിന്നീട് ഇതുമായി ഒരു അവകാശവാദവും ഉന്നയിക്കില്ലെന്നും ഞാൻ ഇതിനാൽ വാഗ്ദാനം ചെയ്യുന്നു.
</p>

<div class="sig-page">
<p>Name: {{.CustomerName}}<br>Signature: {{.Blank}}</p>
<p style="margin-top:18px"><b>Loan Sanctioned.</b></p>
<p>Date: {{.DateDisplay}}</p>

<hr style="margin-top:40px;border:none;border-top:1px solid #999">
<p style="margin-top:24px"><b>Signature of the person who receives the jewellery back</b></p>
<p>കേടുപാടുകളില്ലാതെ ആഭരണങ്ങൾ തിരികെ ലഭിച്ചു</p>
<p>Date: {{.Blank}}<br>Name: {{.CustomerName}}<br>Signature: {{.Blank}}</p>
</div>
</body></html>`

// bondTemplateData wraps BondData with the extra pre-formatted fields the
// template above references — kept separate from BondData itself so
// BondData stays a plain, easily-constructed value in service.go.
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
	// Mobile/DateDisplay/ItemNames/ItemWeights/AmountWords back
	// bondHTMLMalayalam only (see its own doc comment) — bondHTMLEnglish
	// doesn't reference them.
	Mobile      string
	DateDisplay string
	ItemNames   string
	ItemWeights string
	AmountWords string
}

// BondLangEnglish/BondLangMalayalam are the two pledge-agreement languages
// StartIndemnityBondSign/RenderIndemnityBondPDF accept — kept as named
// constants rather than bare "en"/"gu" strings so every switch on lang
// (here and in service.go) stays in sync if a third language is ever added.
const (
	BondLangEnglish  = "en"
	BondLangMalayalam = "ml"
)

// BondDeliverOpen/WhatsApp/Dashboard are the ways the signing URL created by
// StartIndemnityBondSign can reach the customer, chosen by staff at eSign
// time (see the deliverBy parameter):
//   - Open: URL returned to the caller only, unchanged from before this
//     existed — staff open it themselves and hand the device over.
//   - WhatsApp: also sent as a WhatsApp message to the customer's own phone
//     via platform.SMSSender (OpenWA) — see Service.deliverEsignLink.
//   - Dashboard: also pushed as an in-app Notification the customer-mobile
//     app renders as an actionable card, independent of WhatsApp.
const (
	BondDeliverOpen      = "open"
	BondDeliverWhatsApp  = "whatsapp"
	BondDeliverDashboard = "dashboard"
)

// renderBondHTML executes the template for the requested language against
// data, returning the full HTML document string ready to hand to
// RenderIndemnityBondPDF. lang must be BondLangEnglish or BondLangMalayalam —
// callers (StartIndemnityBondSign) are expected to have already validated
// it, so an unrecognized value here is a programming error, not user input,
// and falls back to English rather than panicking.
func renderBondHTML(data BondData, lang string) (string, error) {
	var totalValue float64
	for _, o := range data.Ornaments {
		totalValue += o.Value
	}
	tmpl := bondTemplate
	style := bondPageStyle
	if lang == BondLangMalayalam {
		tmpl = bondTemplateMl
		style = bondPageStyleMalayalam
	}
	itemNames := make([]string, 0, len(data.Ornaments))
	itemWeights := make([]string, 0, len(data.Ornaments))
	for _, o := range data.Ornaments {
		itemNames = append(itemNames, o.Name)
		itemWeights = append(itemWeights, fmt.Sprintf("%.2f GM", o.NetWeight))
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
		BondData: BondData{
			LoanNumber: data.LoanNumber,
			Ornaments:  data.Ornaments,
			Day:        data.Day,
			Month:      data.Month,
			Year:       data.Year,
		},
		Style:              template.CSS(style),
		Blank:              blank,
		LenderName:         lenderName,
		LenderRegNo:        lenderKMLRegNo,
		LenderAge:          lenderAge,
		LenderBusiness:     lenderBusiness,
		LenderAadhaar:      lenderAadhaar,
		LenderPAN:          lenderPAN,
		LenderAddress:      lenderAddress,
		LenderAddressShort: lenderAddressShort,
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
	}
	td.CustomerName = orBlank(data.CustomerName)

	var sb strings.Builder
	if err := tmpl.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("pledge agreement: render template: %w", err)
	}
	return sb.String(), nil
}

// RenderIndemnityBondPDF renders the pledge agreement for the given loan/
// customer data, in the given language (BondLangEnglish/BondLangMalayalam),
// into a PDF, via a headless Chromium tab driven by chromedp. Requires a
// Chrome/Chromium binary on the host; chromedp returns a clear error if
// none is found.
func RenderIndemnityBondPDF(data BondData, lang string) ([]byte, error) {
	html, err := renderBondHTML(data, lang)
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

var pdfPagePattern = regexp.MustCompile(`(?s)/Type\s*/Page[^s]`)

// CountPDFPages estimates the number of pages in a PDF document by counting
// the /Type /Page object definitions. Returns at least 1.
func CountPDFPages(pdfBytes []byte) int {
	matches := pdfPagePattern.FindAllIndex(pdfBytes, -1)
	if len(matches) > 0 {
		return len(matches)
	}
	return 1
}
