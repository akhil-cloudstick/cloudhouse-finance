package controllers

import (
	"testing"
)

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
