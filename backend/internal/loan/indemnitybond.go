package loan

import (
	"context"
	_ "embed"
	"encoding/base64"
	"fmt"
	"html"
	"html/template"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// lenderSignatureSVG is the lender's own signature, a vector trace (not a
// scanned/photographed image) — embedded into the binary and inlined as raw
// SVG markup directly in the HTML (rather than an <img src="data:...">)
// so it renders crisply at any size and needs no base64 round-trip. This
// HTML is rendered headlessly via chromedp with no guarantee the frontend's
// dev/prod server is reachable from wherever the backend runs, so embedding
// it into the binary (rather than fetching it as a file/URL) is what makes
// it always available.
//
//go:embed assets/lender_signature.svg
var lenderSignatureSVG string

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

	// LegalName/AddressLine/KMLRegNo are the LENDER's own particulars, taken
	// from the business's tenant profile (superadmin console) rather than
	// the loan. Empty falls back to the demo constants below — see
	// renderBondHTML.
	//
	// Before these existed the lender was nine hardcoded constants, so every
	// business's pledge agreement named the same lender. Worse, BusinessName
	// was already resolved and passed in here and then silently DISCARDED by
	// renderBondHTML, which rebuilt a stripped BondData; that is fixed.
	LegalName   string
	AddressLine string
	KMLRegNo    string
	DueDate         time.Time // zero means unknown — rendered as a blank, same convention as Age
}

// blank is the placeholder used wherever the frontend template falls back
// to "________________" for a missing field.
const blank = "________________"

// lenderName/lenderRegNo and the rest are the FALLBACK lender-side particulars,
// used only for a business whose tenant profile has not been filled in — see
// renderBondHTML, which prefers BondData.LegalName/AddressLine/KMLRegNo (set
// by the vendor in the superadmin console) over every one of them.
//
// lenderAge/lenderAadhaar/lenderPAN have NO tenant equivalent yet and are
// therefore still always these placeholders. They identify the lender on a
// document a borrower signs, so they must be replaced before any agreement is
// executed for real.
//
// Historical note on the originals:
// they were the fixed lender-side particulars printed on every pledge
// agreement — the same fixed text as the branch's paper
// form, not driven by loan data.
//
// DEMO PLACEHOLDERS. These identify the lender on a document the borrower
// signs, and the set includes an Aadhaar and a PAN, so they must be replaced
// with the licensee's real particulars before any agreement is executed. The
// values below are deliberately non-resolvable: the Aadhaar is masked rather
// than a 12-digit number that could belong to someone, and the PAN is the
// conventional all-A dummy. Nothing here is wired to config yet; if a
// business-profile table now exists (tenant.Tenant), and the name, address and
// registration number have moved into it.
const lenderName = "CloudHouse Finance"
const lenderRegNo = "DEMO-MLL-0000000000"
const lenderAge = "—"
const lenderBusiness = "CloudHouse Finance"
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

// firstNonEmpty returns the first argument that is not blank after trimming.
// Used to layer the lender's particulars: the business's own tenant profile
// wins, and the demo constants below are only reached when a business has
// not been given one.
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

// dueDateOrBlank formats the loan's due date for the "repay ... on or
// before ___" clause — previously always a hardcoded blank on every
// printed/eSigned bond regardless of the loan's actual due date.
func dueDateOrBlank(dueDate time.Time) string {
	if dueDate.IsZero() {
		return blank
	}
	return dueDate.Format("02-01-2006")
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

// bondTemplateGu is the Gujarati "ચલ મિલકતનો આડગીરો કરાર" (Movable Property
// Pledge Agreement) template — the Gujarat branch's own paper form, brought
// over from that deployment verbatim rather than translated here. See
// bondHTMLGujarati for why it is a different document from the English and
// Malayalam pair rather than a third translation of the same one.
var bondTemplateGu = template.Must(
	template.New("bond_gu").Funcs(template.FuncMap{"inc": func(i int) int { return i + 1 }}).Parse(bondHTMLGujarati),
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
.sig div{flex:1;text-align:center;position:relative}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
/* Absolutely positioned — sits inside the existing blank gap the .sig
 * span's own 44px margin-top already reserves, rather than adding its
 * own height to the flow (which would push the Lender's line lower than
 * the image-less Borrower's line beside it — see print.ts's identical
 * fix for the on-screen/print copy of this same bond). */
.lender-sig{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:110px}
.lender-sig svg{width:100%;height:auto;display:block}
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

// bondPageStyleGujarati is bondPageStyleMalayalam with a Gujarati-capable
// font stack. Identical in every other declaration — the two scripts want
// the same layout, only a different face.
//
// The font stack is the whole point of the separate constant: 'Mona Sans'
// and plain system-ui carry no Gujarati glyphs, so Chromium would render
// every matra as a tofu box. Requires "Noto Sans Gujarati" (or another
// Gujarati-covering face such as Shruti) installed ON THE HOST running
// chromedp — the same caveat bondPageStyleMalayalam documents. Without it
// the PDF still renders, just through whatever fallback the OS ships.
const bondPageStyleGujarati = `
body{font-family:'Noto Sans Gujarati','Shruti','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.7;font-size:14px;padding:0 20px}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:.3px}
h2{font-size:14px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol{padding-left:22px} ol li{margin-bottom:12px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
.sig div{flex:1;text-align:center;position:relative}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
/* Absolutely positioned — sits inside the existing blank gap the .sig
 * span's own 44px margin-top already reserves, rather than adding its
 * own height to the flow (which would push the Lender's line lower than
 * the image-less Borrower's line beside it — see print.ts's identical
 * fix for the on-screen/print copy of this same bond). */
.lender-sig{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:110px}
.lender-sig svg{width:100%;height:auto;display:block}
/* See bondPageStyle's .sig-page comment — same fix, Gujarati template. */
.sig-page{page-break-before:always;min-height:240mm;display:flex;flex-direction:column;justify-content:flex-end}
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
Age :- <b>{{.LenderAge}}</b>, business :- <b>{{.LenderBusiness}}</b><br>
Aadhar Card No. <b>{{.LenderAadhaar}}</b><br>
Pan Card No. <b>{{.LenderPAN}}</b><br>
Residing at :- <b>{{.LenderAddress}}</b>
</p>
<p>(Hereinafter called &quot;the lender&quot;) of the other part.</p>
<p>The lender carrying on business of money-lending under certificate of registration number <b>{{.LenderRegNo}}</b> of the other part.</p>
<p>The Money lender and borrower are collectively referred to as the &quot;Parties&quot;.</p>
<p><b>WHEREBY IT IS AGREED AS FOLLOWS</b></p>
<ol>
<li><b>Covenant to pay</b><br>In Consideration of the loan of Rs <b>{{.PrincipalAmount}}</b> advance by the lender to the borrower, the borrower hereby covenants with the lender that he will repay the said loan on or before {{.DueDate}} with interest at <b>{{.InterestRate}}</b> percent per annum from the date of execution of this agreement.</li>
<li><b>Pledge Clause</b><br>The Lender has lent the sum of Rs <b>{{.PrincipalAmount}}</b> (the receipt of which the borrower hereby acknowledges) and borrower has delivered to the lender article belonging to the borrower and specified in the schedule hereto to be held by him as security for the repayment of the aforesaid loan in the manner herein provided,
<ol type="a">
<li><b>Right to Extraordinary Expenses</b> — The lender is entitled to receive from the borrower extraordinary expenses incurred by him for the preservation of the good pledged.</li>
<li><b>Expenses of Repairs</b> — The Expenses of keeping the said articles in a good state of repair and in proper working order.</li>
<li><b>Other Costs</b> — All other costs, charges and expenses (if any) which the lender may be entitled by law to add to his security.</li>
</ol>
</li>
<li><b>Lender's Liability for Losses</b><br>The Lender shall not be liable to the borrower for any involuntary losses which may occur during his custody of the said articles (goods) or by reason of the sale thereof.</li>
<li><b>Right of Lender</b><br>The Borrower further covenants with the lender that in case any interest payable hereunder is not paid within 30 days after the due date, the whole sum hereby secured shall become payable at once, and in case of default in the payment of the principal money hereby secured with interest thereon on the aforesaid or in the performance of any of the covenants by the borrower hereinbefore contained the lender may enforce all or any of the remedies of a Pawnee provided by law provided that in case of sale of any part of the pledged property, a previous notice of two months shall be given to the borrower.</li>
<li><b>Power of Sale</b>
<ol type="a">
<li>The power of sale conferred by law on the lender shall be exercisable by public auction or private contract in respect of the entire articles in one lot or in several lots at the discretion of the lender;</li>
<li>Before exercising such power of sale as aforesaid the lender shall give at least two months' notice to the borrower.</li>
</ol>
</li>
<li><b>Interpretation clause</b><br>It is hereby agreed that wherever such an interpretation would be requisite in order to give the fullest scope and effect legally possible to any covenant herein contained, the expression &quot;the borrower&quot; and &quot;the lender&quot; hereinbefore used include their respective heirs, executors, administrators, and assigns.</li>
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

<div class="sig-page">
<p><b>IN WITNESS WHEREOF Etc.</b></p>
<div class="sig">
<div><span>Name: {{.Blank}}<br>Residing at</span></div>
<div><span>Name: {{.Blank}}<br>Residing at</span></div>
</div>
{{/* The Borrower/Lender signature row is deliberately the LAST thing in
     this page-bottom-pinned block (.sig-page{justify-content:flex-end} —
     see that class's comment) — Setu's Aadhaar eSign stamp targets
     "bottom-right of the last page" (service.go's StartIndemnityBondSign),
     which is whatever sits at the very bottom, not a specific line. With
     the witness block below this one (the original order), the stamp
     landed on/near the witness placeholder instead of the actual line the
     borrower is signing. Reordering so the borrower's own line is the
     true bottom-most content is what actually gets the two to line up. */}}
<div class="sig">
<div>The Borrower<span>Name: {{.CustomerName}}</span></div>
<div>The Lender<div class="lender-sig">{{.LenderSignatureSVG}}</div><span>{{.LenderName}}</span></div>
</div>
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

// bondHTMLGujarati is the Gujarati "ચલ મિલકતનો આડગીરો કરાર" (Movable Property
// Pledge Agreement) pledge deed, taken verbatim from the Gujarat deployment's
// own reviewed template rather than translated here — the wording of a binding
// pledge contract is not something to approximate (see the note that used to
// stand where renderBondHTML now selects it).
//
// IT IS A DIFFERENT DOCUMENT FROM bondHTMLEnglish/bondHTMLMalayalam, and that
// is correct rather than an oversight. Those two are one promissory-pledge
// letter in two languages, matching the Kerala branch's paper form. This
// follows the GUJARAT branch's paper form: the formal deed structure
// (covenant to pay, pledge clause with its three sub-clauses, lender's
// liability, right of lender, power of sale, interpretation clause, schedule,
// signatures). Two states, two paper forms, so a Gujarati borrower signs the
// deed their branch actually uses. Do not "align" the three.
const bondHTMLGujarati = `<!DOCTYPE html><html lang="gu"><head><meta charset="UTF-8"><title>ચલ મિલકતનો આડગીરો કરાર — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>ચલ મિલકતનો આડગીરો કરાર</h1>
<h2>ગોલ્ડ લોન એકાઉન્ટ નંબર {{.LoanNumber}}</h2>
<p>આ આડગીરો કરાર તારીખ <b>{{printf "%02d" .Day}}</b>, માસ <b>{{.Month}}</b>, વર્ષ <b>{{.Year}}</b> ના રોજ નીચેના પક્ષકારો વચ્ચે કરવામાં આવે છે:</p>
<p>
<b>{{.CustomerName}}</b><br>
ઉ.આ.વ. :- <b>{{.Age}}</b>, ધંધો:- {{.Blank}}<br>
આધાર કાર્ડ નંબર :- <b>{{.Aadhaar}}</b><br>
પાનકાર્ડ નંબર :- <b>{{.PAN}}</b><br>
રહે. :- <b>{{.Address}}</b>
</p>
<p>( હવેથી આ કરારમાં પહેલા પક્ષને &quot;આડગીરો મૂકનાર&quot;, &quot;દેણદાર&quot;, &quot;આડમાં મૂકનાર&quot; જેવી સંજ્ઞાઓથી સંબોધવામાં આવશે. )</p>
<p>અને</p>
<p>
<b>{{.LenderName}}</b><br>
ઉ.આ.વ. :- <b>{{.LenderAge}}</b>, ધંધો:- <b>{{.LenderBusiness}}</b><br>
આધાર કાર્ડ નંબર :- <b>{{.LenderAadhaar}}</b><br>
પાનકાર્ડ નંબર :- <b>{{.LenderPAN}}</b><br>
રહે. :- <b>{{.LenderAddress}}</b>
</p>
<p>( હવેથી આ કરારમાં બીજા પક્ષને &quot;આડગીરો લેનાર&quot;, &quot;નાણાં ધીરનાર&quot;, &quot;આડમાં લેનાર&quot; જેવી સંજ્ઞાઓથી સંબોધવામાં આવશે. )</p>
<p>&quot;આડગીરો મૂકનાર&quot; અને &quot;આડગીરો લેનાર&quot; સંયુક્ત રીતે &quot;પક્ષકારો&quot; તરીકે સંબોધવામાં આવશે.</p>
<p>આડગીરો લેનાર <b>{{.BranchName}}</b> ગામે નોંધણી પ્રમાણપત્ર નંબર <b>{{.LenderRegNo}}</b> હેઠળ નાણાં ધિરાણનો વ્યવસાય કરે છે.</p>
<p><b>આથી નીચે મુજબ સંમતિ કરવામાં આવે છે:</b></p>
<ol>
<li><b>ચૂકવણી કરવાનો કરાર</b><br>આડમાં લેનાર દ્વારા આડમાં મૂકનારને આપવામાં આવેલ રૂપિયા <b>{{.PrincipalAmount}}</b> ના ઋણના બદલામાં, આડમાં મૂકનાર સંમત થાય છે કે, ઉપરોક્ત ઋણ તારીખ {{.DueDate}} ના રોજ અથવા તે પહેલાં, આ કરારના અમલની તારીખથી <b>{{.InterestRate}}</b> પ્રતિ વર્ષના વ્યાજ સાથે પરત ચૂકવશે.</li>
<li><b>આડગીરોની જોગવાઈ</b><br>આડમાં લેનારે રૂ. <b>{{.PrincipalAmount}}</b> ની રકમ ધિરાણ આપી છે, જેની પ્રાપ્તિ આડમાં મૂકનાર સ્વીકારે છે. આડમાં મૂકનારે પોતાની માલિકીની આ કરારની અનુસૂચિમાં દર્શાવેલી માલ ઉપરોક્ત ઋણની ચૂકવણી કરવા માટે જામીનગીરી તરીકે સુરક્ષા તરીકે આડમાં લેનારને નિક્ષેપ કરેલ છે. આ વસ્તુઓ આ કરારમાં નક્કી કરેલ રીતે આડમાં લેનાર પાસે જામીનગીરી તરીકે રાખવામાં આવશે.
<ol type="a">
<li><b>અસાધારણ ખર્ચ અંગે આડમાં લેનારનો હક્ક</b> — આડમાં લેનાર આડમાં મૂકેલા માલની જાળવણી માટે પોતાને થયેલો અસાધારણ ખર્ચ, આડમાં મૂકનાર પાસેથી મેળવવા હક્કદાર રહેશે.</li>
<li><b>સમારકામનો ખર્ચ</b> — અનુસૂચિમાં દર્શાવેલ માલને સારી સ્થિતિમાં અને યોગ્ય કાર્યક્ષમ સ્થિતિમાં રાખવા માટેના ખર્ચ મેળવવા આડગીરો લેનાર હક્કદાર રહેશે.</li>
<li><b>અન્ય ખર્ચ</b> — અન્ય તમામ ખર્ચ, ફી અને ખર્ચાઓ (જો કોઈ હોય તો), જેને કાયદા હેઠળ આડગીરો લેનાર પોતાની સુરક્ષા રકમમાં ઉમેરવા માટે હકદાર રહેશે.</li>
</ol>
</li>
<li><b>નુકસાન માટે આડગીરો લેનારની જવાબદારી</b><br>આડગીરો લેનારની કસ્ટડીમાં અનુસૂચિમાં દર્શાવેલ માલને થનારા કોઈપણ અનૈચ્છિક નુકસાન અથવા તેમની વેચાણ પ્રક્રિયાના કારણે થનારા નુકસાન માટે આડગીરો લેનાર આડગીરો આપનાર પ્રત્યે જવાબદાર રહેશે નહીં.</li>
<li><b>આડગીરો લેનારના અધિકાર</b><br>આ કરાર હેઠળ ચૂકવવાપાત્ર કોઈપણ વ્યાજની રકમ નિયત તારીખથી 30 દિવસની અંદર ચૂકવવામાં નહીં આવે, તો આ કરાર દ્વારા સુરક્ષિત સમગ્ર રકમ તરત જ ચૂકવવાપાત્ર બની જશે. મૂળ રકમ અને તેના પરના વ્યાજની ચૂકવણીમાં કસૂર કરે અથવા આડમાં મૂકનાર આ કરારમાંની કોઈ શરતનું પાલન ન કરે, તો આડમાં મૂકનારને કાયદા હેઠળ આડગીરો લેનાર તરીકે ઉપલબ્ધ કોઈપણ અથવા તમામ ઉપાયો અમલમાં મૂકવાનો અધિકાર રહેશે. આડમાં મૂકનાર વેચાણની ૨ મહિના પહેલા અગાઉથી નોટિસ આપી આડમાં મુકેલ વસ્તુ તે વેચી શકશે.</li>
<li><b>વેચાણનો અધિકાર</b>
<ol type="a">
<li>કાયદા હેઠળ આડ લેનારને મળેલ વેચાણનો અધિકાર જાહેર હરાજી અથવા ખાનગી કરાર દ્વારા, આડમાં લેનારની વિવેકબુદ્ધિ મુજબ, તમામ વસ્તુઓને એક જ લોટમાં અથવા અનેક લોટમાં વેચીને અમલમાં મૂકી શકાય છે.</li>
<li>ઉપરોક્ત વેચાણનો અધિકાર અમલમાં મૂકતા પહેલાં આડમાં લેનારે આડમાં મૂકનારને ઓછામાં ઓછા બે મહિનાની નોટિસ આપવાની રહેશે.</li>
</ol>
</li>
<li><b>અર્થઘટનની જોગવાઈ</b><br>આથી બંને પક્ષકારો સંમત થાય છે કે આ કરારમાં સમાવિષ્ટ કોઈપણ જોગવાઈને કાયદેસર રીતે શક્ય તેટલી સંપૂર્ણ અસર આપવા માટે જ્યાં આવી વ્યાખ્યા જરૂરી હોય, ત્યાં &quot;આડગીરો લેનાર&quot; અને &quot;આડગીરો મૂકનાર&quot; શબ્દોમાં તેમના સંબંધિત વારસદારો, વહીવટદારો, એક્ઝિક્યુટર્સ, એડમિનિસ્ટ્રેટર્સ અને અધિકાર સોંપવામાં આવેલ વ્યક્તિઓનો પણ સમાવેશ થશે.</li>
</ol>
<p style="text-align:center"><b>-:: અનુસૂચિ ::-</b></p>
<table>
<thead><tr><th>અનુ.</th><th>વસ્તુનું વર્ણન</th><th>કેરેટ</th><th class="num">કુલ વજન (ગ્રામ)</th><th class="num">ચોખ્ખું વજન (ગ્રામ)</th><th class="num">અંદાજિત કિંમત (રૂ.)</th></tr></thead>
<tbody>
{{range $i, $o := .Ornaments}}<tr><td>{{inc $i}}</td><td>{{$o.Name}}</td><td>{{$o.Purity}}</td><td class="num">{{printf "%.1f" $o.GrossWeight}}</td><td class="num">{{printf "%.1f" $o.NetWeight}}</td><td class="num">{{printf "%.0f" $o.Value}}</td></tr>
{{else}}<tr><td colspan="6" style="text-align:center;color:#777">{{.Blank}}</td></tr>
{{end}}
</tbody>
</table>
<p><b>કુલ અંદાજિત રકમ :- રૂ. {{.TotalValue}}/-</b></p>
<p><b>કુલ ધિરાણ રકમ :- રૂ. {{.PrincipalAmount}}/-</b></p>
<p>સ્થળ: {{.BranchName}}</p>
<p>તારીખ: {{printf "%02d" .Day}} / {{.Month}} / {{.Year}}</p>
<div class="sig-page">
<div class="sig">
<div><span>સાક્ષી<br>નામ: {{.Blank}}</span></div>
<div><span>સાક્ષી<br>નામ: {{.Blank}}</span></div>
</div>
{{/* See the English template's identical reordering comment above
     bondHTMLEnglish's own .sig-page — the borrower's line must be the
     true bottom-most content so Setu's "bottom-right of last page" eSign
     stamp lands on it instead of the witness placeholder. */}}
<div class="sig">
<div>આડગીરો મૂકનાર<span>નામ: {{.CustomerName}}</span></div>
<div>આડગીરો લેનાર<div class="lender-sig">{{.LenderSignatureSVG}}</div><span>{{.LenderName}}</span></div>
</div>
</div>
</body></html>`

// bondTemplateData wraps BondData with the extra pre-formatted fields the
// template above references — kept separate from BondData itself so
// BondData stays a plain, easily-constructed value in service.go.
type bondTemplateData struct {
	BondData
	Style                 template.CSS
	Blank                 string
	LenderSignatureSVG template.HTML
	LenderName            string
	LenderRegNo           string
	LenderAge             string
	LenderBusiness        string
	LenderAadhaar         string
	LenderPAN             string
	LenderAddress         string
	LenderAddressShort string
	Age                   string
	Aadhaar               string
	PAN                   string
	Address               string
	BranchName            string
	PrincipalAmount       string
	InterestRate          string
	TotalValue         string
	DueDate               string
	// Mobile/DateDisplay/ItemNames/ItemWeights/AmountWords back
	// bondHTMLMalayalam only (see its own doc comment) — bondHTMLEnglish
	// doesn't reference them.
	Mobile      string
	DateDisplay string
	ItemNames   string
	ItemWeights string
	AmountWords string
}

// BondLangEnglish/BondLangMalayalam/BondLangGujarati are the pledge-agreement
// languages a business can be granted (tenant.KnownLanguages mirrors this set,
// and is what the vendor ticks per business).
//
// Kept as named constants rather than bare strings so every switch on lang
// stays in sync.
//
// All three templates are installed — see renderBondHTML, which pairs each
// language with its own font stack. English and Malayalam are one document
// in two languages (the Kerala branch's promissory-pledge letter); Gujarati
// is the Gujarat branch's own formal deed, a different document by design
// rather than a third translation. bondHTMLGujarati explains why.
const (
	BondLangEnglish   = "en"
	BondLangMalayalam = "ml"
	BondLangGujarati  = "gu"
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
	// All three languages are installed. A switch rather than a chain of ifs
	// because the template and its style MUST move together — a mismatch
	// renders the right words in a face with no glyphs for them, i.e. a page
	// of tofu boxes on a document a borrower signs. Pairing them at a single
	// site is what stops that.
	//
	// default is English, deliberately not an error: callers
	// (StartIndemnityBondSign, Service.SendBondForSigning) validate lang
	// first, so an unrecognised value here is a programming error rather than
	// user input, and a bond in the wrong language beats no bond at all while
	// still being obvious in review.
	tmpl, style := bondTemplate, bondPageStyle
	switch lang {
	case BondLangMalayalam:
		tmpl, style = bondTemplateMl, bondPageStyleMalayalam
	case BondLangGujarati:
		tmpl, style = bondTemplateGu, bondPageStyleGujarati
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
		// Passed WHOLE. An earlier version rebuilt a stripped BondData with
		// five fields copied across, which silently dropped BusinessName —
		// the tenant name was resolved, handed in, and thrown away, so every
		// business printed the same lender. Copy everything; the outer
		// string fields below shadow their BondData namesakes for rendering.
		BondData: data,
		Style:       template.CSS(style),
		Blank:       blank,
		// Tenant profile first, demo constants only as a fallback.
		LenderSignatureSVG: template.HTML(lenderSignatureSVG),
		LenderName:            firstNonEmpty(data.LegalName, data.BusinessName, lenderName),
		LenderRegNo:           firstNonEmpty(data.KMLRegNo, lenderKMLRegNo),
		LenderAge:             lenderAge,
		LenderBusiness:        firstNonEmpty(data.LegalName, data.BusinessName, lenderBusiness),
		LenderAadhaar:         lenderAadhaar,
		LenderPAN:             lenderPAN,
		LenderAddress:         firstNonEmpty(data.AddressLine, lenderAddress),
		LenderAddressShort: firstNonEmpty(data.AddressLine, lenderAddressShort),
		Age:                   ageOrBlank(data.Age),
		Aadhaar:               aadhaarOrBlank(data.Aadhaar),
		PAN:                   orBlank(data.PAN),
		Address:               orBlank(data.Address),
		BranchName:            orBlank(data.BranchName),
		PrincipalAmount:       inrOrBlank(data.PrincipalAmount),
		InterestRate:          rateOrBlank(data.InterestRate),
		TotalValue:            inrOrBlank(totalValue),
		Mobile:             orBlank(data.Phone),
		DateDisplay:        fmt.Sprintf("%02d %s %d", data.Day, strings.ToUpper(monthAbbrev(data.Month)), data.Year),
		ItemNames:          itemNamesStr,
		ItemWeights:        itemWeightsStr,
		AmountWords:        amountInWords(data.PrincipalAmount),
		DueDate:            dueDateOrBlank(data.DueDate),
	}
	td.CustomerName = orBlank(data.CustomerName)

	var sb strings.Builder
	if err := tmpl.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("pledge agreement: render template: %w", err)
	}
	return sb.String(), nil
}

// bondHeaderTemplate/bondFooterTemplate are Chrome's PrintToPDF header/
// footer templates — plain HTML rendered at a fixed height on EVERY page,
// completely separate from the document's own content. Chrome recognizes a
// handful of special classes it fills in itself: "date", "title", "url",
// "pageNumber", "totalPages" — font-size must be set explicitly (these
// templates render outside the document's own stylesheet, in their own
// tiny default browser font otherwise). Kept as their own small templates
// (not reusing bondPageStyle's CSS) since this is a completely different
// rendering pass from the document body.
const bondHeaderTemplateFmt = `
<div style="font-size:9px;width:100%%;text-align:center;color:#8a6d1f;font-family:Arial,sans-serif;padding-top:6px">
%s — Agreement of Pledge of Movable
</div>`

// bondHeaderTemplate fills bondHeaderTemplateFmt with the business's own
// name, escaped for safe embedding in this tiny standalone HTML fragment —
// html.EscapeString rather than a template, since this is a single
// interpolated value, not a document. Was a hardcoded "Ambika Gold Finance"
// printed on every business's pledge agreement regardless of who issued it;
// falls back to the same demo lenderName renderBondHTML uses when the tenant
// has not set BusinessName.
func bondHeaderTemplate(businessName string) string {
	name := strings.TrimSpace(businessName)
	if name == "" {
		name = lenderName
	}
	return fmt.Sprintf(bondHeaderTemplateFmt, html.EscapeString(name))
}

const bondFooterTemplate = `
<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:Arial,sans-serif;padding-bottom:6px">
Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>`

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
			//
			// DisplayHeaderFooter + Header/FooterTemplate are what
			// actually make that reserved space show a real, repeating
			// header/footer on EVERY page — unlike this same document's
			// body-level CSS margin (used for the client-side "print for
			// wet-ink signing" copy in frontend/common/utils/print.ts),
			// which only ever shows once, at the very top of page 1 /
			// bottom of the last page, not per page. A plain browser
			// window.print() has no equivalent to these two params at
			// all — Chrome's PrintToPDF (used only here, server-side) is
			// the only place a real custom per-page header/footer is
			// possible in this app.
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(false).
				WithPaperWidth(8.27).
				WithPaperHeight(11.69).
				WithMarginTop(0.9).
				WithMarginBottom(0.8).
				WithMarginLeft(0.6).
				WithMarginRight(0.6).
				WithDisplayHeaderFooter(true).
				WithHeaderTemplate(bondHeaderTemplate(data.BusinessName)).
				WithFooterTemplate(bondFooterTemplate).
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
