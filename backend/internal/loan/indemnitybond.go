package loan

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
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

// bondTemplate is the English "Agreement of Pledge of Movable" template —
// the branch's standard pledge deed. Direct port of frontend/modules/loans/
// utils/indemnityBond.ts's printIndemnityBond(), same wording, same
// structure, wrapped in the same print.ts body/table/ol styling so the
// eSigned PDF matches what staff already see when printing it by hand.
var bondTemplate = template.Must(
	template.New("bond_en").Funcs(template.FuncMap{"inc": func(i int) int { return i + 1 }}).Parse(bondHTMLEnglish),
)

// bondTemplateGu is the Gujarati "ચલ મિલકતનો આડગીરો કરાર" (Movable Property
// Pledge Agreement) template — the branch's Gujarati paper form, added
// alongside the English one rather than replacing it: staff choose which
// language to print/eSign per loan (see StartIndemnityBondSign's lang
// parameter), the way the frontend already offers en/hi/gu on the wire.
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

// bondPageStyleGujarati is bondPageStyle with a font stack that leads with
// a Gujarati-capable face — 'Mona Sans'/plain system-ui has no Gujarati
// glyphs, so Chromium would otherwise fall back to tofu boxes for every
// matra. Requires "Noto Sans Gujarati" (or another Gujarati-covering face
// such as Shruti) actually installed on the host running chromedp; without
// it the PDF still renders, just via whatever fallback glyphs the OS ships.
const bondPageStyleGujarati = `
body{font-family:'Noto Sans Gujarati','Shruti','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.7;font-size:14px;padding:0 20px}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:.3px}
h2{font-size:14px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol{padding-left:22px} ol li{margin-bottom:12px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
.sig div{flex:1;text-align:center}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
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
Age :- {{.Blank}}, business :- {{.Blank}}<br>
Aadhar Card No. {{.Blank}}<br>
Pan Card No. {{.Blank}}<br>
Residing at :- {{.Blank}}
</p>
<p>(Hereinafter called &quot;the lender&quot;) of the other part.</p>
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
<li><b>Lender's Liability for Losses</b><br>The Lender shall not be liable to the borrower for any involuntary losses which may occur during his custody of the said articles (goods) or by reason of the sale thereof.</li>
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

// bondHTMLGujarati is the Gujarati "ચલ મિલકતનો આડગીરો કરાર" pledge deed —
// same clause structure/order as bondHTMLEnglish (covenant to pay, pledge
// clause with its three sub-clauses, lender's liability, right of lender,
// power of sale, interpretation clause, schedule, signatures), translated
// rather than transliterated, matching the branch's own Gujarati paper form.
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
ઉ.આ.વ. :- {{.Blank}}, ધંધો:- {{.Blank}}<br>
આધાર કાર્ડ નંબર :- {{.Blank}}<br>
પાનકાર્ડ નંબર :- {{.Blank}}<br>
રહે. :- {{.Blank}}
</p>
<p>( હવેથી આ કરારમાં બીજા પક્ષને &quot;આડગીરો લેનાર&quot;, &quot;નાણાં ધીરનાર&quot;, &quot;આડમાં લેનાર&quot; જેવી સંજ્ઞાઓથી સંબોધવામાં આવશે. )</p>
<p>&quot;આડગીરો મૂકનાર&quot; અને &quot;આડગીરો લેનાર&quot; સંયુક્ત રીતે &quot;પક્ષકારો&quot; તરીકે સંબોધવામાં આવશે.</p>
<p>આડગીરો લેનાર <b>{{.BranchName}}</b> ગામે નોંધણી પ્રમાણપત્ર નંબર <b>{{.LenderRegNo}}</b> હેઠળ નાણાં ધિરાણનો વ્યવસાય કરે છે.</p>
<p><b>આથી નીચે મુજબ સંમતિ કરવામાં આવે છે:</b></p>
<ol>
<li><b>ચૂકવણી કરવાનો કરાર</b><br>આડમાં લેનાર દ્વારા આડમાં મૂકનારને આપવામાં આવેલ રૂપિયા <b>{{.PrincipalAmount}}</b> ના ઋણના બદલામાં, આડમાં મૂકનાર સંમત થાય છે કે, ઉપરોક્ત ઋણ તારીખ {{.Blank}} ના રોજ અથવા તે પહેલાં, આ કરારના અમલની તારીખથી <b>{{.InterestRate}}</b> પ્રતિ વર્ષના વ્યાજ સાથે પરત ચૂકવશે.</li>
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
<div>આડગીરો મૂકનાર<span>નામ: {{.CustomerName}}</span></div>
<div>આડગીરો લેનાર<span>{{.LenderName}}</span></div>
</div>
<div class="sig">
<div><span>સાક્ષી<br>નામ: {{.Blank}}</span></div>
<div><span>સાક્ષી<br>નામ: {{.Blank}}</span></div>
</div>
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

// BondLangEnglish/BondLangGujarati are the two pledge-agreement languages
// StartIndemnityBondSign/RenderIndemnityBondPDF accept — kept as named
// constants rather than bare "en"/"gu" strings so every switch on lang
// (here and in service.go) stays in sync if a third language is ever added.
const (
	BondLangEnglish  = "en"
	BondLangGujarati = "gu"
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
// RenderIndemnityBondPDF. lang must be BondLangEnglish or BondLangGujarati —
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
	if lang == BondLangGujarati {
		tmpl = bondTemplateGu
		style = bondPageStyleGujarati
	}
	td := bondTemplateData{
		BondData: BondData{
			LoanNumber: data.LoanNumber,
			Ornaments:  data.Ornaments,
			Day:        data.Day,
			Month:      data.Month,
			Year:       data.Year,
		},
		Style:           template.CSS(style),
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
	if err := tmpl.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("pledge agreement: render template: %w", err)
	}
	return sb.String(), nil
}

// RenderIndemnityBondPDF renders the pledge agreement for the given loan/
// customer data, in the given language (BondLangEnglish/BondLangGujarati),
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
