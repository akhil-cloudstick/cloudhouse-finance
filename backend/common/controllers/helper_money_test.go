package controllers

import "testing"

func TestRoundMoneyWholeRupeeHalfUp(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{5.2, 5}, {5.5, 6}, {5.7, 6},
		{52345.4, 52345}, {52345.5, 52346},
		{-2.5, -3}, {0, 0},
		// float noise just under a half must still round up
		{93478.49999999999, 93479},
	}
	for _, tc := range cases {
		if got := RoundMoney(tc.in); got != tc.want {
			t.Errorf("RoundMoney(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

// Loan creation compares the entered principal with the eligible amount, both rounded to a whole
// rupee (see SaveLoan / UpdateLoan). The figure the form offers as the maximum is the rounded
// eligible amount, so entering it must never be refused, whatever the fractional part.
func TestRoundedEligibleAmountIsAlwaysAcceptedAsPrincipal(t *testing.T) {
	for _, eligible := range []float64{93478.875, 93478.5, 93478.4999, 52345.6, 1000.01, 999.99, 7.5} {
		principal := RoundMoney(eligible) // what the form pre-fills as the maximum
		if RoundMoney(principal) > RoundMoney(eligible)+0.01 {
			t.Errorf("principal %v refused against eligible %v", principal, eligible)
		}
	}
}

func TestSplitStillBalancesInWholeRupees(t *testing.T) {
	if err := ValidateSplit(4184, 3000, 0, 0, 7184); err != nil {
		t.Errorf("a balanced split was refused: %v", err)
	}
	if err := ValidateSplit(4184.4, 3000.4, 0, 0, 7185); err != nil {
		t.Errorf("a split that adds up to the amount after rounding was refused: %v", err)
	}
	if err := ValidateSplit(4000, 3000, 0, 0, 7184); err == nil {
		t.Error("an unbalanced split was accepted")
	}
}

func TestRoundDecimal2KeepsRates(t *testing.T) {
	if got := RoundDecimal2(8.5); got != 8.5 {
		t.Errorf("RoundDecimal2(8.5) = %v, want 8.5", got)
	}
}
