package loan

import (
	"context"
	"fmt"
	"html"
	"html/template"
	"math"
	"strings"
	"time"

	"cloudhouse/backend/internal/tenant"

)

// ReleaseAgreementOrnament is one row of the FORM 7 discharge receipt's
// ornament table, mirrors the pledge agreement's BondOrnament.
type ReleaseAgreementOrnament struct {
	Name        string
	Purity      string
	Quantity    int
	GrossWeight float64
	NetWeight   float64
	Value       float64
}

// ReleaseAgreementData carries everything the FORM 7 discharge receipt
// template needs, resolved from a closed Loan + its Customer — same fields
// frontend/modules/loans/utils/releaseAgreement.ts's printReleaseAgreement()
// used to assemble client-side, computed here from the loan's own data
// instead (see releaseAgreementDataForLoan).
type ReleaseAgreementData struct {
	LoanNumber      string
	BranchName      string
	CustomerName    string
	CustomerAddress string
	CustomerCareOf  string
	BorrowedDate    time.Time
	BorrowedAmount  float64
	ReturnedDate    time.Time
	ReturnedAmount  float64
	TotalInterest   float64
	Ornaments       []ReleaseAgreementOrnament

	// LegalName/AddressLine/KMLRegNo are the lender's own particulars, taken
	// from the business's tenant profile — same convention as BondData's own
	// fields (see indemnitybond.go's renderBondHTML). Empty falls back to
	// the demo constants below.
	LegalName   string
	AddressLine string
	// LenderSignature is the business's uploaded signature as an inline <img>
	// (see Service.lenderSignature), printed over the OWNER SIGNATURE line.
	LenderSignature template.HTML

	KMLRegNo    string

	// Policy is the business's document family, one of tenant.KnownPolicies
	// — same field and same meaning as BondData.Policy. See
	// releaseAgreementDocFor for the caveat that FORM 7 currently exists
	// only in the KML family.
	Policy string
}

// releaseBlank matches indemnitybond.go's blank constant (non-breaking
// spaces rather than an underscore line — see that file's own doc comment
// for why) — kept as its own name since these two files intentionally
// don't share code.
const releaseBlank = "                "

// Fallback lender identity, on the same terms as indemnitybond.go's lenderName/
// lenderAddress: the business's own tenant profile wins where it is set, and
// these remain so a live deployment keeps printing what it has always
// printed. LENDER_PHONE/LENDER_EMAIL have no tenant-profile equivalent yet
// and are therefore always these values — ported unchanged from
// frontend/modules/loans/utils/releaseAgreement.ts's own fallback constants.
const (
	releaseFallbackLenderName     = "CHITTILAPILLY THOMMANA FINANCIERS AND INVESTMENTS"
	releaseFallbackLenderAddress  = "XXI/118 - BLOCK JUNCTION, VELLANGALLUR, 680662"
	releaseLenderPhone            = "+919037374004"
	releaseLenderEmail            = "chittilapillythommanafinancier@gmail.com"
	releaseFallbackLenderKMLRegNo = "32080354468"
)

var releaseMonthsEn = [12]string{"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"}
var releaseMonthsMl = [12]string{
	"ജനുവരി", "ഫെബ്രുവരി", "മാർച്ച്", "ഏപ്രിൽ", "മേയ്", "ജൂൺ",
	"ജൂലൈ", "ഓഗസ്റ്റ്", "സെപ്റ്റംബർ", "ഒക്ടോബർ", "നവംബർ", "ഡിസംബർ",
}

func releaseFmtDate(t time.Time, lang string) string {
	if t.IsZero() {
		return releaseBlank
	}
	months := releaseMonthsEn
	if lang == BondLangMalayalam {
		months = releaseMonthsMl
	}
	return fmt.Sprintf("%02d %s %d", t.Day(), months[int(t.Month())-1], t.Year())
}

func releaseFmtAmount(n float64) string {
	if n <= 0 {
		return releaseBlank
	}
	// en-IN grouping (e.g. 1,00,000) to match the old frontend's
	// toLocaleString("en-IN") exactly.
	return platformFormatEnIN(n)
}

// releaseFineWeight is net weight × purity fraction (the actual pure-gold
// content) — same calc frontend/modules/loans/utils/releaseAgreement.ts's
// fineWeight() used, reusing this package's own ParsePurity (purity.go)
// rather than reimplementing purity parsing here.
func releaseFineWeight(netWeight float64, purity string) float64 {
	karat, fineness, err := ParsePurity(purity)
	if err != nil {
		return netWeight
	}
	if karat != nil {
		return netWeight * float64(*karat) / 24
	}
	if fineness != nil {
		return netWeight * *fineness / 100
	}
	return netWeight
}

// releaseAgreementTemplateData wraps ReleaseAgreementData with the extra
// pre-formatted display fields the templates reference.
type releaseAgreementTemplateData struct {
	ReleaseAgreementData
	Style           template.CSS
	Blank           string
	LenderName      string
	LenderAddress   string
	LenderPhone     string
	LenderEmail     string
	LenderKMLRegNo  string
	CustomerLine    template.HTML
	BorrowedDate    string
	BorrowedAmount  string
	ReturnedDate    string
	ReturnedAmount  string
	TotalInterest   string
	AmountWordsLine string
	Ornaments       []releaseOrnamentTemplateData
}

type releaseOrnamentTemplateData struct {
	Name        string
	Quantity    int
	GrossWeight float64
	NetWeight   float64
	FineWeight  float64
	Value       string
}

// releaseAgreementDocs is the discharge receipt keyed [policy][language],
// the same two-axis shape as indemnitybond.go's bondDocs.
//
// TODO(gml-release): the GML family has no FORM 7 of its own. FORM 7 is a
// Kerala statutory form, so a Gujarat business may need a different discharge
// receipt entirely or none at all — that is a legal question, not a coding
// one, and inventing the document here would be worse than the fallback.
// Until it is answered a GML business receives the KML English receipt (see
// releaseAgreementDocFor), which is the pre-policy behaviour rather than a
// new one. Add a "gml" entry here and the fallback stops applying.
var releaseAgreementDocs = map[string]map[string]*template.Template{
	tenant.PolicyKML: {
		BondLangEnglish:   mustLoadTemplate("release_agreement_kml_en", "kml-release-agreement-english.html", nil),
		BondLangMalayalam: mustLoadTemplate("release_agreement_kml_ml", "kml-release-agreement-malayalam.html", nil),
	},
}

// releaseAgreementDocFor resolves the receipt for a policy and language, on
// the same fallback order as bondDocFor — policy+language, then that policy's
// English, then KML English. A policy with no entry at all falls through to
// the last arm; see the TODO above for why GML is one today.
func releaseAgreementDocFor(policy, lang string) *template.Template {
	family, ok := releaseAgreementDocs[tenant.PolicyOrDefault(policy)]
	if ok {
		if tmpl, ok := family[lang]; ok {
			return tmpl
		}
		if tmpl, ok := family[BondLangEnglish]; ok {
			return tmpl
		}
	}
	return releaseAgreementDocs[tenant.PolicyKML][BondLangEnglish]
}

// renderReleaseAgreementHTML executes the template for the requested policy
// and language against data, returning the full HTML document string ready to
// hand to RenderReleaseAgreementPDF. lang must be BondLangEnglish or
// BondLangMalayalam (this document has no Gujarati variant).
func renderReleaseAgreementHTML(data ReleaseAgreementData, lang string) (string, error) {
	tmpl := releaseAgreementDocFor(data.Policy, lang)

	// html.EscapeString on every interpolated value before wrapping it in
	// literal <b> tags: CustomerName/CustomerCareOf/CustomerAddress are
	// customer-entered data, not fixed strings, so building HTML with
	// fmt.Sprintf here (rather than html/template's own auto-escaping,
	// which CustomerLine's template.HTML cast below deliberately bypasses
	// so the <b> tags actually render as markup) must escape them itself.
	customerName := html.EscapeString(data.CustomerName)
	if strings.TrimSpace(customerName) == "" {
		customerName = releaseBlank
	}
	careOf := html.EscapeString(data.CustomerCareOf)
	address := html.EscapeString(data.CustomerAddress)
	var customerLineParts []string
	if lang == BondLangMalayalam {
		customerLineParts = append(customerLineParts, fmt.Sprintf("ഉപഭോക്താവ് <b>%s</b>", customerName))
		if careOf != "" {
			customerLineParts = append(customerLineParts, fmt.Sprintf("c/o <b>%s</b>", careOf))
		}
		if address != "" {
			customerLineParts = append(customerLineParts, fmt.Sprintf("വിലാസം <b>%s</b>", address))
		}
	} else {
		customerLineParts = append(customerLineParts, fmt.Sprintf("Customer <b>%s</b>", customerName))
		if careOf != "" {
			customerLineParts = append(customerLineParts, fmt.Sprintf("c/o <b>%s</b>", careOf))
		}
		if address != "" {
			customerLineParts = append(customerLineParts, fmt.Sprintf("address <b>%s</b>", address))
		}
	}

	returnedDate := data.ReturnedDate
	if returnedDate.IsZero() {
		returnedDate = time.Now()
	}

	amountWordsLine := releaseBlank
	if data.ReturnedAmount > 0 {
		suffix := "Only"
		if lang == BondLangMalayalam {
			suffix = "മാത്രം"
		}
		amountWordsLine = amountInWords(data.ReturnedAmount) + " " + suffix
	}

	ornaments := make([]releaseOrnamentTemplateData, 0, len(data.Ornaments))
	for _, o := range data.Ornaments {
		ornaments = append(ornaments, releaseOrnamentTemplateData{
			Name:        o.Name,
			Quantity:    o.Quantity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			FineWeight:  releaseFineWeight(o.NetWeight, o.Purity),
			Value:       releaseFmtAmount(o.Value),
		})
	}

	td := releaseAgreementTemplateData{
		ReleaseAgreementData: data,
		Style:                template.CSS(releaseAgreementStyle(lang)),
		Blank:                releaseBlank,
		LenderName:           firstNonEmpty(data.LegalName, releaseFallbackLenderName),
		LenderAddress:        firstNonEmpty(data.AddressLine, releaseFallbackLenderAddress),
		LenderPhone:          releaseLenderPhone,
		LenderEmail:          releaseLenderEmail,
		LenderKMLRegNo:       firstNonEmpty(data.KMLRegNo, releaseFallbackLenderKMLRegNo),
		CustomerLine:         template.HTML(strings.Join(customerLineParts, " ")), //nolint:gosec // built above from html.EscapeString'd customer data plus fixed <b> markup, not raw user input
		BorrowedDate:         releaseFmtDate(data.BorrowedDate, lang),
		BorrowedAmount:       releaseFmtAmount(data.BorrowedAmount),
		ReturnedDate:         releaseFmtDate(returnedDate, lang),
		ReturnedAmount:       releaseFmtAmount(data.ReturnedAmount),
		TotalInterest:        releaseFmtAmount(data.TotalInterest),
		AmountWordsLine:      amountWordsLine,
		Ornaments:            ornaments,
	}

	var sb strings.Builder
	if err := tmpl.Execute(&sb, td); err != nil {
		return "", fmt.Errorf("release agreement: render template: %w", err)
	}
	return sb.String(), nil
}

// releaseAgreementStyle mirrors frontend/modules/loans/utils/
// releaseAgreement.ts's SHARED_STYLE/MALAYALAM_FONT_STYLE constants.
func releaseAgreementStyle(lang string) string {
	style := `
body{font-family:'Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;margin:0;padding:0}
h1{font-size:20px;letter-spacing:2px;margin:0 0 16px}
p{margin:8px 0}
.hd-table{border:none;margin-bottom:10px}
.hd-table td{border:none;padding:0;vertical-align:top}
.amt-table{width:auto;margin-left:auto;border:none;margin-top:6px}
.amt-table td{border:none;padding:1px 0 1px 24px}
.amt-table td:first-child{padding-left:0}
table:not(.hd-table):not(.amt-table){margin-top:14px;border-collapse:separate;border-spacing:0}
table:not(.hd-table):not(.amt-table) th,table:not(.hd-table):not(.amt-table) td{padding:6px 10px;border:1px solid #ccc}
table:not(.hd-table):not(.amt-table) th{background:#ececec;font-size:12px}
.terms{font-size:11px;color:#444;margin-top:16px}
.sig-row{display:flex;justify-content:space-between;margin-top:44px}
.sig-row div{text-align:left}
.sig-line{display:inline-block;border-top:1px solid #333;padding-top:4px;min-width:170px;margin-top:34px}
/* Owner signature: the uploaded image sits in a fixed slot above the line,
 * so the line stays at the same height whether or not one is set. */
.owner-sig .slot{height:46px;display:flex;align-items:flex-end}
.owner-sig .sig-img{max-height:44px;max-width:170px;display:block}
.owner-sig .sig-line{margin-top:0}
`
	if lang == BondLangMalayalam {
		style += `body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif}`
	}
	return style
}

// RenderReleaseAgreementPDF renders the FORM 7 discharge receipt for the
// given data, in the given language, into an A4 PDF — same page geometry and
// header/footer bands as every other document here (see renderA4PDF).
func RenderReleaseAgreementPDF(data ReleaseAgreementData, lang string) ([]byte, error) {
	html, err := renderReleaseAgreementHTML(data, lang)
	if err != nil {
		return nil, err
	}
	return renderA4PDF(html, "release agreement")
}

// releaseAgreementDataForLoan builds RenderReleaseAgreementPDF's input from
// a closed loan's own preloaded Customer/Branch/Ornaments/payment totals —
// same fields LoanDetail.tsx/Requests.tsx used to assemble client-side from
// LoanView before this migrated server-side.
// Deliberately reads l.Ornaments UNFILTERED (not released_at IS NULL): FORM
// 7 only ever fires for a FULL release, at which point every ornament is
// being released together, so there is nothing to exclude — and even if an
// earlier Partial Ornament Release had already taken some ornaments out
// on this same loan, the discharge receipt should still list everything
// that was ever pledged, not just what happened to still be here today.
// (The Partial Release Receipt, by contrast, deliberately DOES filter — see
// its own generator.)
func (s *Service) releaseAgreementDataForLoan(ctx context.Context, l *Loan) ReleaseAgreementData {
	ornaments := make([]ReleaseAgreementOrnament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		ornaments = append(ornaments, ReleaseAgreementOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			Quantity:    o.Quantity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			Value:       o.GoldValue,
		})
	}

	legalName, addressLine, kmlRegNo, policy := s.lenderProfile(ctx)

	return ReleaseAgreementData{
		LoanNumber:      l.LoanNumber,
		BranchName:      l.Branch.Name,
		CustomerName:    l.Customer.Name,
		CustomerAddress: l.Customer.Address,
		BorrowedDate:    l.OpenedDate,
		BorrowedAmount:  l.PrincipalAmount,
		ReturnedDate:    time.Now(),
		ReturnedAmount:  l.TotalPaid,
		TotalInterest:   l.InterestPaid + l.PenalInterestPaid,
		Ornaments:       ornaments,
		LegalName:       legalName,
		AddressLine:     addressLine,
		KMLRegNo:        kmlRegNo,
		Policy:          policy,
		LenderSignature: s.lenderSignature(ctx),
	}
}

// RenderReleaseAgreementPDFForLoan renders the FORM 7 discharge receipt PDF
// for loanID, in the given language — the server-side replacement for
// frontend/modules/loans/utils/releaseAgreement.ts's client-side
// window.print() copy.
//
// Uses s.Get (not a bare s.repo.FindByID, unlike RenderIndemnityBondPDFForLoan)
// because releaseAgreementDataForLoan reads l.TotalPaid/InterestPaid/
// PenalInterestPaid — computed, request-scoped fields (gorm:"-") that only
// get filled in by accrueAndEnrich, which s.Get calls and a bare FindByID
// does not. Skipping it left every printed release agreement's "Total
// Amount" and amount-in-words line blank regardless of what was actually
// paid, even though the two component figures above them (principal,
// interest) read correctly straight off persisted columns. The pledge bond
// doesn't have this problem — it only reads PrincipalAmount/InterestRate,
// neither of which is accrual-derived.
func (s *Service) RenderReleaseAgreementPDFForLoan(ctx context.Context, loanID uint, branchID *uint, lang string) ([]byte, string, error) {
	if lang != BondLangEnglish && lang != BondLangMalayalam {
		return nil, "", ErrUnsupportedIndemnityBondLang
	}
	l, err := s.Get(ctx, loanID, branchID)
	if err != nil {
		return nil, "", err
	}

	pdfBytes, err := RenderReleaseAgreementPDF(s.releaseAgreementDataForLoan(ctx, l), lang)
	if err != nil {
		return nil, "", err
	}

	filename := "Release-Agreement-" + l.LoanNumber + ".pdf"
	if lang == BondLangMalayalam {
		filename = "Release-Agreement-Malayalam-" + l.LoanNumber + ".pdf"
	}
	return pdfBytes, filename, nil
}

// amountInWords/onesWords/tensWords/twoDigitWords/threeDigitWords are
// already defined in indemnitybond.go and reused here as-is — same Indian
// numbering (crore/lakh/thousand) so the release agreement's amount-in-words
// line never disagrees with the pledge agreement's.

// platformFormatEnIN formats n as en-IN grouped digits with no decimals
// (e.g. 1234567 -> "12,34,567") — Go has no built-in Intl-style locale
// formatter, so this ports the exact grouping frontend/modules/loans/utils/
// releaseAgreement.ts's toLocaleString("en-IN") produced: the last 3 digits
// as one group, then groups of 2 working left.
func platformFormatEnIN(n float64) string {
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
	last3 := s[len(s)-3:]
	rest := s[:len(s)-3]
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
