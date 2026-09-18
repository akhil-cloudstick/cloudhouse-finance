package loan

import "strings"
import "testing"

import "cloudhouse/backend/internal/tenant"

// bondTestData is the borrower/loan fixture every case below renders, so a
// test only has to state the policy and language under test.
func bondTestData(policy string) BondData {
	return BondData{
		LoanNumber: "LN-00001", CustomerName: "Test Borrower", Age: 34,
		Address: "1 Test Road", BranchName: "Head Office", Phone: "9000012345",
		PAN: "ABCDE1234F", Aadhaar: "1234 5678 9012",
		PrincipalAmount: 50000, InterestRate: 12,
		Ornaments: []BondOrnament{{Name: "Chain", Purity: "22K", GrossWeight: 10, NetWeight: 9.5, Value: 60000}},
		Day:       11, Month: "September", Year: 2026,
		Policy: policy,
	}
}

// Markers that identify WHICH DOCUMENT was rendered, not merely which
// language. The two families are different instruments, so each has a
// headline the other never contains — which is exactly what a test of the
// policy axis has to assert on.
const (
	kmlMarker = "declare that the gold ornaments"    // the KML promissory-pledge letter
	gmlMarker = "AGREEMENT OF PLEDGE OF MOVABLE"     // the GML pledge deed
	gmlGuGlyph = "ચ"                                  // Gujarati letter CA
	kmlMlGlyph = "ആ"                                  // Malayalam letter A
)

// TestBondPolicyLanguageMatrix pins both axes at once: policy picks the
// instrument, language picks the translation of it.
func TestBondPolicyLanguageMatrix(t *testing.T) {
	for _, tc := range []struct {
		name    string
		policy  string
		lang    string
		want    []string
		notWant []string
	}{
		{
			name: "KML English", policy: tenant.PolicyKML, lang: BondLangEnglish,
			want: []string{kmlMarker, "Test Borrower"}, notWant: []string{gmlMarker},
		},
		{
			name: "KML Malayalam", policy: tenant.PolicyKML, lang: BondLangMalayalam,
			want: []string{kmlMlGlyph}, notWant: []string{gmlMarker},
		},
		{
			// The case the policy axis exists for: before it, a GML business
			// printing in English silently received the KML letter, because
			// selection keyed on language alone and English meant "kml".
			name: "GML English renders the GML deed, not the KML letter",
			policy: tenant.PolicyGML, lang: BondLangEnglish,
			want: []string{gmlMarker}, notWant: []string{kmlMarker},
		},
		{
			name: "GML Gujarati", policy: tenant.PolicyGML, lang: BondLangGujarati,
			want: []string{gmlGuGlyph}, notWant: []string{kmlMarker},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			html, err := renderBondHTML(bondTestData(tc.policy), tc.lang)
			if err != nil {
				t.Fatalf("render: %v", err)
			}
			for _, want := range tc.want {
				if !strings.Contains(html, want) {
					t.Errorf("rendered HTML missing expected marker %q", want)
				}
			}
			for _, notWant := range tc.notWant {
				if strings.Contains(html, notWant) {
					t.Errorf("rendered HTML contains %q — wrong document family", notWant)
				}
			}
			if !strings.Contains(html, "LN-00001") {
				t.Error("loan number not substituted")
			}
		})
	}
}

// TestBondFallbackNeverCrossesPolicy is the property the fallback chain in
// bondDocFor exists to guarantee: a missing translation drops to another
// language of the SAME instrument, never to the other policy's instrument.
// A borrower signing the wrong legal document is worse than signing the
// right one in a second language.
func TestBondFallbackNeverCrossesPolicy(t *testing.T) {
	// KML has no Gujarati template.
	html, err := renderBondHTML(bondTestData(tenant.PolicyKML), BondLangGujarati)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(html, kmlMarker) {
		t.Error("KML + Gujarati should fall back to the KML English letter")
	}
	if strings.Contains(html, gmlMarker) {
		t.Error("KML + Gujarati fell through to the GML deed — fallback crossed policy")
	}

	// GML has no Malayalam template.
	html, err = renderBondHTML(bondTestData(tenant.PolicyGML), BondLangMalayalam)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(html, gmlMarker) {
		t.Error("GML + Malayalam should fall back to the GML English deed")
	}
	if strings.Contains(html, kmlMarker) {
		t.Error("GML + Malayalam fell through to the KML letter — fallback crossed policy")
	}
}

// TestBondEmptyPolicyIsKML pins the empty-means-KML rule that lets every
// tenant row predating the policy column keep issuing what it already was.
func TestBondEmptyPolicyIsKML(t *testing.T) {
	html, err := renderBondHTML(bondTestData(""), BondLangEnglish)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(html, kmlMarker) {
		t.Error("an empty policy should render the KML letter")
	}
}
