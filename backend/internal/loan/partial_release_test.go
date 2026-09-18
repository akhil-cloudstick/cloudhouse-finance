package loan

import "testing"

// partialReleaseRemaining/partialReleaseDrift are the two pure eligibility
// checks behind Partial Ornament Release (see their own doc comments in
// service.go) — table-tested directly, the same way bank_pledge_test.go
// exercises bankPledgeRefusal, since both are pure functions with no
// database dependency.
func TestPartialReleaseRemaining(t *testing.T) {
	cases := []struct {
		name                                                            string
		outstandingBalance, principalAmount, remainingGoldValue, ltvPct float64
		want                                                            float64
	}{
		{
			// Buffer = 5% of 100000 = 5000. Needed = 5000 - (150000*75/100=112500) → deeply negative.
			name:               "ample remaining collateral -> negative (condition comfortably met)",
			outstandingBalance: 5000, principalAmount: 100000, remainingGoldValue: 150000, ltvPct: 75,
			want: (5000 + 5000) - 112500,
		},
		{
			// outstanding(40000) + buffer(5% of 20000 = 1000) = 41000;
			// remainingGoldValue(41000/0.75) * 75% = exactly 41000.
			name:               "exact balance -> zero",
			outstandingBalance: 40000, principalAmount: 20000, remainingGoldValue: 41000 / 0.75, ltvPct: 75,
			want: 0,
		},
		{
			name:               "insufficient remaining collateral -> positive shortfall",
			outstandingBalance: 42300, principalAmount: 100000, remainingGoldValue: 127000, ltvPct: 75,
			want: (42300 + 5000) - (127000 * 0.75),
		},
		{
			name:               "zero remaining collateral selected (degenerate) -> full balance+buffer owed",
			outstandingBalance: 10000, principalAmount: 10000, remainingGoldValue: 0, ltvPct: 75,
			want: 10000 + 500,
		},
		{
			name:               "zero outstanding balance, no principal buffer, still needs positive collateral coverage",
			outstandingBalance: 0, principalAmount: 0, remainingGoldValue: 0, ltvPct: 75,
			want: 0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := partialReleaseRemaining(tc.outstandingBalance, tc.principalAmount, tc.remainingGoldValue, tc.ltvPct)
			if diff := got - tc.want; diff > 0.001 || diff < -0.001 {
				t.Fatalf("partialReleaseRemaining(%v, %v, %v, %v) = %v, want %v",
					tc.outstandingBalance, tc.principalAmount, tc.remainingGoldValue, tc.ltvPct, got, tc.want)
			}
		})
	}
}

func TestPartialReleaseDrift(t *testing.T) {
	cases := []struct {
		name                                           string
		outstandingBalance, remainingGoldValue, ltvPct float64
		want                                           float64
	}{
		{
			name:               "collateral comfortably covers balance -> negative",
			outstandingBalance: 5000, remainingGoldValue: 150000, ltvPct: 75,
			want: 5000 - 112500,
		},
		{
			name:               "collateral exactly covers balance -> zero",
			outstandingBalance: 75000, remainingGoldValue: 100000, ltvPct: 75,
			want: 0,
		},
		{
			name:               "balance has drifted above what collateral supports -> positive",
			outstandingBalance: 42300, remainingGoldValue: 50000, ltvPct: 75,
			want: 42300 - 37500,
		},
		{
			name:               "no remaining collateral at all, any balance is pure drift",
			outstandingBalance: 100, remainingGoldValue: 0, ltvPct: 75,
			want: 100,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := partialReleaseDrift(tc.outstandingBalance, tc.remainingGoldValue, tc.ltvPct)
			if diff := got - tc.want; diff > 0.001 || diff < -0.001 {
				t.Fatalf("partialReleaseDrift(%v, %v, %v) = %v, want %v",
					tc.outstandingBalance, tc.remainingGoldValue, tc.ltvPct, got, tc.want)
			}
		})
	}
}
