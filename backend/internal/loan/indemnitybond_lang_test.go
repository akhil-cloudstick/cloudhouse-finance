package loan

import "strings"
import "testing"

func TestAllThreeBondLanguagesRender(t *testing.T) {
	data := BondData{
		LoanNumber: "LN-00001", CustomerName: "Test Borrower", Age: 34,
		Address: "1 Test Road", BranchName: "Head Office", Phone: "9000012345",
		PAN: "ABCDE1234F", Aadhaar: "1234 5678 9012",
		PrincipalAmount: 50000, InterestRate: 12,
		Ornaments: []BondOrnament{{Name: "Chain", Purity: "22K", GrossWeight: 10, NetWeight: 9.5, Value: 60000}},
		Day:       11, Month: "September", Year: 2026,
	}
	for _, tc := range []struct{ lang, wantGlyph string }{
		{BondLangEnglish, "Test Borrower"},
		{BondLangMalayalam, "ആ"}, // Malayalam letter A
		{BondLangGujarati, "ચ"},  // Gujarati letter CA
	} {
		html, err := renderBondHTML(data, tc.lang)
		if err != nil {
			t.Fatalf("lang %q: %v", tc.lang, err)
		}
		if !strings.Contains(html, tc.wantGlyph) {
			t.Errorf("lang %q: rendered HTML missing expected marker %q", tc.lang, tc.wantGlyph)
		}
		if !strings.Contains(html, "LN-00001") {
			t.Errorf("lang %q: loan number not substituted", tc.lang)
		}
		t.Logf("lang %-3s -> %d bytes", tc.lang, len(html))
	}
}
