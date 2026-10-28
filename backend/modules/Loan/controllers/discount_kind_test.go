package controllers

import (
	"strings"
	"testing"

	"cloudhouse/backend/modules/Loan/models"
)

// A loan that owes penal interest, interest and principal.
func discountLoan() *models.Loan {
	return &models.Loan{
		OutstandingAmount:    10000,
		AccruedInterest:      500,
		InterestPaid:         100, // 400 owed
		AccruedPenalInterest: 80,
		PenalInterestPaid:    0, // 80 owed
	}
}

func TestAllocateDiscountKind_Interest(t *testing.T) {
	penal, interest, principal, err := allocateDiscountKind(discountLoan(), 300, DiscountKindInterest)
	if err != nil || penal != 0 || interest != 300 || principal != 0 {
		t.Fatalf("interest discount of 300 = penal %v interest %v principal %v err %v, want 0/300/0", penal, interest, principal, err)
	}
	// it can never reach into principal or penal interest
	if _, _, _, err := allocateDiscountKind(discountLoan(), 450, DiscountKindInterest); err == nil || !strings.Contains(err.Error(), "interest owed") {
		t.Fatalf("an interest discount above the 400 owed must be refused, got %v", err)
	}
}

func TestAllocateDiscountKind_PenalInterest(t *testing.T) {
	penal, interest, principal, err := allocateDiscountKind(discountLoan(), 80, DiscountKindPenalInterest)
	if err != nil || penal != 80 || interest != 0 || principal != 0 {
		t.Fatalf("penal discount of 80 = %v/%v/%v err %v, want 80/0/0", penal, interest, principal, err)
	}
	if _, _, _, err := allocateDiscountKind(discountLoan(), 81, DiscountKindPenalInterest); err == nil || !strings.Contains(err.Error(), "penal interest owed") {
		t.Fatalf("a penal interest discount above the 80 owed must be refused, got %v", err)
	}
}

func TestAllocateDiscountKind_CustomerFallsThroughPenalInterestPrincipal(t *testing.T) {
	for _, kind := range []string{"", DiscountKindCustomer} {
		penal, interest, principal, err := allocateDiscountKind(discountLoan(), 600, kind)
		if err != nil || penal != 80 || interest != 400 || principal != 120 {
			t.Fatalf("kind %q: customer discount of 600 = %v/%v/%v err %v, want penal 80, interest 400, principal 120", kind, penal, interest, principal, err)
		}
	}
}

func TestValidDiscountKind(t *testing.T) {
	for _, ok := range []string{"", "customer", "interest", "penal_interest"} {
		if !validDiscountKind(ok) {
			t.Errorf("%q should be a valid discount kind", ok)
		}
	}
	if validDiscountKind("principal") || validDiscountKind("Interest") {
		t.Error("only customer, interest and penal_interest are valid")
	}
}
