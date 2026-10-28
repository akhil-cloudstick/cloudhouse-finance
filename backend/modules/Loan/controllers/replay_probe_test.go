package controllers

import (
	"testing"

	"cloudhouse/backend/modules/Loan/models"
)

func TestFirstAllocationDiff(t *testing.T) {
	saved := []models.LoanPayment{
		{InterestApplied: 98.63, PrincipalApplied: 900},
		{InterestApplied: 20, PrincipalApplied: 10000, ProcessingFeeApplied: 1000},
	}
	same := []models.LoanPayment{
		{InterestApplied: 98.63, PrincipalApplied: 900},
		{InterestApplied: 20, PrincipalApplied: 10000, ProcessingFeeApplied: 1000},
	}
	if got := firstAllocationDiff(saved, same); got != -1 {
		t.Fatalf("identical splits: got row %d, want -1", got)
	}
	recalculated := []models.LoanPayment{
		{InterestApplied: 98.63, PrincipalApplied: 900},
		{InterestApplied: 98.63, PrincipalApplied: 9921.37, ProcessingFeeApplied: 1000},
	}
	if got := firstAllocationDiff(saved, recalculated); got != 1 {
		t.Fatalf("a payment with its interest typed over: got row %d, want 1", got)
	}
}
