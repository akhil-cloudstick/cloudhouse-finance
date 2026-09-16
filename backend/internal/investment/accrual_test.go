package investment

import (
	"math"
	"testing"
	"time"
)

func approxEqual(t *testing.T, got, want float64, msg string) {
	t.Helper()
	if math.Abs(got-want) > 0.01 {
		t.Fatalf("%s: got %.4f, want %.4f", msg, got, want)
	}
}

// day returns a UTC time.Time n days after the 1st of a fixed base month —
// a convenient stand-in for "day n of the month" in these tests.
func day(n int) time.Time {
	return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, n)
}

// TestProjectAccrual_MidMonthTopUp is the exact worked example from the
// design: 100 principal, +50 on day 14 of a 30-day month, Monthly Simple —
// interest for that month must equal
// interest_on(100, month)/30*14 + interest_on(150, month)/30*16, with day
// 0-14 never re-priced against 150 and day 14-30 never re-priced against
// 100 (no double counting).
func TestProjectAccrual_MidMonthTopUp(t *testing.T) {
	const rate = 12.0 // 12% p.a. => monthly rate 1%
	inv := &Investment{
		Status:               StatusActive,
		Engine:               EngineLive,
		InterestRateType:     InterestRateTypeSimple,
		PayoutFrequency:      PayoutFrequencyMonthly,
		InterestRatePercent:  rate,
		OutstandingPrincipal: 100,
		StartDate:            day(0),
		LastAccrualDate:      day(0),
	}

	// Settle up to day 14 (the moment of the top-up), against the OLD
	// principal (100).
	delta1, anchor1 := projectAccrual(inv, day(14))
	monthlyRate := rate / 100 / 12
	want1 := 100 * (monthlyRate / 30) * 14
	approxEqual(t, delta1, want1, "first segment (100 principal, 14 days)")
	if !anchor1.Equal(day(14)) {
		t.Fatalf("anchor should advance to day 14, got %v", anchor1)
	}

	// Apply the settlement + the deposit, exactly as AddCash would.
	inv.AccruedInterest += delta1
	inv.LastAccrualDate = anchor1
	inv.OutstandingPrincipal = 150

	// Settle the rest of the month (day 14 -> day 30) against the NEW
	// principal (150).
	delta2, anchor2 := projectAccrual(inv, day(30))
	want2 := 150 * (monthlyRate / 30) * 16
	approxEqual(t, delta2, want2, "second segment (150 principal, 16 days)")
	if !anchor2.Equal(day(30)) {
		t.Fatalf("anchor should advance to day 30, got %v", anchor2)
	}

	total := delta1 + delta2
	wantTotal := want1 + want2
	approxEqual(t, total, wantTotal, "total month interest")
}

// TestProjectAccrual_SimpleWholePeriodMatchesFlatFormula proves requirement
// 5: for a transaction-free whole period, the day-engine's output must
// equal the flat per-period formula (principal * rate/100/periodsPerYear)
// for every period type — no drift between the two.
func TestProjectAccrual_SimpleWholePeriodMatchesFlatFormula(t *testing.T) {
	cases := []struct {
		name    string
		period  string
		advance func(time.Time) time.Time
	}{
		{"Daily", PayoutFrequencyDaily, func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }},
		{"Weekly", PayoutFrequencyWeekly, func(t time.Time) time.Time { return t.AddDate(0, 0, 7) }},
		{"Monthly", PayoutFrequencyMonthly, func(t time.Time) time.Time { return addMonths(t, 1) }},
		{"Quarterly", PayoutFrequencyQuarterly, func(t time.Time) time.Time { return addMonths(t, 3) }},
		{"Yearly", PayoutFrequencyYearly, func(t time.Time) time.Time { return addMonths(t, 12) }},
	}
	const rate = 8.0
	const principal = 100000.0
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start := day(0)
			inv := &Investment{
				Status:               StatusActive,
				Engine:               EngineLive,
				InterestRateType:     InterestRateTypeSimple,
				PayoutFrequency:      c.period,
				InterestRatePercent:  rate,
				OutstandingPrincipal: principal,
				StartDate:            start,
				LastAccrualDate:      start,
			}
			asOf := c.advance(start)
			delta, anchor := projectAccrual(inv, asOf)
			want := principal * (rate / 100 / periodsPerYearFor[c.period])
			approxEqual(t, delta, want, c.name+" whole period vs flat formula")
			if !anchor.Equal(asOf) {
				t.Fatalf("%s: anchor should land exactly on asOf, got %v want %v", c.name, anchor, asOf)
			}
		})
	}
}

// TestProjectAccrual_CompoundCapitalizesOnlyForCompound checks that Simple
// interest never capitalizes unpaid interest into the base (two whole
// months should earn exactly 2x one month's flat interest), while Compound
// earns strictly more in the second month than the first (unpaid interest
// itself now earning interest).
func TestProjectAccrual_CompoundCapitalizesOnlyForCompound(t *testing.T) {
	const rate = 12.0
	const principal = 100000.0
	start := day(0)

	simple := &Investment{
		Status: StatusActive, Engine: EngineLive, InterestRateType: InterestRateTypeSimple,
		PayoutFrequency: PayoutFrequencyMonthly, InterestRatePercent: rate,
		OutstandingPrincipal: principal, StartDate: start, LastAccrualDate: start,
	}
	deltaSimple, anchor := projectAccrual(simple, addMonths(start, 2))
	monthlyRate := rate / 100 / 12
	wantSimple := principal * monthlyRate * 2
	approxEqual(t, deltaSimple, wantSimple, "simple: 2 months = exactly 2x flat monthly interest")
	_ = anchor

	compound := &Investment{
		Status: StatusActive, Engine: EngineLive, InterestRateType: InterestRateTypeCompound,
		PayoutFrequency: PayoutFrequencyMonthly, InterestRatePercent: rate,
		OutstandingPrincipal: principal, StartDate: start, LastAccrualDate: start,
	}
	// Settle month 1 alone.
	d1, a1 := projectAccrual(compound, addMonths(start, 1))
	compound.AccruedInterest += d1
	compound.LastAccrualDate = a1
	want1 := principal * monthlyRate
	approxEqual(t, d1, want1, "compound month 1 == flat monthly interest (nothing capitalized yet)")

	// Settle month 2: should now compute on (principal + unpaid interest).
	d2, _ := projectAccrual(compound, addMonths(start, 2))
	want2 := (principal + d1) * monthlyRate
	approxEqual(t, d2, want2, "compound month 2 capitalizes month 1's unpaid interest")
	if d2 <= d1 {
		t.Fatalf("compound month 2 (%.4f) should exceed month 1 (%.4f)", d2, d1)
	}
}

// TestProjectAccrual_WithdrawnInterestStopsCompounding checks that
// withdrawing interest (raising InterestWithdrawn) removes it from the
// Compound base for future periods — the expected behavior for capitalizing
// only "unpaid" interest.
func TestProjectAccrual_WithdrawnInterestStopsCompounding(t *testing.T) {
	const rate = 12.0
	const principal = 100000.0
	start := day(0)
	monthlyRate := rate / 100 / 12

	inv := &Investment{
		Status: StatusActive, Engine: EngineLive, InterestRateType: InterestRateTypeCompound,
		PayoutFrequency: PayoutFrequencyMonthly, InterestRatePercent: rate,
		OutstandingPrincipal: principal, StartDate: start, LastAccrualDate: start,
	}
	d1, a1 := projectAccrual(inv, addMonths(start, 1))
	inv.AccruedInterest += d1
	inv.LastAccrualDate = a1
	// Fully withdraw month 1's interest.
	inv.InterestWithdrawn = inv.AccruedInterest

	d2, _ := projectAccrual(inv, addMonths(start, 2))
	want2 := principal * monthlyRate // unpaid == 0, so back to the flat formula
	approxEqual(t, d2, want2, "after withdrawing all interest, next period is flat again")
}
