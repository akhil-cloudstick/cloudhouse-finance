package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"testing"
	"time"
)

// Interest owed when paying on a given day, for the same 30 / 60 / thereafter
// ladder with a 30, 60 or 90 day minimum: the minimum period is owed in full if
// the payment falls inside it, otherwise the actual days up to the payment.
func TestPaymentDate_InterestByMinimumAndDay(t *testing.T) {
	opened := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	ladder := []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 24}, {Days: 0, Rate: 36}}
	cases := []struct {
		minimum, day int
		rate         float64
		days         int
	}{
		{30, 20, 12, 30}, {30, 45, 24, 45}, {30, 75, 24, 75}, {30, 100, 36, 100},
		{60, 20, 24, 60}, {60, 45, 24, 60}, {60, 75, 24, 75}, {60, 100, 36, 100},
		{90, 20, 24, 90}, {90, 45, 24, 90}, {90, 75, 24, 90}, {90, 100, 36, 100},
	}
	for _, c := range cases {
		l := multipleLoan(opened, c.minimum)
		l.OutstandingAmount, l.PrincipalAmount = 1000, 1000
		l.SchemeRateTiers = ladder
		paidOn := plusDays(opened, c.day)
		for i := 0; i < 5; i++ {
			interest, _, anchor, level, _ := projectAccrualThrough(l, paidOn, true, nil)
			l.AccruedInterest += interest
			l.LastAccrualDate = anchor
			l.RateTierLevel = level
		}
		nearly(t, l.AccruedInterest, interestFor(1000, c.rate, opened, plusDays(opened, c.days)), "")
	}
}
