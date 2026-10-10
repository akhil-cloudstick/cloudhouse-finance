package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Investment/models"
	"context"
	"time"

	"gorm.io/gorm"
)

var periodsPerYearFor = map[string]float64{
	models.PayoutFrequencyDaily:     365,
	models.PayoutFrequencyWeekly:    52,
	models.PayoutFrequencyMonthly:   12,
	models.PayoutFrequencyQuarterly: 4,
	models.PayoutFrequencyYearly:    1,
}

var dayDivisorFor = map[string]float64{
	models.PayoutFrequencyDaily:     1,
	models.PayoutFrequencyWeekly:    7,
	models.PayoutFrequencyMonthly:   30,
	models.PayoutFrequencyQuarterly: 90,
	models.PayoutFrequencyYearly:    360,
}

func daysInMonth(y int, m time.Month) int {
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func addMonths(t time.Time, n int) time.Time {
	y, m, d := t.Date()
	target := time.Date(y, m, 1, 0, 0, 0, 0, t.Location()).AddDate(0, n, 0)
	ty, tm := target.Year(), target.Month()
	if last := daysInMonth(ty, tm); d > last {
		d = last
	}
	return time.Date(ty, tm, d, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
}

func completedMonthPeriods(from, asOf time.Time, months int) (int, time.Time) {
	n := 0
	for !addMonths(from, months*(n+1)).After(asOf) {
		n++
	}
	return n, addMonths(from, months*n)
}

func investmentCompletedPeriods(period string, from, asOf time.Time) (int, time.Time) {
	switch period {
	case models.PayoutFrequencyDaily:
		days := int(asOf.Sub(from).Hours() / 24)
		if days < 0 {
			days = 0
		}
		return days, from.AddDate(0, 0, days)
	case models.PayoutFrequencyWeekly:
		days := int(asOf.Sub(from).Hours() / 24)
		weeks := days / 7
		if weeks < 0 {
			weeks = 0
		}
		return weeks, from.AddDate(0, 0, weeks*7)
	case models.PayoutFrequencyQuarterly:
		return completedMonthPeriods(from, asOf, 3)
	case models.PayoutFrequencyYearly:
		return completedMonthPeriods(from, asOf, 12)
	default:
		return completedMonthPeriods(from, asOf, 1)
	}
}

func projectAccrual(inv *models.Investment, asOf time.Time) (interestDelta float64, newAnchor time.Time) {
	from := inv.LastAccrualDate
	if from.IsZero() {
		from = inv.StartDate
	}
	switch inv.Status {
	case models.StatusActive, models.StatusMatured:
	default:
		return 0, from
	}
	if !asOf.After(from) || inv.OutstandingPrincipal <= 0 {
		return 0, from
	}
	period := inv.PayoutFrequency
	annualRate := inv.InterestRatePercent / 100
	ratePerPeriod := annualRate / periodsPerYearFor[period]
	dailyRate := ratePerPeriod / dayDivisorFor[period]
	periods, boundary := investmentCompletedPeriods(period, from, asOf)
	leftoverDays := asOf.Sub(boundary).Hours() / 24
	switch inv.InterestRateType {
	case models.InterestRateTypeCompound:
		unpaid := inv.AccruedInterest - inv.InterestWithdrawn
		if unpaid < 0 {
			unpaid = 0
		}
		for i := 0; i < periods; i++ {
			d := (inv.OutstandingPrincipal + unpaid) * ratePerPeriod
			interestDelta += d
			unpaid += d
		}
		if leftoverDays > 0 {
			interestDelta += (inv.OutstandingPrincipal + unpaid) * dailyRate * leftoverDays
		}
	default:
		interestDelta = inv.OutstandingPrincipal * ratePerPeriod * float64(periods)
		if leftoverDays > 0 {
			interestDelta += inv.OutstandingPrincipal * dailyRate * leftoverDays
		}
	}
	if interestDelta < 0 {
		interestDelta = 0
	}
	return interestDelta, asOf
}

func settleAndSave(ctx context.Context, tx *gorm.DB, inv *models.Investment, asOf time.Time) error {
	delta, anchor := projectAccrual(inv, asOf)
	inv.AccruedInterest = common.RoundMoney(inv.AccruedInterest + delta)
	inv.LastAccrualDate = anchor
	return persistInvestment(ctx, tx, inv)
}
