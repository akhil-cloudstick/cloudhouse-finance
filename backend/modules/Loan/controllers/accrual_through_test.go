package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
	"testing"
	"time"
)

// payThrough applies the two passes a payment makes: interest charged up to
// the payment date, part-finished period included.
func payThrough(l *models.Loan, asOf time.Time) {
	for i := 0; i < 2; i++ {
		interest, _, anchor, level, _ := projectAccrualThrough(l, asOf, true, nil)
		l.AccruedInterest += interest
		l.LastAccrualDate = anchor
		l.RateTierLevel = level
	}
}

func ladderLoan(opened time.Time, minimum int) *models.Loan {
	l := multipleLoan(opened, minimum)
	l.OutstandingAmount, l.PrincipalAmount = 1000, 1000
	l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 24}, {Days: 0, Rate: 36}}
	return l
}

// Paying inside the minimum period owes the whole minimum period.
func TestPayThrough_BeforeMinimumPaysMinimumDays(t *testing.T) {
	opened := monthStart(1)
	for _, c := range []struct {
		minimum int
		rate    float64
	}{{60, 24}, {90, 24}} {
		l := ladderLoan(opened, c.minimum)
		payThrough(l, plusDays(opened, 45))
		nearly(t, l.AccruedInterest, interestFor(1000, c.rate, opened, plusDays(opened, c.minimum)), "the minimum days at the step they reach")
		if !l.LastAccrualDate.Equal(plusDays(opened, c.minimum)) {
			t.Fatalf("min %d: charged to %s, want day %d", c.minimum, l.LastAccrualDate, c.minimum)
		}
	}
}

// Paying after the minimum period owes interest for exactly the days elapsed.
func TestPayThrough_AfterMinimumPaysActualDays(t *testing.T) {
	opened := monthStart(1)
	l := ladderLoan(opened, 30)
	payThrough(l, plusDays(opened, 45))
	nearly(t, l.AccruedInterest, interestFor(1000, 24, opened, plusDays(opened, 45)), "45 days, all at 24%")
	if !l.LastAccrualDate.Equal(plusDays(opened, 45)) {
		t.Fatalf("charged to %s, want the payment date", l.LastAccrualDate)
	}

	l = ladderLoan(opened, 90)
	payThrough(l, plusDays(opened, 100))
	nearly(t, l.AccruedInterest, interestFor(1000, 36, opened, plusDays(opened, 100)), "100 days, all at 36%")
}

// With no minimum, paying early charges only the days elapsed.
func TestPayThrough_NoMinimumChargesDaysElapsed(t *testing.T) {
	opened := monthStart(1)
	l := ladderLoan(opened, 0)
	payThrough(l, plusDays(opened, 10))
	nearly(t, l.AccruedInterest, interestFor(1000, 12, opened, plusDays(opened, 10)), "10 days at 12%")
}

// The same on a normal scheme, which charges 1% a month: the part-finished
// month is charged by the day.
func TestPayThrough_NormalSchemeChargesDaysElapsed(t *testing.T) {
	opened := monthStart(1)
	l := normalLoan(opened)
	payThrough(l, plusDays(opened, 10))
	nearly(t, l.AccruedInterest, 1000*10.0/30, "10 days of a 1% month")

	l = normalLoan(opened)
	payThrough(l, plusDays(opened, 45)) // 15 Feb
	nearly(t, l.AccruedInterest, 1000+1000*14.0/30, "the first month, then 14 days of the next")
	if !l.LastAccrualDate.Equal(plusDays(opened, 45)) {
		t.Fatalf("charged to %s, want the payment date", l.LastAccrualDate)
	}
}

// Without the payment flow nothing changes: only completed periods are charged.
func TestAccrue_WithoutThroughStopsAtCompletedPeriods(t *testing.T) {
	opened := monthStart(1)
	l := ladderLoan(opened, 0)
	accrue(l, plusDays(opened, 45))
	nearly(t, l.AccruedInterest, interestFor(1000, 12, opened, plusDays(opened, 30)), "only the first 30 days")
}
