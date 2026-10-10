package controllers

import (
	"cloudhouse/backend/modules/PersonalLoan/models"
	"testing"
	"time"
)

func baseLoanForPenal() *models.PersonalLoan {
	return &models.PersonalLoan{
		ID:                1,
		Status:            models.StatusActive,
		Frequency:         models.FrequencyDaily,
		TenureCount:       100,
		OutstandingAmount: 8000,
		PenalInterestRate: 10,
		GracePeriodDays:   0,
	}
}

func scheduleEndingOn(loanID uint, lastDue time.Time) []models.PersonalLoanInstallment {
	return []models.PersonalLoanInstallment{
		{PersonalLoanID: loanID, SequenceNo: 1, DueDate: lastDue.AddDate(0, 0, -1), Amount: 4000},
		{PersonalLoanID: loanID, SequenceNo: 2, DueDate: lastDue, Amount: 4000},
	}
}

func TestEvaluateAndApplyPenal_NoOpBeforeGracePeriodEnds(t *testing.T) {
	loan := baseLoanForPenal()
	loan.GracePeriodDays = 5
	lastDue := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	installments := scheduleEndingOn(loan.ID, lastDue)
	fires, _, _ := evaluateAndApplyPenal(loan, installments, lastDue.AddDate(0, 0, 3))
	if fires {
		t.Fatal("expected no penal charge before the grace period elapses")
	}
}

func TestEvaluateAndApplyPenal_NoOpWhenFullyPaid(t *testing.T) {
	loan := baseLoanForPenal()
	loan.OutstandingAmount = 0
	lastDue := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	installments := scheduleEndingOn(loan.ID, lastDue)
	fires, _, _ := evaluateAndApplyPenal(loan, installments, lastDue.AddDate(0, 0, 10))
	if fires {
		t.Fatal("expected no penal charge once the loan is fully paid")
	}
}

func TestEvaluateAndApplyPenal_ChargesFullRateOnWholeOutstandingNotAnInstallment(t *testing.T) {
	loan := baseLoanForPenal()
	lastDue := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	installments := scheduleEndingOn(loan.ID, lastDue)
	asOf := lastDue.AddDate(0, 0, 1)
	fires, penalAmount, newInstallments := evaluateAndApplyPenal(loan, installments, asOf)
	if !fires {
		t.Fatal("expected a penal charge to fire once past the last due date with no grace period")
	}
	if want := 800.0; penalAmount != want {
		t.Errorf("penalAmount = %v, want %v", penalAmount, want)
	}
	if len(newInstallments) != loan.TenureCount {
		t.Fatalf("expected a full %d-installment schedule regenerated, got %d", loan.TenureCount, len(newInstallments))
	}
	var sum float64
	for _, inst := range newInstallments {
		sum += inst.Amount
	}
	wantOutstanding := 8800.0
	if diff := sum - wantOutstanding; diff > 0.01 || diff < -0.01 {
		t.Errorf("new schedule sums to %v, want %v", sum, wantOutstanding)
	}
}

func TestEvaluateAndApplyPenal_FlatLoanUsesPenalFlatAmount(t *testing.T) {
	loan := baseLoanForPenal()
	loan.PenalInterestRate = 0
	loan.PenalFlatAmount = 1000
	lastDue := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	installments := scheduleEndingOn(loan.ID, lastDue)
	asOf := lastDue.AddDate(0, 0, 1)
	fires, penalAmount, _ := evaluateAndApplyPenal(loan, installments, asOf)
	if !fires {
		t.Fatal("expected a penal charge to fire using PenalFlatAmount when PenalInterestRate is 0")
	}
	if want := 1000.0; penalAmount != want {
		t.Errorf("penalAmount = %v, want the flat amount %v regardless of OutstandingAmount", penalAmount, want)
	}
}

func TestEvaluateAndApplyPenal_DoesNotDoubleChargeSameCycle(t *testing.T) {
	loan := baseLoanForPenal()
	lastDue := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	installments := scheduleEndingOn(loan.ID, lastDue)
	asOf := lastDue.AddDate(0, 0, 1)
	applied := asOf
	loan.LastPenalAppliedAt = &applied
	fires, _, _ := evaluateAndApplyPenal(loan, installments, asOf.AddDate(0, 0, 1))
	if fires {
		t.Fatal("expected no second penal charge within the same overdue schedule")
	}
}

func TestEvaluateAndApplyPenal_RepeatedCyclesCompound(t *testing.T) {
	loan := baseLoanForPenal()
	lastDue := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	installments := scheduleEndingOn(loan.ID, lastDue)
	asOf1 := lastDue.AddDate(0, 0, 1)
	fires, penal1, newSchedule1 := evaluateAndApplyPenal(loan, installments, asOf1)
	if !fires {
		t.Fatal("expected first cycle to fire")
	}
	if want := 800.0; penal1 != want {
		t.Fatalf("cycle 1 penal = %v, want %v", penal1, want)
	}
	loan.OutstandingAmount += penal1
	loan.LastPenalAppliedAt = &asOf1
	loan.Status = models.StatusPending
	newLastDue := newSchedule1[len(newSchedule1)-1].DueDate
	asOf2 := newLastDue.AddDate(0, 0, 1)
	fires2, penal2, newSchedule2 := evaluateAndApplyPenal(loan, newSchedule1, asOf2)
	if !fires2 {
		t.Fatal("expected second cycle to fire once its own schedule also finishes unpaid (a Pending loan can go through more than one cycle)")
	}
	if want := 880.0; penal2 != want {
		t.Errorf("cycle 2 penal = %v, want %v", penal2, want)
	}
	if penal2 <= penal1 {
		t.Errorf("expected cycle 2's penal charge (%v) to exceed cycle 1's (%v) — compounding on the bumped outstanding", penal2, penal1)
	}
	if len(newSchedule2) != loan.TenureCount {
		t.Fatalf("expected cycle 2's regenerated schedule to also have %d installments, got %d", loan.TenureCount, len(newSchedule2))
	}
}

func TestIsPastGracePeriod(t *testing.T) {
	loan := &models.PersonalLoan{GracePeriodDays: 5}
	lastDue := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	installments := scheduleEndingOn(1, lastDue)
	if isPastGracePeriod(loan, installments, lastDue.AddDate(0, 0, 4)) {
		t.Error("expected not past grace period 4 days after last due date with a 5-day grace period")
	}
	if !isPastGracePeriod(loan, installments, lastDue.AddDate(0, 0, 6)) {
		t.Error("expected past grace period 6 days after last due date with a 5-day grace period")
	}
	if isPastGracePeriod(loan, nil, lastDue.AddDate(0, 0, 100)) {
		t.Error("expected false with no installments to derive a last due date from")
	}
}
