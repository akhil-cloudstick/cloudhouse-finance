package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
	"testing"
	"time"
)

func basisLoan(basis string, opened, lastAccrual time.Time) *models.Loan {
	return &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    100_000,
		OpenedDate:           opened,
		LastAccrualDate:      lastAccrual,
		DueDate:              opened.AddDate(1, 0, 0),
		SchemeInterestRate:   12,
		SchemeInterestMethod: "Monthly simple interest",
		SchemeAccrualBasis:   basis,
	}
}

func TestMonthlyBasis_EveryMonthIsRateOverTwelveWhateverItsLength(t *testing.T) {
	// February (28 days), March (31) and April (30) each cost exactly one month's interest
	for _, start := range []time.Time{
		time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC),
	} {
		l := basisLoan(commonModels.AccrualBasisMonthly, start, start)
		i, _, _ := projectAccrual(l, addMonths(start, 1), nil)
		nearly(t, i, 1000, "a full month on the monthly basis is rate / 12 for "+start.Month().String())
	}
}

func TestMonthlyBasis_LeftoverDaysAreRateOverTwelveOverThirty(t *testing.T) {
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	last := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	l := basisLoan(commonModels.AccrualBasisMonthly, opened, last)
	// 16 days past the last charge: 100000 × 12 / 12 / 30 × 16 / 100
	i, _, _, _, _ := projectAccrualThrough(l, last.AddDate(0, 0, 16), true, nil)
	nearly(t, i, 100_000*0.12/12/30*16, "16 leftover days")
}

func TestMonthlyBasis_MonthsPlusDays(t *testing.T) {
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := basisLoan(commonModels.AccrualBasisMonthly, opened, opened)
	// the first charge covers the first month; the 16 days after it are charged on the next one
	settled := opened.AddDate(0, 1, 16)
	i, _, anchor, _, _ := projectAccrualThrough(l, settled, true, nil)
	nearly(t, i, 1000, "the first month")
	l.LastAccrualDate = anchor
	i, _, _, _, _ = projectAccrualThrough(l, settled, true, nil)
	nearly(t, i, 100_000*0.12/12/30*16, "the 16 days after the first month")
}

func TestDailyBasis_IsUnchanged(t *testing.T) {
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	last := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	l := basisLoan(commonModels.AccrualBasisDaily, opened, last)
	i, _, _, _, _ := projectAccrualThrough(l, last.AddDate(0, 0, 16), true, nil)
	nearly(t, i, 100_000*0.12/365*16, "daily basis uses 365")
	// an empty basis (loans from before the column) behaves as daily
	l.SchemeAccrualBasis = ""
	i, _, _, _, _ = projectAccrualThrough(l, last.AddDate(0, 0, 16), true, nil)
	nearly(t, i, 100_000*0.12/365*16, "empty basis is daily")
}

func TestMonthlyBasis_MultipleInterestChargesCalendarMonths(t *testing.T) {
	opened := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	l := basisLoan(commonModels.AccrualBasisMonthly, opened, opened)
	l.SchemeInterestMethod = commonModels.InterestMethodMultiple
	l.SchemeRateTiers = []commonModels.RateTier{{Days: 90, Rate: 12}, {Days: 0, Rate: 24}}
	// February is 28 days but the first month is still rate / 12
	i, _, anchor, _, _ := projectAccrualThrough(l, addMonths(opened, 1), false, nil)
	nearly(t, i, 1000, "first Multiple-interest month on the monthly basis")
	if !anchor.Equal(addMonths(opened, 1)) {
		t.Fatalf("anchor should be one calendar month on, got %s", anchor)
	}
}

func TestMinimumPeriod_MonthlyChargesDaysOverThirty(t *testing.T) {
	opened := time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		basis   string
		minDays int
		want    float64
	}{
		{commonModels.AccrualBasisMonthly, 30, 25_000 * 0.18 / 12},
		{commonModels.AccrualBasisMonthly, 45, 25_000 * 0.18 / 12 / 30 * 45},
		{commonModels.AccrualBasisDaily, 30, 25_000 * 0.18 / 365 * 30},
	} {
		l := basisLoan(c.basis, opened, opened)
		l.OutstandingAmount, l.SchemeInterestRate, l.SchemeMinimumDays = 25_000, 18, c.minDays
		i, _, _, _, _ := projectAccrualThrough(l, opened, true, nil)
		nearly(t, i, c.want, c.basis)
	}
}
