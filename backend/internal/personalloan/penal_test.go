package personalloan

import (
	"testing"
	"time"
)

func baseLoanForPenal() *PersonalLoan {
	return &PersonalLoan{
		ID:                1,
		Status:            StatusActive,
		Frequency:         FrequencyDaily,
		TenureCount:       100,
		OutstandingAmount: 8000,
		PenalInterestRate: 10, // flat 10% per cycle, no proration
		GracePeriodDays:   0,
	}
}

func scheduleEndingOn(loanID uint, lastDue time.Time) []PersonalLoanInstallment {
	return []PersonalLoanInstallment{
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
	// 8000 * 10% = 800, flat — the FULL rate applied once to the whole
	// outstanding balance (8000), never prorated by days/frequency and never
	// computed off a single 4000 installment.
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
	loan.PenalFlatAmount = 1000 // e.g. a Flat loan's own InterestAmount, re-charged per cycle
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
	if want := 800.0; penal1 != want { // 10% of 8000
		t.Fatalf("cycle 1 penal = %v, want %v", penal1, want)
	}
	loan.OutstandingAmount += penal1 // 8800
	loan.LastPenalAppliedAt = &asOf1
	loan.Status = StatusPending

	// Simulate the new cycle also finishing unpaid: advance to its last due
	// date + 1 day.
	newLastDue := newSchedule1[len(newSchedule1)-1].DueDate
	asOf2 := newLastDue.AddDate(0, 0, 1)

	fires2, penal2, newSchedule2 := evaluateAndApplyPenal(loan, newSchedule1, asOf2)
	if !fires2 {
		t.Fatal("expected second cycle to fire once its own schedule also finishes unpaid (a Pending loan can go through more than one cycle)")
	}
	// 10% of the ALREADY-bumped 8800 = 880 — strictly more than cycle 1's
	// 800, since each cycle's flat rate is computed on the new outstanding.
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
	loan := &PersonalLoan{GracePeriodDays: 5}
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
