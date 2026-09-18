package loan

import (
	"context"
	_ "embed"
	"encoding/base64"
	"fmt"
	"html"
	"html/template"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"cloudhouse/backend/internal/tenant"

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

	// Policy is the business's document family, one of tenant.KnownPolicies,
	// resolved from the same tenant profile the three fields above come from.
	// It picks WHICH DOCUMENT is rendered (see bondDocs); language picks
	// which translation of it. Empty is read as the KML default, so a caller
	// that forgets it gets the pre-policy behaviour rather than no document.
	Policy string

	DueDate time.Time // zero means unknown — rendered as a blank, same convention as Age
}

// blank is the placeholder used wherever a field on the printed document has
// no value — a run of non-breaking spaces rather than a printed underscore
// line: the paper is still meant to be filled in by hand at signing time,
// and needs a visibly reserved gap to write into, but the printed page
// itself should show a plain blank space rather than a drawn rule (was
// "________________" until this changed). Plain regular spaces would
// collapse to nothing across an HTML line break, so this uses non-breaking
// spaces ( ) to keep the gap visible.
const blank = "                "

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

// templatesDir is where every printable document's HTML source now lives —
// plain .html files, not compiled into the binary (see bondDocs below, and
// personalloan/bond.go's own identical loadTemplate). Path is relative to
// the backend process's own working directory, same convention
// platform.Config's UploadsDir ("./uploads") already uses — the server is
// always launched from the backend/ folder, so this always resolves to
// backend/templates/.
const templatesDir = "./templates"

// findTemplatesDir locates templatesDir, walking up from the working
// directory if it is not there.
//
// The walk exists for `go test`, which runs each package with its OWN
// directory as the working directory, never backend/. Since these templates
// load at package INIT, that made every test in this package panic before it
// reached TestMain — not one of them could run, and adding a chdir to
// TestMain would not have helped because init has already finished by then.
// Production is unaffected: the server starts in backend/, so the first
// candidate matches and nothing is walked.
//
// Returns templatesDir unchanged when no ancestor has one, so the failure is
// still the clear "read template X: no such file" panic below rather than
// something about directory walking.
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

// resolvedTemplatesDir is computed once, at init, so the walk above happens
// a single time rather than per template.
var resolvedTemplatesDir = findTemplatesDir()

// mustLoadTemplate reads name from templatesDir and parses it with the given
// funcs, panicking (via template.Must's own convention — this only ever runs
// at package init, so a missing/malformed template file is a deployment
// error that should fail loudly at startup, not a runtime error to recover
// from) if the file is missing or fails to parse.
func mustLoadTemplate(templateName, fileName string, funcs template.FuncMap) *template.Template {
	b, err := os.ReadFile(filepath.Join(resolvedTemplatesDir, fileName))
	if err != nil {
		panic(fmt.Sprintf("pledge agreement: read template %s: %v", fileName, err))
	}
	return template.Must(template.New(templateName).Funcs(funcs).Parse(string(b)))
}

var bondTemplateFuncs = template.FuncMap{"inc": func(i int) int { return i + 1 }}

// bondDoc pairs a template with the page CSS it must be rendered under.
// They are ONE value rather than two lookups because the pairing is load
// bearing: the style carries the font stack, so a template fetched with the
// wrong style renders the right words in a face with no glyphs for them —
// a page of tofu boxes on a document a borrower signs. Keeping them in a
// single struct makes that structural rather than a convention held up by a
// comment, which is what the language switch below used to be.
type bondDoc struct {
	tmpl  *template.Template
	style string
}

// bondDocs is every pledge agreement the app can issue, keyed
// [policy][language].
//
// Two axes, not one. POLICY picks the document — the kml-* files are a short
// promissory-pledge letter, the gml-* files a Gujarati movable-property
// pledge deed, and they are different instruments, not translations of each
// other. LANGUAGE picks the translation within that family. Until this map
// existed the selection keyed on language alone, so "Gujarati" silently
// meant "print the GML deed" and a business's regulatory regime was never
// modelled at all.
//
// Every policy MUST have an English entry: tenant.HasLanguage grants English
// unconditionally, so a policy without one describes a business that cannot
// print its own paperwork. bondDocFor's fallback chain relies on it too.
var bondDocs = map[string]map[string]bondDoc{
	tenant.PolicyKML: {
		// The English KML bond is a translation of the Malayalam
		// promissory-pledge letter (see kml-bond-malayalam.html's own doc
		// history) — same wording and structure, not the old formal
		// "MEMORANDUM OF AGREEMENT... BETWEEN" numbered-clause deed it
		// used to be.
		BondLangEnglish: {mustLoadTemplate("bond_kml_en", "kml-bond-english.html", bondTemplateFuncs), bondPageStyle},
		// The Malayalam "ആഭരണ പണയ കരാർ" (Ornament Pledge Agreement),
		// modeled on the branch's actual Malayalam reference form.
		BondLangMalayalam: {mustLoadTemplate("bond_kml_ml", "kml-bond-malayalam.html", bondTemplateFuncs), bondPageStyleMalayalam},
	},
	tenant.PolicyGML: {
		// The English rendering of the same movable-property deed as the
		// Gujarati entry below — NOT the KML letter. A GML business printing
		// in English must get its own instrument.
		BondLangEnglish: {mustLoadTemplate("bond_gml_en", "gml-bond-english.html", bondTemplateFuncs), bondPageStyle},
		// The Gujarati "ચલ મિલકતનો આડગીરો કરાર" (Movable Property Pledge
		// Agreement) — the Gujarat deployment's own paper form, brought over
		// verbatim rather than translated here.
		BondLangGujarati: {mustLoadTemplate("bond_gml_gu", "gml-bond-gujarati.html", bondTemplateFuncs), bondPageStyleGujarati},
	},
}

// bondDocFor resolves the document for a policy and language.
//
// Fallback order is policy+language → policy+English → KML+English, and the
// ORDER is the point: a missing translation drops to another language of the
// SAME instrument, never to another policy's instrument, because a borrower
// signing the wrong legal document is a worse failure than signing the right
// one in a second language. The final KML+English arm is unreachable for any
// value in tenant.KnownPolicies and exists so an unrecognised stored policy
// still produces a document; callers validate policy and language before
// reaching here, so anything it catches is a programming error.
func bondDocFor(policy, lang string) bondDoc {
	family, ok := bondDocs[tenant.PolicyOrDefault(policy)]
	if !ok {
		family = bondDocs[tenant.PolicyKML]
	}
	if doc, ok := family[lang]; ok {
		return doc
	}
	if doc, ok := family[BondLangEnglish]; ok {
		return doc
	}
	return bondDocs[tenant.PolicyKML][BondLangEnglish]
}

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
/* No forced page-break here (unlike the Gujarati deed's .sig-page below) —
 * this bond's whole point is fitting the short KML letterhead letter onto
 * ONE A4 page for a plain print. The signature/release block now just
 * flows naturally after the main content. This does mean a bond sent for
 * Aadhaar eSign no longer has a guaranteed page-bottom landing spot for
 * Setu's stamp the way the old forced-second-page version did — re-verify
 * StartIndemnityBondSign's eSign stamp placement after this change. */
.sig-page{}
`

// bondPageStyleMalayalam is bondPageStyle with a font stack that leads with
// a Malayalam-capable face — 'Mona Sans'/plain system-ui has no Malayalam
// glyphs, so Chromium would otherwise fall back to tofu boxes for every
// character. Requires "Noto Sans Malayalam" (or "Nirmala UI") actually
// installed on the host running chromedp — same requirement as internal/
// personalloan/bond.go's own Malayalam template; without it the PDF still
// renders, just via whatever fallback glyphs the OS ships.
// Font sizes kept at their original values (14px body / 19px h1 / 14px h2 /
// 13px table cells) — only the body's own outer margin and the signature
// block's spacing were trimmed down (from 40px/60px/44px), and line-height
// bumped up slightly (1.7 -> 1.8) for a bit more breathing room between
// lines, so the short KML letter still reliably fits a single A4 page.
const bondPageStyleMalayalam = `
body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;margin:8px auto;max-width:760px;line-height:1.6;font-size:14px;padding:0 20px}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:.3px}
h2{font-size:14px;text-align:center;margin:0 0 10px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #999;padding:4px 7px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol{padding-left:22px} ol li{margin-bottom:8px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:20px}
.sig div{flex:1;text-align:center}
.sig span{display:block;border-top:1px solid #333;padding-top:4px;margin-top:16px;font-size:12.5px}
/* No forced page-break — see bondPageStyle's .sig-page comment. */
.sig-page{}
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
// rather than a third translation — see backend/templates/gml-bond-gujarati.html's
// own doc comment for why.
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
	// Document family first, then language within it — see bondDocs. The
	// template and its style arrive as one value because they MUST move
	// together: a mismatch renders the right words in a face with no glyphs
	// for them, i.e. a page of tofu boxes on a document a borrower signs.
	//
	// Falling back rather than erroring is deliberate: callers
	// (StartIndemnityBondSign, Service.SendBondForSigning) validate policy
	// and language first, so anything bondDocFor has to absorb is a
	// programming error rather than user input, and a bond in a second
	// language of the right instrument beats no bond at all while still
	// being obvious in review.
	doc := bondDocFor(data.Policy, lang)
	tmpl, style := doc.tmpl, doc.style
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
//
// bondHeaderTemplateFmt carries a single %s — the issuing business's name,
// filled in by bondHeaderTemplate. The div is kept even when that name is
// empty because Chrome substitutes its own default header (date + document
// title) whenever it is handed an empty header template string, so an
// "empty" header has to be an empty element.
const bondHeaderTemplateFmt = `
<div style="font-size:9px;width:100%%;text-align:center;color:#8a6d1f;font-family:Arial,sans-serif;padding-top:6px">
%s
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
			// page's own @page CSS.
			//
			// DisplayHeaderFooter + Header/FooterTemplate are what make
			// this reserved margin space show a real, repeating
			// header/footer on EVERY page — unlike this same document's
			// body-level CSS margin (used for the client-side "print for
			// wet-ink signing" copy in frontend/common/utils/print.ts),
			// which only ever shows once, at the very top of page 1 /
			// bottom of the last page, not per page. A plain browser
			// window.print() has no equivalent to these two params at
			// all — Chrome's PrintToPDF (used only here, server-side) is
			// the only place a real custom per-page header/footer is
			// possible in this app.
			//
			// MarginTop/MarginBottom trimmed from 0.9in/0.8in to 0.25in/
			// 0.2in — the header is blank and the footer is a single
			// small "Page X of Y" line (bondFooterTemplate), so the old
			// margins reserved far more space than either ever used,
			// which combined with .sig-page's now-removed forced
			// page-break was pushing the short KML letter bond onto two
			// pages instead of the one it should fit on. Still enough
			// room for the footer text to render without clipping.
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(false).
				WithPaperWidth(8.27).
				WithPaperHeight(11.69).
				WithMarginTop(0.25).
				WithMarginBottom(0.2).
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
