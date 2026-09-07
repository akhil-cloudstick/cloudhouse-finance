package loan

import "testing"

// The allocation waterfall is fee → penal → interest → principal, and each
// payment type stops at a different point along it. loanOwing (accrual_test.go)
// builds a loan owing an exact amount in each bucket, so each case here states
// what is owed and asserts exactly where the money lands.
//
// The "Penal Interest" type is the newest and the easiest to get wrong: it must
// stop one bucket EARLIER than "Interest", leaving the regular interest owing.
func TestAllocatePayment_TypeStopsAtItsOwnBucket(t *testing.T) {
	// Owed: fee 500, penal 1,000, interest 4,000, principal 50,000.
	cases := []struct {
		name                            string
		paymentType                     string
		amount                          float64
		fee, penal, interest, principal float64
		wantErr                         error
	}{
		{"penal only stops before interest", PaymentTypePenalInterest, 1_500, 500, 1_000, 0, 0, nil},
		{"penal only, part of the penal", PaymentTypePenalInterest, 900, 500, 400, 0, 0, nil},
		{"penal only rejects reaching interest", PaymentTypePenalInterest, 1_501, 0, 0, 0, 0, ErrExceedsOutstanding},

		// Interest pays penal FIRST — penal interest is interest too.
		{"interest covers penal then interest", PaymentTypeInterest, 5_500, 500, 1_000, 4_000, 0, nil},
		{"interest rejects reaching principal", PaymentTypeInterest, 5_501, 0, 0, 0, 0, ErrExceedsOutstanding},

		// Principal skips penal and interest entirely, but never the fee.
		{"principal skips interest but not fee", PaymentTypePrincipal, 10_500, 500, 0, 0, 10_000, nil},

		{"both runs the full waterfall", PaymentTypePartial, 6_000, 500, 1_000, 4_000, 500, nil},
		{"full settlement clears everything", PaymentTypeFullSettlement, 55_500, 500, 1_000, 4_000, 50_000, nil},
		{"full settlement refuses a short amount", PaymentTypeFullSettlement, 55_499, 0, 0, 0, 0, ErrExceedsOutstanding},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			l := loanOwing(50_000, 4_000, 1_000, 500)
			fee, penal, interest, principal, err := allocatePayment(l, tc.paymentType, tc.amount)
			if err != tc.wantErr {
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
