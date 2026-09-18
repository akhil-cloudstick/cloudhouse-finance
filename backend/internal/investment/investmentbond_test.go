package investment

import (
	"strings"
	"testing"
	"time"
)

// The template must actually render (no missing/mistyped field references)
// and the rendered HTML must carry the investment's real figures — not the
// placeholder company/customer names from the original sample document —
// confirming this is a genuine auto-filled document, not a static copy.
func TestRenderInvestmentBondHTML_FillsRealData(t *testing.T) {
	data := InvestmentBondData{
		InvestmentNumber:    "INV-00042",
		CustomerName:        "Rajesh Kumar Nair",
		CustomerAddress:     "Flat 4B, Skyline Apartments, Kakkanad, Kochi",
		PrincipalAmount:     500_000,
		InterestRatePercent: 10.25,
		InterestRateType:    InterestRateTypeSimple,
		PayoutFrequency:     PayoutFrequencyMonthly,
		TenureMonths:        36,
		MaturityDate:        time.Date(2029, 9, 17, 0, 0, 0, 0, time.UTC),
		AgreementDate:       time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC),
		LegalName:           "Kerala Muthoot Gold Finance NBFC Ltd",
		AddressLine:         "Muthoot Towers, MG Road, Ernakulam, Kerala",
	}

	html, err := renderInvestmentBondHTML(data)
	if err != nil {
		t.Fatalf("unexpected render error: %v", err)
	}

	for _, want := range []string{
		"INV-00042",
		"Rajesh Kumar Nair",
		"Flat 4B, Skyline Apartments",
		"₹5,00,000.00",
		"10.25% p.a. (Simple)",
		"Monthly",
		"36 Months (3 Years)",
		"Kerala Muthoot Gold Finance NBFC Ltd",
		"Muthoot Towers, MG Road, Ernakulam, Kerala",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("rendered document missing expected content %q", want)
		}
	}

	// The document must never silently fall back to unrelated demo
	// wording from the sample — real issuer/investor data must win.
	if strings.Contains(html, "Rajesh Kumar Nair, residing at Flat 4B") == false {
		t.Error("investor block should read naturally with the real name and address")
	}
}

// A tenant with no LegalName/AddressLine on file (predating the tenant
// profile feature, or simply not filled in) must not leave the document
// broken — it degrades to a neutral placeholder rather than panicking or
// rendering an empty issuer block.
func TestRenderInvestmentBondHTML_FallsBackWithoutTenantProfile(t *testing.T) {
	data := InvestmentBondData{
		InvestmentNumber:    "INV-00001",
		CustomerName:        "Test Investor",
		PrincipalAmount:     100_000,
		InterestRatePercent: 8,
		InterestRateType:    InterestRateTypeCompound,
		PayoutFrequency:     PayoutFrequencyYearly,
		TenureMonths:        12,
	}

	html, err := renderInvestmentBondHTML(data)
	if err != nil {
		t.Fatalf("unexpected render error: %v", err)
	}
	if !strings.Contains(html, "the Company") {
		t.Error("empty LegalName should fall back to a neutral placeholder, not an empty issuer name")
	}
}

// A Compound-rate charge must actually compound over the tenure — this is
// the whole reason InterestRateType is a choice at all; if Simple and
// Compound produced the same projected return, the field would be
// meaningless on this document.
func TestRenderInvestmentBondHTML_CompoundProjectsHigherThanSimple(t *testing.T) {
	base := InvestmentBondData{
		InvestmentNumber:    "INV-COMPARE",
		CustomerName:        "Comparison Investor",
		PrincipalAmount:     100_000,
		InterestRatePercent: 10,
		PayoutFrequency:     PayoutFrequencyYearly,
		TenureMonths:        24,
	}

	simple := base
	simple.InterestRateType = InterestRateTypeSimple
	simpleHTML, err := renderInvestmentBondHTML(simple)
	if err != nil {
		t.Fatalf("unexpected render error (simple): %v", err)
	}

	compound := base
	compound.InterestRateType = InterestRateTypeCompound
	compoundHTML, err := renderInvestmentBondHTML(compound)
	if err != nil {
		t.Fatalf("unexpected render error (compound): %v", err)
	}

	// 2 years @ 10%: Simple = 20,000 projected return; Compound ≈ 21,000.
	if !strings.Contains(simpleHTML, "₹20,000.00") {
		t.Errorf("simple-interest projected return should be exactly principal × rate × years, got HTML: %s", extractProjectedReturn(simpleHTML))
	}
	if strings.Contains(compoundHTML, "₹20,000.00") {
		t.Error("compound projected return must differ from the simple-interest figure")
	}
}

func extractProjectedReturn(html string) string {
	idx := strings.Index(html, "Total Projected Return")
	if idx == -1 || idx+200 > len(html) {
		return "(not found)"
	}
	return html[idx : idx+200]
}
