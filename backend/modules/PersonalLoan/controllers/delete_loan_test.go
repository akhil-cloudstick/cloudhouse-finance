package controllers

import (
	"cloudhouse/backend/modules/PersonalLoan/models"
	"strings"
	"testing"
)

func TestLoanDeleteBlocker(t *testing.T) {
	id := uint(7)
	cases := []struct {
		name     string
		loan     models.PersonalLoan
		payments int64
		want     string // substring of the reason; "" means deletable
	}{
		{"plain loan, no payments", models.PersonalLoan{}, 0, ""},
		{"loan with payments", models.PersonalLoan{}, 3, "3 payment entries"},
		{"single payment wording", models.PersonalLoan{}, 1, "1 payment entry"},
		{"renewed into another", models.PersonalLoan{RenewedToLoanID: &id}, 0, "renewed into"},
		{"created by a renewal", models.PersonalLoan{RenewedFromLoanID: &id}, 0, "renewing another"},
	}
	for _, tc := range cases {
		got := loanDeleteBlocker(&tc.loan, tc.payments)
		if tc.want == "" && got != "" || tc.want != "" && !strings.Contains(got, tc.want) {
			t.Errorf("%s: got %q, want containing %q", tc.name, got, tc.want)
		}
	}
}
