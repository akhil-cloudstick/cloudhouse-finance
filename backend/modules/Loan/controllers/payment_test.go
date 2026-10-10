package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"fmt"
	"testing"
)

func TestAllocatePayment_TypeStopsAtItsOwnBucket(t *testing.T) {
	cases := []struct {
		name                            string
		paymentType                     string
		amount                          float64
		fee, penal, interest, principal float64
		wantErr                         error
	}{
		{"penal only stops before interest", models.PaymentTypePenalInterest, 1_500, 500, 1_000, 0, 0, nil},
		{"penal only, part of the penal", models.PaymentTypePenalInterest, 900, 500, 400, 0, 0, nil},
		{"penal only rejects reaching interest", models.PaymentTypePenalInterest, 1_501, 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")},
		{"interest covers penal then interest", models.PaymentTypeInterest, 5_500, 500, 1_000, 4_000, 0, nil},
		{"interest rejects reaching principal", models.PaymentTypeInterest, 5_501, 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")},
		// Principal skips penal and interest entirely, but never the fee.
		{"principal skips interest but not fee", models.PaymentTypePrincipal, 10_500, 500, 0, 0, 10_000, nil},
		{"both runs the full waterfall", models.PaymentTypePartial, 6_000, 500, 1_000, 4_000, 500, nil},
		{"full settlement clears everything", models.PaymentTypeFullSettlement, 55_500, 500, 1_000, 4_000, 50_000, nil},
		{"full settlement refuses a short amount", models.PaymentTypeFullSettlement, 55_499, 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			l := loanOwing(50_000, 4_000, 1_000, 500)
			fee, penal, interest, principal, err := allocatePayment(l, tc.paymentType, tc.amount, nil)
			if fmt.Sprint(err) != fmt.Sprint(tc.wantErr) {
				t.Fatalf("error = %v, want %v", err, tc.wantErr)
			}
			if err != nil {
				return
			}
			if fee != tc.fee || penal != tc.penal || interest != tc.interest || principal != tc.principal {
				t.Fatalf("allocated fee=%.2f penal=%.2f interest=%.2f principal=%.2f, want fee=%.2f penal=%.2f interest=%.2f principal=%.2f",
					fee, penal, interest, principal, tc.fee, tc.penal, tc.interest, tc.principal)
			}
		})
	}
}
