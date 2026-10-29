package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"testing"
)

// An auction edit works from the loan's own figures: taking the sale off gives the balance before it, and applying
// a new sale on that balance gives the figures the loan should end with — no replay of the loan's history.
func TestAuctionSaleEditFromLoanFigures(t *testing.T) {
	// a loan after a sale that cleared everything: ₹31,000 principal and ₹91.67 interest, all paid by the sale
	l := &models.Loan{AccruedInterest: 91.67, InterestPaid: 91.67, OutstandingAmount: 0}
	sale := models.LoanPayment{Amount: 31091.67, InterestApplied: 91.67, PrincipalApplied: 31000}

	before := *l
	takeOffLoan(&before, sale)
	debt := summarize(&before).Total
	if debt != 31091.67 {
		t.Fatalf("balance before the sale = %.2f, want 31091.67", debt)
	}

	// edited down to ₹20,000 less ₹100 expenses: a shortfall, applied to interest first, then principal
	out := computeSaleOutcome(20000, 100, debt)
	if out.Covered || out.Applied != 19900 {
		t.Fatalf("outcome = %+v", out)
	}
	after := before
	fee, penal, interest, principal, err := allocatePayment(&after, models.PaymentTypeAuctionSale, out.Applied, nil)
	if err != nil {
		t.Fatal(err)
	}
	putOnLoan(&after, fee, penal, interest, principal)
	if interest != 91.67 || principal != 19808.33 {
		t.Fatalf("split = interest %.2f principal %.2f", interest, principal)
	}
	if got := summarize(&after).Total; got != out.Shortfall {
		t.Fatalf("left owing %.2f, want the shortfall %.2f", got, out.Shortfall)
	}

	// undoing the sale leaves the loan exactly as it was before it
	if before.OutstandingAmount != 31000 || before.InterestPaid != 0 {
		t.Fatalf("before = %+v", before)
	}
}
