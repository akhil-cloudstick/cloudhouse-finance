package controllers

import (
	"testing"
	"time"
)

// A repayment's info lists what it paid, each part met from cash first, then UPI, then bank transfer.
func TestLoanRepaymentSplitIsMetFromCashThenUpiThenBank(t *testing.T) {
	got := loanRepaymentSplit("Partial", 500, 2500, 7000, 0, 10000, splitParts{Cash: 1000, Upi: 4000, BankTransfer: 5000}, "Split")
	want := []LedgerSplitLine{
		{"Penal Interest", "Cash", 500},
		{"Interest", "Cash", 500},
		{"Interest", "UPI", 2000},
		{"Principal", "UPI", 2000},
		{"Principal", "Bank Transfer", 5000},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// A mode that was not used is skipped: the next one covers that part.
func TestLoanRepaymentSplitSkipsAnUnusedMode(t *testing.T) {
	got := loanRepaymentSplit("Interest", 0, 3000, 0, 0, 3000, splitParts{BankTransfer: 3000}, "Bank Transfer")
	if len(got) != 1 || got[0] != (LedgerSplitLine{"Interest", "Bank Transfer", 3000}) {
		t.Fatalf("got %+v", got)
	}
}

// Older rows whose parts do not add up, and auction proceeds (already shown part by part), have no split.
func TestLoanRepaymentSplitIsEmptyWhenPartsAreUnknown(t *testing.T) {
	if got := loanRepaymentSplit("Partial", 0, 0, 0, 0, 5000, splitParts{Cash: 5000}, "Cash"); got != nil {
		t.Errorf("want none for a payment with no recorded parts, got %+v", got)
	}
	if got := loanRepaymentSplit("Auction Sale", 0, 100, 900, 0, 1000, splitParts{Cash: 1000}, "Cash"); got != nil {
		t.Errorf("want none for an auction sale, got %+v", got)
	}
}

// A collection on a personal loan pays outstanding penal interest first, then the loan's interest, then principal.
func TestPersonalPaymentComponentsPenalThenInterestThenPrincipal(t *testing.T) {
	d0 := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	penal := []PersonalCharge{{At: d0.AddDate(0, 0, 2), Amount: 600}}
	payments := []PersonalPayment{
		{ID: 1, At: d0.AddDate(0, 0, 5), Amount: 1000}, // 600 penal + 400 of the 500 interest
		{ID: 2, At: d0.AddDate(0, 0, 9), Amount: 3000}, // the last 100 interest + 2,900 principal
		{ID: 3, At: d0.AddDate(0, 0, 12), Amount: 4000, Rollover: true},
	}
	got := PersonalPaymentComponents(500, penal, payments)
	want := map[uint][]PayComponent{
		1: {{"Penal Interest", 600}, {"Interest", 400}},
		2: {{"Interest", 100}, {"Principal", 2900}},
	}
	for id, w := range want {
		g := got[id]
		if len(g) != len(w) {
			t.Fatalf("payment %d = %+v, want %+v", id, g, w)
		}
		for i := range w {
			if g[i] != w[i] {
				t.Errorf("payment %d part %d = %+v, want %+v", id, i, g[i], w[i])
			}
		}
	}
	if len(got[3]) != 0 {
		t.Errorf("a renewal rollover has no split, got %+v", got[3])
	}
}

// A penal charge applied after an earlier payment only takes the later payments.
func TestPersonalPaymentComponentsPenalAppliedLaterIsNotTakenEarlier(t *testing.T) {
	d0 := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	penal := []PersonalCharge{{At: d0.AddDate(0, 0, 10), Amount: 300}}
	payments := []PersonalPayment{
		{ID: 1, At: d0.AddDate(0, 0, 3), Amount: 200},
		{ID: 2, At: d0.AddDate(0, 0, 11), Amount: 500},
	}
	got := PersonalPaymentComponents(0, penal, payments)
	if len(got[1]) != 1 || got[1][0] != (PayComponent{"Principal", 200}) {
		t.Errorf("payment 1 = %+v, want 200 principal", got[1])
	}
	if len(got[2]) != 2 || got[2][0] != (PayComponent{"Penal Interest", 300}) || got[2][1] != (PayComponent{"Principal", 200}) {
		t.Errorf("payment 2 = %+v, want 300 penal + 200 principal", got[2])
	}
}
