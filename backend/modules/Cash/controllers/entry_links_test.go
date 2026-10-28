package controllers

import "testing"

func TestInvestmentEntryID(t *testing.T) {
	cases := []struct {
		name         string
		sourceType   string
		inv, tx, pay uint
		want         string
	}{
		{"transaction wins", "investment_deposit", 7, 5, 0, "tx-5"},
		{"withdrawal payout line matched to a transaction", "investment_payout", 7, 9, 0, "tx-9"},
		{"scheduled payout", "investment_payout", 7, 0, 3, "payout-3"},
		{"opening deposit", "investment_deposit", 7, 0, 0, "open-7"},
		{"unmatched payout is refused", "investment_payout", 7, 0, 0, ""},
		{"no investment", "investment_deposit", 0, 0, 0, ""},
	}
	for _, c := range cases {
		if got := investmentEntryID(c.sourceType, c.inv, c.tx, c.pay); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestToLedgerRowLinks(t *testing.T) {
	r := toLedgerRow(ledgerSourceRow{Kind: "personal_loan_payment", ID: 4, PersonalLoanID: 2})
	if r.PersonalLoanID != 2 || r.PaymentID != 4 {
		t.Fatalf("personal payment ids not exposed: %+v", r)
	}
	if r := toLedgerRow(ledgerSourceRow{Kind: "personal_loan_payment", ID: 4, PersonalLoanID: 2, Memo: true}); r.PersonalLoanID != 0 || r.PaymentID != 0 {
		t.Fatalf("a rollover memo row must not be editable: %+v", r)
	}
	a := toLedgerRow(ledgerSourceRow{Kind: "loan_accrual", ID: 8, LoanID: 3, IsOut: true})
	if a.LoanID != 3 || !a.LoanAccrual || a.PaymentID != 0 || a.DebitOrCredit != "debit" {
		t.Fatalf("accrual row: %+v", a)
	}
}
