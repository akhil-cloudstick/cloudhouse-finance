package personalloan

import (
	"testing"
	"time"
)

func TestComputeInterest(t *testing.T) {
	cases := []struct {
		name         string
		principal    float64
		interestType string
		value        float64
		want         float64
	}{
		{"flat", 5000, InterestTypeFlat, 100, 100},
		{"percentage", 5000, InterestTypePercentage, 2, 100},
		{"percentage rounds", 4999, InterestTypePercentage, 2.5, 124.98},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := computeInterest(tc.principal, tc.interestType, tc.value)
			if got != tc.want {
				t.Errorf("computeInterest(%v, %v, %v) = %v, want %v", tc.principal, tc.interestType, tc.value, got, tc.want)
			}
		})
	}
}

func TestGenerateSchedule_LastInstallmentAbsorbsRounding(t *testing.T) {
	loan := &PersonalLoan{
		PrincipalAmount:   5000,
		Frequency:         FrequencyDaily,
		TenureCount:       3,
		InstallmentAmount: 1666.67, // 5000/3 rounded
		OpenedDate:        time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	installments := generateSchedule(loan)
	if len(installments) != 3 {
		t.Fatalf("expected 3 installments, got %d", len(installments))
	}
	var sum float64
	for _, inst := range installments {
		sum += inst.Amount
	}
	if diff := sum - loan.PrincipalAmount; diff > 0.01 || diff < -0.01 {
		t.Errorf("schedule sums to %v, want %v", sum, loan.PrincipalAmount)
	}
	if installments[0].Amount != 1666.67 || installments[1].Amount != 1666.67 {
		t.Errorf("expected first two installments to be the fixed amount, got %v, %v", installments[0].Amount, installments[1].Amount)
	}
	last := installments[2].Amount
	if last != 1666.66 {
		t.Errorf("expected last installment to absorb rounding drift (1666.66), got %v", last)
	}
}

func TestGenerateSchedule_DueDatesStepByFrequency(t *testing.T) {
	loan := &PersonalLoan{
		PrincipalAmount:   300,
		Frequency:         FrequencyWeekly,
		TenureCount:       3,
		InstallmentAmount: 100,
		OpenedDate:        time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	installments := generateSchedule(loan)
	want := []time.Time{
		time.Date(2026, 1, 8, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 1, 22, 0, 0, 0, 0, time.UTC),
	}
	for i, inst := range installments {
		if !inst.DueDate.Equal(want[i]) {
			t.Errorf("installment %d due date = %v, want %v", i, inst.DueDate, want[i])
		}
	}
}
