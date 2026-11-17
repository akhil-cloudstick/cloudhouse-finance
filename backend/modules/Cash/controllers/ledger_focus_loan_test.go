package controllers

import (
	"testing"
	"time"
)

// disbursalRow is a gold-loan disbursal cash line exactly as the cash-movement ledger scans build it: the loan
// number lives only in the purpose ("Loan disbursement — LN-00069"), and LoanNumber stays empty because the
// loan_cash_sources join only matches lender (borrowed-funds) lines.
func disbursalRow(id uint, loanNumber string, on time.Time, amount float64) ledgerSourceRow {
	purpose := "Loan disbursement — " + loanNumber
	return ledgerSourceRow{
		Kind: "cash_movement", ID: id, Date: on, Description: purpose, Method: "Cash",
		Reference: refOrPurpose("", purpose), Amount: amount, CustomerID: 7, CustomerName: "Same Customer", IsOut: true,
	}
}

// Two loans for the same customer, same day, same amount: opening the Cash ledger from LN-00069's page must
// focus LN-00069's line, not whichever of the two happens to come first.
func TestFocusMatchesPrefersTheLoanTheUserCameFrom(t *testing.T) {
	on := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	rows := []ledgerSourceRow{
		disbursalRow(171, "LN-00070", on, 50000),
		disbursalRow(170, "LN-00069", on, 50000),
	}
	f := ledgerFocus{date: "2026-11-10", amount: 50000, loan: "LN-00069"}
	if got := focusRowIndex(rows, f); got != 1 {
		t.Fatalf("focused row %d (%s), want 1 (LN-00069)", got, rows[max(got, 0)].Reference)
	}
	f.loan = "LN-00070"
	if got := focusRowIndex(rows, f); got != 0 {
		t.Fatalf("focused row %d (%s), want 0 (LN-00070)", got, rows[max(got, 0)].Reference)
	}
}

// The reported case end to end through the ledger's own ordering and page maths: LN-00070 was approved later the
// same day, so it sorts above LN-00069, and the two land on either side of a page break. The ledger must open on
// the page holding LN-00069's line, not LN-00070's.
func TestFocusPageAcrossPageBreakIsTheLoanTheUserCameFrom(t *testing.T) {
	const pageSize = 12 // PARTY_PAGE_SIZE
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, time.Local)
	rows := []ledgerSourceRow{
		disbursalRow(170, "LN-00069", day.Add(10*time.Hour), 50000),
		disbursalRow(171, "LN-00070", day.Add(15*time.Hour), 50000),
	}
	// 11 newer lines push LN-00070 to the last row of page 1 and LN-00069 to the first row of page 2.
	for i := 0; i < 11; i++ {
		rows = append(rows, ledgerSourceRow{Kind: "cash_movement", ID: uint(200 + i), Date: day.AddDate(0, 0, 1).Add(time.Duration(i) * time.Minute), Amount: 100, Method: "Cash"})
	}
	sortLedgerSourceRows(rows)

	for _, tc := range []struct {
		loan     string
		wantPage int
	}{{"LN-00069", 2}, {"LN-00070", 1}} {
		f := ledgerFocus{date: "2026-11-10", amount: 50000, loan: tc.loan}
		idx := focusRowIndex(rows, f)
		if idx < 0 {
			t.Fatalf("%s: no row focused", tc.loan)
		}
		if got := rows[idx].Reference; got != tc.loan {
			t.Errorf("%s: focused %s's line", tc.loan, got)
		}
		if page := idx/pageSize + 1; page != tc.wantPage {
			t.Errorf("%s: opened page %d, want %d", tc.loan, page, tc.wantPage)
		}
	}
}
