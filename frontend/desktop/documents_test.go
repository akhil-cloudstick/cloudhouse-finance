package main

import (
	"strings"
	"testing"
)

const sampleDoc = `{
  "loan": {
    "loanNumber": "LN-00105", "status": "Active", "openedDate": "2026-11-01T05:30:00+05:30", "dueDate": "2027-11-01",
    "principalAmount": 6000, "eligibleLoanAmount": 8000, "totalNetWeight": 12.5, "totalGoldValue": 90000,
    "schemeInterestRate": 18, "schemeLtvPercent": 75, "outstandingAmount": 6000, "totalPaid": 6500, "interestPaid": 500,
    "branch": {"Name": "Main"}, "customer": {"name": "Lilly Mariya", "code": "C-001", "id": 7, "phone": "9000000000", "address": "Kochi"},
    "scheme": {"Name": "Golden Shower"},
    "ornaments": [{"name": "Chain", "purity": "22K", "grossWeight": 13, "netWeight": 12.5, "quantity": 1, "goldValue": 90000}],
    "payments": [{"amount": 3, "type": "Interest", "paidOn": "2026-11-05", "interestApplied": 3, "runningBalance": 6000}]
  },
  "profile": {"name": "R K Finance", "legalName": "R K Finance Pvt", "addressLine": "Kochi\\nKerala", "kmlRegNo": "123", "brandColor": "#112233"},
  "singleBranch": false
}`

func TestOfflineDocumentsRender(t *testing.T) {
	a := &App{}
	for _, c := range []struct{ kind, lang string }{{"pledge-slip", ""}, {"statement", ""}, {"release-agreement", "en"}, {"release-agreement", "ml"}} {
		out, err := a.RenderOfflineDocument(c.kind, c.lang, sampleDoc)
		if err != nil {
			t.Fatalf("%s/%s: %v", c.kind, c.lang, err)
		}
		if !strings.Contains(out, "LN-00105") && c.kind != "release-agreement" {
			t.Errorf("%s: loan number missing", c.kind)
		}
		if !strings.Contains(out, "Lilly Mariya") {
			t.Errorf("%s/%s: customer name missing", c.kind, c.lang)
		}
		if strings.Contains(out, "ZgotmplZ") {
			t.Errorf("%s/%s: a value was blocked by the template escaper", c.kind, c.lang)
		}
	}
}

func TestOfflineTMLDocumentsRender(t *testing.T) {
	a := &App{}
	in := strings.Replace(sampleDoc, `"schemeInterestRate": 18,`, `"schemeInterestRate": 18, "schemeDurationMonths": 12, "schemeMinimumDays": 30, "schemeRateTiers": [{"days": 90, "rate": 12}, {"days": 0, "rate": 18}],`, 1)
	in = strings.Replace(in, `"profile": {`, `"profile": {"policy": "TML", "contactPhone": "9111111111", `, 1)
	in = strings.Replace(in, `"payments": [{`, `"payments": [{"id": 9, `, 1)
	for _, kind := range []string{"tml-pledge-slip", "tml-statement"} {
		out, err := a.RenderOfflineDocument(kind, "", in)
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if !strings.Contains(out, "Lilly Mariya") {
			t.Errorf("%s: customer name missing", kind)
		}
		if strings.Contains(out, "ZgotmplZ") {
			t.Errorf("%s: a value was blocked by the template escaper", kind)
		}
	}
}

func TestOfflineBondsRender(t *testing.T) {
	a := &App{}
	for _, c := range []struct{ policy, lang string }{{"KML", "en"}, {"KML", "ml"}, {"GML", "en"}, {"GML", "gu"}, {"TML", "en"}, {"TML", "ta"}} {
		in := strings.Replace(sampleDoc, `"profile": {`, `"profile": {"policy": "`+c.policy+`", `, 1)
		in = strings.Replace(in, `"phone": "9000000000",`, `"phone": "9000000000", "pan": "ABCDE1234F", "aadhaarLast4": "1234", "age": 41,`, 1)
		out, err := a.RenderOfflineDocument("bond", c.lang, in)
		if err != nil {
			t.Fatalf("%s/%s: %v", c.policy, c.lang, err)
		}
		if !strings.Contains(out, "Lilly Mariya") {
			t.Errorf("%s/%s: customer name missing", c.policy, c.lang)
		}
		if strings.Contains(out, "ZgotmplZ") {
			t.Errorf("%s/%s: a value was blocked by the template escaper", c.policy, c.lang)
		}
	}
}

func TestOfflineOtherDocumentsRender(t *testing.T) {
	a := &App{}
	person := `"person": {"name": "Lilly Mariya", "fatherName": "Joseph", "address": "Kochi", "district": "Ernakulam", "village": "V", "taluk": "T", "place": "P", "pinCode": "682001", "phone": "9000000000", "aadhaarLast4": "1234", "age": 41},`
	cases := []struct{ kind, lang, in string }{
		{"personal-loan-bond", "en", `{` + person + `"personalLoan": {"loanNumber": "PL-1", "principalAmount": 5000, "interestType": "Percentage", "interestValue": 12, "openedDate": "2026-11-01"}, "profile": {"legalName": "R K Finance", "kmlRegNo": "123"}}`},
		{"personal-loan-bond", "ml", `{` + person + `"personalLoan": {"loanNumber": "PL-1", "principalAmount": 5000, "interestType": "Percentage", "interestValue": 12}, "profile": {"legalName": "R K Finance"}}`},
		{"investment-bond", "", `{` + person + `"investment": {"investmentNumber": "INV-1", "principalAmount": 100000, "interestRatePercent": 10, "interestRateType": "Simple", "payoutFrequency": "Monthly", "tenureMonths": 24, "startDate": "2026-11-01", "maturityDate": "2028-11-01"}, "profile": {"legalName": "R K Finance"}}`},
		{"partial-release-receipt", "en", strings.Replace(sampleDoc, `"ornaments": [{`, `"ornaments": [{"id": 1, "releasedAt": "2026-11-05T00:00:00Z", `, 1)[:0] + `{"loan": {"loanNumber": "LN-9", "principalAmount": 4000, "totalGoldValue": 90000, "eligibleLoanAmount": 60000, "schemeLtvPercent": 75, "customer": {"name": "Lilly Mariya", "address": "Kochi"}, "branch": {"Name": "Main"}, "ornaments": [{"id": 1, "name": "Chain", "purity": "22K", "netWeight": 5, "grossWeight": 5.5, "quantity": 1, "goldValue": 30000, "releasedAt": "2026-11-05T00:00:00Z"}, {"id": 2, "name": "Ring", "purity": "22K", "netWeight": 3, "grossWeight": 3.1, "quantity": 1, "goldValue": 60000}]}, "receipt": {"ornamentIds": [1], "settlementAmount": 2000}, "profile": {"legalName": "R K Finance"}}`},
	}
	for _, c := range cases {
		out, err := a.RenderOfflineDocument(c.kind, c.lang, c.in)
		if err != nil {
			t.Fatalf("%s/%s: %v", c.kind, c.lang, err)
		}
		if !strings.Contains(out, "Lilly Mariya") {
			t.Errorf("%s/%s: customer name missing", c.kind, c.lang)
		}
		if strings.Contains(out, "ZgotmplZ") {
			t.Errorf("%s/%s: a value was blocked by the template escaper", c.kind, c.lang)
		}
	}
}
