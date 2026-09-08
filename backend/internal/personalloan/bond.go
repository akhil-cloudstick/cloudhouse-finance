// Bond generation: a downloadable, borrower-only "വാഗ്ദത്ത പത്രം" (promissory/
// surety letter) modeled on the branch's existing handwritten Malayalam form.
// Unlike internal/loan/indemnitybond.go's pledge agreement — which hardcodes
// the lender's name/registration number as fixed printed text — this
// document is deliberately one-sided: only the borrower's particulars are
// filled in; the financier's signature, any revenue stamp, and the witness
// block are left blank for manual completion at signing time. Structurally
// this mirrors indemnitybond.go closely (same BondData → html/template →
// chromedp PrintToPDF pipeline) so the two documents render the same way
// operationally, but the template/wording/blank-fallback rules are
// independent — nothing here is shared code with internal/loan, by design
// (see task constraint: internal/loan must not be touched).
package personalloan

import (
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"

	"ambikagold/backend/internal/customer"
)

// bondBlank is the placeholder printed wherever a field is missing —
// matches internal/loan/indemnitybond.go's own "blank" constant so both
// bond documents read consistently when hand-filled later.
const bondBlank = "________________"

// financierName is who the borrower owes money to, per this document's own
// opening paragraph. Personal loans are money-lending under the Kerala
// Money-Lenders Act (not the gold-loan business "Ambika Gold Finance"
// referenced elsewhere in this codebase's WhatsApp copy), so this uses the
// actual KML-licensed entity on file: MLL No. 32080354468, registered in the
// name of "Chittilappilly Thomman Financiers & Investments" — matching
// internal/reports/formg.go's formGLenderName (same licensee, English form,
// used there since Form G is an English-language statutory filing). There is
// no dedicated config/env var for this, so it remains a fixed constant.
//
// Printed in Malayalam script directly (ചിറ്റിലപ്പിള്ളി തൊമ്മാന ഫിനാൻസിയേഴ്സ്
// & ഇൻവെസ്റ്റ്മെന്റ്സ്) rather than run through ToMalayalam — this is a
// single fixed, already-known institution name (taken verbatim from the
// reference paper form), not user-entered data, so there's no reason to let
// the best-effort transliterator guess at it when the correct spelling is
// already on file.
//
// NOTE: unlike internal/loan/indemnitybond.go's lenderName/lenderRegNo, this
// name is used only in the opening paragraph identifying who the borrower
// owes money to — the financier's own signature/stamp area on this document
// is intentionally left blank (see bondHTML's footer) for manual signing.
const financierName = "ചിറ്റിലപ്പിള്ളി തൊമ്മാന ഫിനാൻസിയേഴ്സ് & ഇൻവെസ്റ്റ്മെന്റ്സ്"

// establishmentAddress is the financier's own registered particulars as they
// appear on the reference form: district/taluk/village, the block/junction,
// the room number, and the MLL registration number under which the
// establishment operates — all fixed, since this is the lender's own
// registered office, not something that varies per loan. Matches
// internal/reports/formg.go's formGLenderAddress (same licensee, same
// registration), just phrased in Malayalam and inline with the sentence
// structure the paper form uses ("...പ്രവർത്തിച്ചുവരുന്ന <name> എന്ന
// സ്ഥാപനത്തിന്റെ ഉടമക്ക്..."), rather than printed as a separate address block.
const establishmentAddress = "തൃശ്ശൂർ ജില്ല മുകുന്ദപുരം താലൂക്ക് വടക്കുംകര വില്ലേജിൽ വെള്ളാങ്കല്ലൂർ ബ്ലോക്ക് ജംഗ്ഷനിൽ XXI/118 നമ്പർ മുറിയിൽ M L L No: 32080354468 രജിസ്റ്റർ നമ്പറിൽ പ്രവർത്തിച്ചുവരുന്ന"

// BondData carries everything the borrower-only bond template needs,
// resolved from a PersonalLoan + its preloaded Customer (see
// bondDataForLoan). Only borrower-side fields are populated — there is
// deliberately no lender/financier signature field here (see package doc
// comment).
type BondData struct {
	LoanNumber          string
	BorrowerName        string
	FatherName          string // customer.Customer.FatherName — "son/daughter of" in the opening line
	Age                 int    // customer.Customer.Age when set, else derived from DOB; 0 means unknown — rendered as a blank
	Address             string
	District            string // customer.Customer.District
	Village             string // customer.Customer.Village
	Taluk               string // customer.Customer.Taluk
	Place               string // customer.Customer.Place (the "ദേശം"/post-office locality)
	PinCode             string // customer.Customer.PinCode
	AadhaarNumber       string // full 12-digit number, decrypted on demand — see Service.bondDataForLoan
	MobileNumber        string
	PrincipalAmount     float64
	InterestRatePercent float64 // annualized display rate — see interestRatePercent below
	Day                 int
	Month               string // full month name, e.g. "August"
	Year                int
}

func bondOrBlank(s string) string {
	if strings.TrimSpace(s) == "" {
		return bondBlank
	}
	return s
}

func bondAgeOrBlank(age int) string {
	if age <= 0 {
		return "____"
	}
	return fmt.Sprintf("%d", age)
}

func bondAadhaarOrBlank(aadhaar string) string {
	if strings.TrimSpace(aadhaar) == "" {
		return bondBlank
	}
	return aadhaar
}

func bondInrOrBlank(amount float64) string {
	if amount <= 0 {
		return bondBlank
	}
	return fmt.Sprintf("%.0f", amount)
}

func bondRateOrBlank(rate float64) string {
	if rate <= 0 {
		return bondBlank
	}
	return fmt.Sprintf("%g%%", rate)
}

// bondTemplate parses bondHTML once at package init, matching
// internal/loan/indemnitybond.go's template.Must pattern.
var bondTemplate = template.Must(template.New("personal_loan_bond").Parse(bondHTML))

// bondPageStyle mirrors internal/loan/indemnitybond.go's bondPageStyle CSS
// (same margins/typography) but adds a Malayalam-capable font stack ahead of
// the Latin one — this document's title and connective wording are in
// Malayalam, so headless Chrome needs a face that actually has those glyphs;
// 'Noto Sans Malayalam' and 'Nirmala UI' are the two fonts most likely to be
// present (bundled with the OS or installed alongside Chrome's own fonts),
// with the existing Latin sans-serif stack kept as a further fallback for
// the English/numeric portions of the form.
const bondPageStyle = `
body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.7;font-size:14px;padding:0 20px}
h1{font-size:22px;text-align:center;margin:0 0 4px;letter-spacing:1px}
h2{font-size:14px;text-align:center;margin:0 0 22px;font-weight:normal;color:#555}
p{margin:0 0 14px;text-align:justify}
.meta{margin:30px 0 10px}
.meta div{margin-bottom:8px}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:56px}
.sig div{flex:1}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
.footer-row{margin-top:40px;font-size:13.5px}
.footer-row div{margin-bottom:10px}
.witness{margin-top:36px}
.witness div{margin-bottom:10px}
`

// bondHTML is the borrower-only surety-letter template, structured to match
// the attached handwritten reference: title, an opening paragraph naming the
// borrower + the financier + the loan terms, a borrower signature/date/place
// block, then a "Mobi No / പേര്" row and a witness name/address/signature
// block — all left as blank lines for manual completion, same as the
// original paper form. No lender/financier signature, stamp, or witness
// detail is ever prefilled (see package doc comment).
const bondHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>വാഗ്ദത്ത പത്രം — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>വാഗ്ദത്ത പത്രം</h1>
<h2>Personal Loan Account No. {{.LoanNumber}}</h2>

<p>
<b>{{.District}}</b> ജില്ല <b>{{.Taluk}}</b> താലൂക്ക് <b>{{.Village}}</b> വില്ലേജ്
<b>{{.Place}}</b> ദേശത്ത് <b>{{.Place}}</b> പി.ഒ, പിൻ. <b>{{.PinCode}}</b>
<b>{{.FatherName}}</b>-ന്റെ മകൻ/മകൾ <b>{{.BorrowerName}}</b>
( ആധാർനമ്പർ <b>{{.Aadhaar}}</b> ) എന്ന ഞാൻ <b>{{.Age}}</b> വയസ്സ്. ബിസിനസ്സ് ചെയ്യുന്ന ഞാൻ,
{{.EstablishmentAddress}} <b>{{.FinancierName}}</b> എന്ന
സ്ഥാപനത്തിന്റെ ഉടമക്ക് എഴുതി കൊടുക്കുന്ന വാഗ്ദത്ത പത്രം.
</p>

<p>
ഞാൻ <b>{{.BorrowerName}}</b> {{printf "%02d" .Day}}/{{.Month}}/{{.Year}} തിയ്യതി
<b>{{.FinancierName}}</b> എന്ന സ്ഥാപനത്തിൽനിന്നു കടമായി കൈപ്പറ്റിയ രൂപ
<b>{{.PrincipalAmount}}</b> ( ₹{{.PrincipalAmount}}/- ) ആവശ്യപ്പെടുമ്പോൾ വർഷത്തിൽ
<b>{{.InterestRate}}</b> പലിശ സഹിതം സ്ഥാപനത്തിനോ, ഓർഡർക്കോ തന്നുകൊള്ളാമെന്ന് ഇതിനാൽ
വാഗ്ദത്തം ചെയ്യു കൊള്ളുന്നു.
</p>

<div class="meta">
<div>തിയ്യതി :- {{printf "%02d" .Day}} / {{.Month}} / {{.Year}}</div>
<div>സ്ഥലം :- {{.Blank}}</div>
</div>

<div class="sig">
<div><span>കടം വാങ്ങിയ ആളുടെ ഒപ്പ്<br>Name: {{.BorrowerName}}</span></div>
<div><span>&nbsp;</span></div>
</div>

<div class="footer-row">
<div>Mobi No :- {{.Mobile}}&nbsp;&nbsp;&nbsp;&nbsp;പേര് :- {{.BorrowerName}}</div>
</div>

<div class="witness">
<div><b>സാക്ഷി</b></div>
<div>പേര് :- {{.Blank}}</div>
<div>മേൽവിലാസം :- {{.Blank}}</div>
<div>ഒപ്പ് :- {{.Blank}}</div>
<div>സ്ഥലം :- {{.Blank}}</div>
<div>തിയ്യതി :- {{.Blank}}</div>
</div>
</body></html>`

// bondTemplateData wraps BondData with the extra pre-formatted display
// fields the template above references, same separation-of-concerns as
// internal/loan/indemnitybond.go's bondTemplateData.
type bondTemplateData struct {
	BondData
	Style                template.CSS
	Blank                string
	FinancierName        string
	EstablishmentAddress template.HTML // pre-built Malayalam phrase, see establishmentAddress
	Age                  string
	Aadhaar              string
	Address              string
	District             string
	Village              string
	Taluk                string
	Place                string
	PinCode              string
	FatherName           string
	Mobile               string
	PrincipalAmount      string
	InterestRate         string
}

// renderBondHTML executes bondTemplate against data, returning the full HTML
// document string ready to hand to GenerateBondPDF.
func renderBondHTML(data BondData) (string, error) {
	td := bondTemplateData{
		BondData: BondData{
			LoanNumber: data.LoanNumber,
			Day:        data.Day,
			Month:      data.Month,
			Year:       data.Year,
		},
		Style:                template.CSS(bondPageStyle),
		Blank:                bondBlank,
		FinancierName:        financierName,
		EstablishmentAddress: template.HTML(establishmentAddress), //nolint:gosec // fixed constant, not user input
		Age:                  bondAgeOrBlank(data.Age),
		Aadhaar:              bondAadhaarOrBlank(data.AadhaarNumber),
		Address:              bondOrBlank(data.Address),
		// Village/Taluk/Place/FatherName/BorrowerName are printed as plain
		// English text as entered (see customer.Customer) — NOT run through
		// ToMalayalam. That transliterator is only ever a phonetic best
		// guess (see its own doc comment), and for a name/place the borrower
		// will actually check against their own ID, a garbled guess reads as
		// a real error, not just a stylistic mismatch, on an otherwise
		// Malayalam-worded document. Address/PinCode/Aadhaar/Mobile were
		// already left as-is for the same reason (or, for the numeric ones,
		// because ToMalayalam has nothing to transliterate).
		District:        bondOrBlank(data.District),
		Village:         bondOrBlank(data.Village),
		Taluk:           bondOrBlank(data.Taluk),
		Place:           bondOrBlank(data.Place),
		PinCode:         bondOrBlank(data.PinCode),
		FatherName:      bondOrBlank(data.FatherName),
		Mobile:          bondOrBlank(data.MobileNumber),
		PrincipalAmount: bondInrOrBlank(data.PrincipalAmount),
		InterestRate:    bondRateOrBlank(data.InterestRatePercent),
	}
	td.BorrowerName = bondOrBlank(data.BorrowerName)

	var sb strings.Builder
	if err := bondTemplate.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("personal loan bond: render template: %w", err)
	}
	return sb.String(), nil
}

// GenerateBondPDF renders the borrower-only surety letter for the given
// loan/customer into a PDF, via a headless Chromium tab driven by chromedp —
// same invocation pattern as internal/loan's RenderIndemnityBondPDF
// (data: URL navigation, A4 paper size, generous margins). Requires a
// Chrome/Chromium binary on the host; chromedp returns a clear error if none
// is found.
func GenerateBondPDF(ctx context.Context, loan *PersonalLoan, cust *customer.Customer, aadhaar string) ([]byte, error) {
	data := bondDataForLoan(loan, cust, aadhaar)
	html, err := renderBondHTML(data)
	if err != nil {
		return nil, err
	}

	ctx, cancel := chromedp.NewContext(ctx)
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// base64, not template.URLQueryEscaper(html) — see
	// internal/loan/indemnitybond.go's RenderIndemnityBondPDF for why:
	// QueryEscape turns spaces into "+", which a data: URI never decodes
	// back, corrupting every space in the rendered text.
	encoded := base64.StdEncoding.EncodeToString([]byte(html))
	var pdfBytes []byte
	err = chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8;base64,"+encoded),
		chromedp.WaitReady("body"),
		chromedp.ActionFunc(func(ctx context.Context) error {
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
		return nil, fmt.Errorf("personal loan bond: render PDF (is Chrome/Chromium installed and on PATH?): %w", err)
	}
	return pdfBytes, nil
}

// bondDataForLoan builds GenerateBondPDF's template input from a loan and
// its customer. aadhaar is the already-decrypted full Aadhaar number (or
// empty) — decryption itself happens in the handler via customer.Service.
// DecryptAadhaar, the same access-controlled path internal/loan's
// bondDataForLoan uses, so this package never touches AadhaarEncrypted or
// the cipher directly.
func bondDataForLoan(loan *PersonalLoan, cust *customer.Customer, aadhaar string) BondData {
	// Age: prefer the explicit Age field captured at customer creation (see
	// customer.Customer.Age, added specifically for personal-loan customers)
	// over deriving it from DOB, since DOB is often left unset for customers
	// created via the personal-loan flow.
	age := 0
	if cust.Age != nil && *cust.Age > 0 {
		age = *cust.Age
	} else if !cust.DOB.IsZero() {
		age = int(time.Since(cust.DOB).Hours() / 24 / 365.25)
	}

	// interestRatePercent: PersonalLoan doesn't store an annual rate
	// directly — InterestType is "Flat" (a fixed rupee amount,
	// InterestValue) or "Percentage" (InterestValue already IS the percent
	// applied once over the loan's whole term, not an annualized rate; see
	// model_loan.go/service.go's computeInterest). For "Percentage" loans
	// InterestValue is displayed as-is (the rate the customer actually
	// agreed to); for "Flat" loans there is no meaningful percentage to
	// show, so the rate line is left blank via bondRateOrBlank(0) rather
	// than displaying a fabricated figure.
	var ratePercent float64
	if loan.InterestType == InterestTypePercentage {
		ratePercent = loan.InterestValue
	}

	signedAt := loan.OpenedDate
	if signedAt.IsZero() {
		signedAt = loan.DisbursedAt
	}

	return BondData{
		LoanNumber:          loan.LoanNumber,
		BorrowerName:        cust.Name,
		FatherName:          cust.FatherName,
		Age:                 age,
		Address:             cust.Address,
		District:            cust.District,
		Village:             cust.Village,
		Taluk:               cust.Taluk,
		Place:               cust.Place,
		PinCode:             cust.PinCode,
		AadhaarNumber:       aadhaar,
		MobileNumber:        cust.Phone,
		PrincipalAmount:     loan.PrincipalAmount,
		InterestRatePercent: ratePercent,
		Day:                 signedAt.Day(),
		Month:               signedAt.Month().String(),
		Year:                signedAt.Year(),
	}
}
