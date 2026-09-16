package investment

import (
	"context"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// This file implements the day-weighted live accrual engine for
// EngineLive investments — the running-balance replacement for
// EngineSchedule's precomputed generatePayoutSchedule (service.go). It is
// deliberately never called for an EngineSchedule investment.
//
// daysInMonth/addMonths/completedPeriods below are a verbatim duplicate of
// loan/accrual.go's helpers of the same name (calendar-month stepping with
// day-of-month clamping, whole-elapsed-periods counting). Kept as an
// independent copy rather than extracted into a shared platform helper:
// loan/accrual.go is a small, already-tested file backing a live product
// with its own minimum-month floor and penal-interest rules that must never
// be put at risk by a second, differently-shaped consumer — a ~30-line
// duplicate is the lower-blast-radius choice. Any bugfix to loan's version
// should be mirrored here by hand; each copy is covered by its own tests.

// daysInMonth returns the number of days in the given calendar month.
func daysInMonth(y int, m time.Month) int {
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// addMonths adds n calendar months to t, clamping the day-of-month to the
// target month's length (31 Jan + 1 month = 28/29 Feb, not 3 Mar).
func addMonths(t time.Time, n int) time.Time {
	y, m, d := t.Date()
	target := time.Date(y, m, 1, 0, 0, 0, 0, t.Location()).AddDate(0, n, 0)
	ty, tm := target.Year(), target.Month()
	if last := daysInMonth(ty, tm); d > last {
		d = last
	}
	return time.Date(ty, tm, d, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
}

// completedMonthPeriods counts how many WHOLE periods of `months` calendar
// months have elapsed between from and asOf, and returns the exact instant
// that many periods after from — the remainder (the part-period still in
// progress) is deliberately dropped here, for the caller's own leftover-day
// proration.
func completedMonthPeriods(from, asOf time.Time, months int) (int, time.Time) {
	n := 0
	for !addMonths(from, months*(n+1)).After(asOf) {
		n++
	}
	return n, addMonths(from, months*n)
}

// periodsPerYearFor/dayDivisorFor are the per-PayoutFrequency constants the
// day-weighted engine uses. Monthly/Quarterly/Yearly reuse the exact
// /30-per-month day-divisor convention loan/accrual.go already uses for its
// leftover-day charge (extended to /90 and /360 for consistency); Daily/
// Weekly use real calendar day counts instead, since a period that small
// needs no banker's-year approximation.
var periodsPerYearFor = map[string]float64{
	PayoutFrequencyDaily:     365,
	PayoutFrequencyWeekly:    52,
	PayoutFrequencyMonthly:   12,
	PayoutFrequencyQuarterly: 4,
	PayoutFrequencyYearly:    1,
}

var dayDivisorFor = map[string]float64{
	PayoutFrequencyDaily:     1,
	PayoutFrequencyWeekly:    7,
	PayoutFrequencyMonthly:   30,
	PayoutFrequencyQuarterly: 90,
	PayoutFrequencyYearly:    360,
}

// investmentCompletedPeriods generalizes completedMonthPeriods to all five
// PayoutFrequency values — same contract (whole elapsed periods + the exact
// boundary instant).
func investmentCompletedPeriods(period string, from, asOf time.Time) (int, time.Time) {
	switch period {
	case PayoutFrequencyDaily:
		days := int(asOf.Sub(from).Hours() / 24)
		if days < 0 {
			days = 0
		}
		return days, from.AddDate(0, 0, days)
	case PayoutFrequencyWeekly:
		days := int(asOf.Sub(from).Hours() / 24)
		weeks := days / 7
		if weeks < 0 {
			weeks = 0
		}
		return weeks, from.AddDate(0, 0, weeks*7)
	case PayoutFrequencyQuarterly:
		return completedMonthPeriods(from, asOf, 3)
	case PayoutFrequencyYearly:
		return completedMonthPeriods(from, asOf, 12)
	default: // PayoutFrequencyMonthly
		return completedMonthPeriods(from, asOf, 1)
	}
}

// projectAccrual computes the interest that would accrue on inv between
// inv.LastAccrualDate and asOf, WITHOUT mutating inv — mirrors
// loan.projectAccrual's pure, anchor-based shape. Only ever meaningful for
// an EngineLive investment; callers must guard on Engine themselves (this
// function does not check it, so a stray call against an EngineSchedule row
// is harmless — OutstandingPrincipal is 0 for those, so it always returns
// zero — but is not how the discriminator is meant to be enforced).
//
// Simple interest is charged, every period AND the trailing leftover-day
// remainder, on OutstandingPrincipal alone — it never capitalizes unpaid
// interest into the base. Compound interest capitalizes unpaid-but-not-yet-
// withdrawn interest (AccruedInterest - InterestWithdrawn) into the base for
// each WHOLE completed period — exactly loan's Compound-monthly loop,
// generalized to all five periods — and the trailing leftover-day remainder
// is charged against that same running (principal+unpaid) base. This is
// what makes a transaction-free run of the day engine land on exactly the
// same number as the flat per-period formula generatePayoutSchedule uses:
// for one whole period with no leftover, interestDelta =
// OutstandingPrincipal * (rate/100/periodsPerYear), identical to
// generatePayoutSchedule's Simple case, and Compound's per-period
// capitalization chain is the same recurrence generatePayoutSchedule's
// prevCompoundedValue produces.
//
// The anchor-based design (LastAccrualDate only ever advances to exactly
// where the last settlement stopped) is what guarantees no day is ever
// charged twice, including across an Add Cash/Withdraw mid-period: the
// settle-then-mutate callers (Service.AddCash/Withdraw) always call this
// BEFORE changing OutstandingPrincipal, so the old balance prices every day
// up to the transaction and the new balance prices every day after it.
func projectAccrual(inv *Investment, asOf time.Time) (interestDelta float64, newAnchor time.Time) {
	from := inv.LastAccrualDate
	if from.IsZero() {
		from = inv.StartDate
	}
	switch inv.Status {
	case StatusActive, StatusMatured:
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
	case InterestRateTypeCompound:
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
	default: // InterestRateTypeSimple
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

// settleAndSave advances inv's AccruedInterest/LastAccrualDate up to asOf
// and persists the change via tx (or the repository's own db when tx is
// nil) — the transactional counterpart to projectAccrual's pure
// computation. Callers (Get, AddCash, Withdraw) must call this BEFORE
// applying any principal/interest mutation, so the settlement always prices
// against the pre-mutation OutstandingPrincipal.
func (s *Service) settleAndSave(ctx context.Context, tx *gorm.DB, inv *Investment, asOf time.Time) error {
	delta, anchor := projectAccrual(inv, asOf)
	inv.AccruedInterest = platform.RoundMoney(inv.AccruedInterest + delta)
	inv.LastAccrualDate = anchor
	return s.repo.Update(ctx, tx, inv)
}
