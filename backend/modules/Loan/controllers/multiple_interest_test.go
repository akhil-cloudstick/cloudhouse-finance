package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
	"fmt"
	"testing"
	"time"
)

func multipleLoan(opened time.Time, minimumDays int) *models.Loan {
	return &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    100_000,
		PrincipalAmount:      100_000,
		OpenedDate:           opened,
		LastAccrualDate:      opened,
		DueDate:              opened.AddDate(5, 0, 0),
		SchemeInterestRate:   12,
		SchemeInterestMethod: commonModels.InterestMethodMultiple,
		SchemeMinimumDays:    minimumDays,
		// 12% for 90 days unpaid, 18% for the next 60, 24% after that
		SchemeRateTiers: []commonModels.RateTier{{Days: 90, Rate: 12}, {Days: 60, Rate: 18}, {Days: 0, Rate: 24}},
	}
}

// accrue applies one projection to the loan the way accrueAndSave does.
func accrue(l *models.Loan, asOf time.Time) float64 {
	i, _, anchor, level := projectAccrualState(l, asOf, nil)
	l.AccruedInterest += i
	l.LastAccrualDate = anchor
	l.RateTierLevel = level
	return i
}

// catchUp accrues until the loan has been charged for every period up to asOf.
func catchUp(l *models.Loan, asOf time.Time) {
	for {
		before := l.LastAccrualDate
		accrue(l, asOf)
		if l.LastAccrualDate.Equal(before) {
			return
		}
	}
}

func monthStart(m int) time.Time { return time.Date(2026, time.Month(m), 1, 0, 0, 0, 0, time.UTC) }

// plusDays is the date n days after t.
func plusDays(t time.Time, n int) time.Time { return t.AddDate(0, 0, n) }

// interestFor is the expected interest worked out independently: principal x
// annual rate / 365 x the actual days between two dates.
func interestFor(principal, rate float64, from, to time.Time) float64 {
	return principal * rate / 100 / 365 * float64(dayDiff(from, to))
}

func TestMultipleInterest_ChargesEveryThirtyDays(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 0)
	nearly(t, accrue(l, plusDays(opened, 30)), interestFor(100_000, 12, opened, plusDays(opened, 30)), "first 30 days at 12%")
	if want := plusDays(opened, 30); !l.LastAccrualDate.Equal(want) {
		t.Fatalf("first charge should end on day 30, got %s", l.LastAccrualDate)
	}
	nearly(t, accrue(l, plusDays(opened, 59)), 0, "nothing more accrues until day 60")
	nearly(t, accrue(l, plusDays(opened, 60)), interestFor(100_000, 12, plusDays(opened, 30), plusDays(opened, 60)), "second 30 days")
	nearly(t, l.AccruedInterest, interestFor(100_000, 12, opened, plusDays(opened, 60)), "60 days in total")
}

func TestMultipleInterest_UnpaidLoanIsRepricedAtEachStep(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 0)
	for d := 30; d <= 90; d += 30 {
		accrue(l, plusDays(opened, d))
	}
	// exactly 90 days unpaid is still step 1
	nearly(t, l.AccruedInterest, interestFor(100_000, 12, opened, plusDays(opened, 90)), "90 days at 12%")
	if l.RateTierLevel != 0 {
		t.Fatalf("level %d, want 0", l.RateTierLevel)
	}

	// day 120: all 90 accrued days become 18%, then the next 30 days are charged at 18%
	accrue(l, plusDays(opened, 120))
	nearly(t, l.AccruedInterest, interestFor(100_000, 18, opened, plusDays(opened, 120)), "120 days, all at 18%")
	if l.RateTierLevel != 1 {
		t.Fatalf("level %d, want 1", l.RateTierLevel)
	}

	// exactly 150 days unpaid is still step 2
	accrue(l, plusDays(opened, 150))
	nearly(t, l.AccruedInterest, interestFor(100_000, 18, opened, plusDays(opened, 150)), "150 days, all at 18%")

	// day 180: all 150 accrued days become 24%, then the next 30 days at 24%
	accrue(l, plusDays(opened, 180))
	nearly(t, l.AccruedInterest, interestFor(100_000, 24, opened, plusDays(opened, 180)), "180 days, all at 24%")
	if l.RateTierLevel != 2 {
		t.Fatalf("level %d, want 2", l.RateTierLevel)
	}
}

func TestMultipleInterest_TwoStepsCrossedInOneCall(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 0)
	for d := 30; d <= 90; d += 30 {
		accrue(l, plusDays(opened, d))
	}
	// one catch-up call covers days 90 to 180
	accrue(l, plusDays(opened, 180))
	nearly(t, l.AccruedInterest, interestFor(100_000, 24, opened, plusDays(opened, 180)), "everything re-priced to 24%")
	if l.RateTierLevel != 2 {
		t.Fatalf("level %d, want 2", l.RateTierLevel)
	}
}

func TestMultipleInterest_PaymentResetsToFirstRate(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 0)
	for d := 30; d <= 180; d += 30 {
		accrue(l, plusDays(opened, d))
	}
	if l.RateTierLevel != 2 {
		t.Fatalf("setup: loan should be on step 3, got %d", l.RateTierLevel)
	}
	paidOn := plusDays(opened, 180)
	l.InterestPaid = l.AccruedInterest
	resetRateCycle(l, paidOn)
	if l.RateTierLevel != 0 || l.ArrearsSince == nil || !l.ArrearsSince.Equal(paidOn) {
		t.Fatalf("payment must return the loan to step 1 and restart the count, got level %d since %v", l.RateTierLevel, l.ArrearsSince)
	}
	nearly(t, accrue(l, plusDays(paidOn, 30)), interestFor(100_000, 12, paidOn, plusDays(paidOn, 30)), "the period after paying is back at 12%")
}

func TestMultipleInterest_MinimumPeriodExtendsFirstCharge(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 45)
	nearly(t, accrue(l, plusDays(opened, 45)), interestFor(100_000, 12, opened, plusDays(opened, 45)), "45 minimum days at 12%")
	if want := plusDays(opened, 45); !l.LastAccrualDate.Equal(want) {
		t.Fatalf("anchor should be opened + 45 days, got %s", l.LastAccrualDate)
	}
	short := multipleLoan(opened, 10)
	nearly(t, accrue(short, plusDays(opened, 30)), interestFor(100_000, 12, opened, plusDays(opened, 30)), "a minimum shorter than 30 days changes nothing")
}

// The same scheme with a 30, 60 or 90 day minimum ends up with the same
// interest on the same date: the minimum only sets how long the first charge
// is, and every later charge is another 30 days.
func TestMultipleInterest_DifferentMinimumsAgreeOnTheSameDate(t *testing.T) {
	opened := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	ladder := []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 24}, {Days: 0, Rate: 36}}
	build := func(minimum int) *models.Loan {
		l := multipleLoan(opened, minimum)
		l.OutstandingAmount, l.PrincipalAmount = 1000, 1000
		l.SchemeRateTiers = ladder
		return l
	}
	for _, minimum := range []int{30, 60, 90} {
		l := build(minimum)
		catchUp(l, time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC))
		nearly(t, l.AccruedInterest, interestFor(1000, 24, opened, plusDays(opened, 90)), "90 days at 24%")
		if l.RateTierLevel != 1 {
			t.Fatalf("minimum %d: level %d, want 1", minimum, l.RateTierLevel)
		}
	}
	for _, minimum := range []int{30, 60, 90} {
		l := build(minimum)
		catchUp(l, plusDays(opened, 120))
		nearly(t, l.AccruedInterest, interestFor(1000, 36, opened, plusDays(opened, 120)), "120 days, all at 36%")
	}
}

// A 30 day minimum with a 30 day first step is charged at the first rate; the
// calendar month having 31 days must not push it to the second step.
func TestMultipleInterest_ThirtyDayMinimumStaysOnFirstStep(t *testing.T) {
	opened := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	l := multipleLoan(opened, 30)
	l.OutstandingAmount, l.PrincipalAmount = 1000, 1000
	l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 24}, {Days: 0, Rate: 36}}
	nearly(t, accrue(l, plusDays(opened, 30)), interestFor(1000, 12, opened, plusDays(opened, 30)), "30 days at 12%")
	if l.RateTierLevel != 0 {
		t.Fatalf("level %d, want 0", l.RateTierLevel)
	}
}

func TestMultipleInterest_OtherMethodsIgnoreResetAndTiers(t *testing.T) {
	l := &models.Loan{SchemeInterestMethod: "Monthly simple interest"}
	resetRateCycle(l, time.Now())
	if l.ArrearsSince != nil {
		t.Fatal("a single-rate loan has no rate cycle to reset")
	}
}

func normalLoan(opened time.Time) *models.Loan {
	l := multipleLoan(opened, 0)
	l.SchemeInterestMethod = "Monthly simple interest"
	l.SchemeRateTiers = nil
	return l
}

// A normal scheme still charges a flat 1% a month; only the Multiple scheme
// follows the actual days.
func TestNormalVsMultiple_NormalSchemeKeepsMonthlyRate(t *testing.T) {
	normal := normalLoan(monthStart(1))
	nearly(t, accrue(normal, monthStart(2)), 1000, "normal scheme: 12% / 12 on 100,000")
	nearly(t, accrue(normal, monthStart(3)), 1000, "normal scheme: same for the 28-day month")
}

// Paid every period, a Multiple-interest loan never leaves its first rate and
// owes the 12% of each 30 days.
func TestNormalVsMultiple_PaidEveryPeriodStaysOnFirstRate(t *testing.T) {
	opened := monthStart(1)
	multiple := multipleLoan(opened, 0)
	var want float64
	for p := 1; p <= 6; p++ {
		asOf := plusDays(opened, 30*p)
		accrue(multiple, asOf)
		want += interestFor(100_000, 12, plusDays(opened, 30*(p-1)), asOf)
		multiple.InterestPaid = multiple.AccruedInterest
		resetRateCycle(multiple, asOf)
		if multiple.RateTierLevel != 0 {
			t.Fatalf("period %d: a paid-up loan must stay on step 1, got %d", p, multiple.RateTierLevel)
		}
	}
	nearly(t, multiple.AccruedInterest, want, "six periods paid on time")
}

// Left unpaid, the normal scheme keeps charging 12% while the Multiple scheme
// re-prices what has built up.
func TestNormalVsMultiple_UnpaidDiverges(t *testing.T) {
	opened := monthStart(1)
	normal, multiple := normalLoan(opened), multipleLoan(opened, 0)
	for m := 2; m <= 6; m++ {
		accrue(normal, monthStart(m))
	}
	catchUp(multiple, plusDays(opened, 150))
	nearly(t, normal.AccruedInterest, 5000, "normal scheme: 5 months at 1%")
	nearly(t, multiple.AccruedInterest, interestFor(100_000, 18, opened, plusDays(opened, 150)), "multiple scheme: 150 days re-priced to 18%")
	if multiple.AccruedInterest <= normal.AccruedInterest {
		t.Fatal("an unpaid Multiple-interest loan must owe more than the same loan on a normal scheme")
	}
}

// A loan unpaid for four months on a 30 / 60 / thereafter ladder, caught up in
// one go from its first charge.
func TestMultipleInterest_ShortLadderCatchUpAfterFourMonths(t *testing.T) {
	opened := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	l := multipleLoan(opened, 15)
	l.OutstandingAmount, l.PrincipalAmount = 157_453, 157_453
	l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 18}, {Days: 0, Rate: 24}}
	first := accrue(l, plusDays(opened, 30))
	nearly(t, first, interestFor(157_453, 12, opened, plusDays(opened, 30)), "first 30 days at 12%")
	accrue(l, time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC))
	nearly(t, l.AccruedInterest, interestFor(157_453, 24, opened, plusDays(opened, 120)), "120 days all at 24%")
	if l.RateTierLevel != 2 {
		t.Fatalf("level %d, want 2", l.RateTierLevel)
	}
}

// The ledger shows one interest entry per 30-day period, even when a loan is
// caught up over several periods in one go, and the entries add up to the
// interest charged.
func TestMultipleInterest_CatchUpIsSavedAsOneRowPerPeriod(t *testing.T) {
	opened := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	l := multipleLoan(opened, 0)
	l.OutstandingAmount, l.PrincipalAmount = 157_453, 157_453
	l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 18}, {Days: 0, Rate: 24}}
	l.LastAccrualDate = plusDays(opened, 30)
	interest, penal, anchor, _, parts := projectAccrualDetail(l, plusDays(opened, 125), nil)
	rows := accrualRows(l.ID, interest, penal, anchor, parts)
	if len(rows) != 3 {
		t.Fatalf("want one row for each of days 60, 90 and 120, got %d", len(rows))
	}
	wantDates := []time.Time{plusDays(opened, 60), plusDays(opened, 90), plusDays(opened, 120)}
	var sum float64
	for i, r := range rows {
		if !r.AccruedOn.Equal(wantDates[i]) {
			t.Fatalf("row %d dated %s, want %s", i, r.AccruedOn, wantDates[i])
		}
		sum += r.Interest
	}
	nearly(t, sum, interest, "the period rows add up to the interest charged")
	// the first row carries the re-price of the first 30 days (12% -> 18%) plus its own 30 days at 18%, and, at day 120,
	// its half of the re-price of the 90 days charged so far (18% -> 24%), shared with the day-90 row by days
	nearly(t, rows[0].Interest, interestFor(157_453, 6, opened, l.LastAccrualDate)+interestFor(157_453, 18, l.LastAccrualDate, wantDates[0])+interestFor(157_453, 6, opened, wantDates[1])/2, "first row")
	nearly(t, rows[1].Interest, interestFor(157_453, 18, wantDates[0], wantDates[1])+interestFor(157_453, 6, opened, wantDates[1])/2, "second row")
}

// When the loan steps up a rate, every month already charged is restated at the new rate, not only the month being
// charged: the saved rows are raised and the new row holds just its own days.
func TestMultipleInterest_RateStepRestatesEarlierRows(t *testing.T) {
	opened := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	l := multipleLoan(opened, 30)
	l.OutstandingAmount, l.PrincipalAmount = 10_000, 10_000
	l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 18}, {Days: 0, Rate: 24}}
	l.RateTierLevel = 1
	l.LastAccrualDate = plusDays(opened, 90)
	// the three rows saved so far, each already at the 18% step the loan reached at day 60
	each := interestFor(10_000, 18, opened, plusDays(opened, 30))
	l.AccruedInterest = 3 * each
	l.PriorAccruals = []models.LoanAccrual{
		{ID: 1, AccruedOn: plusDays(opened, 30), Interest: each},
		{ID: 2, AccruedOn: plusDays(opened, 60), Interest: each},
		{ID: 3, AccruedOn: plusDays(opened, 90), Interest: each},
	}
	interest, _, anchor, level, parts := projectAccrualThrough(l, plusDays(opened, 105), true, nil)
	if level != 2 {
		t.Fatalf("level %d, want 2", level)
	}
	var newPart float64
	var restated = map[uint]float64{}
	for _, p := range parts {
		if p.SavedID == 0 {
			newPart += p.Interest
		} else {
			restated[p.SavedID] = p.Interest
		}
	}
	// each saved 30-day row goes from 18% to 24%, and the 15 new days are charged at 24%
	for id := uint(1); id <= 3; id++ {
		nearly(t, l.PriorAccruals[id-1].Interest+restated[id], interestFor(10_000, 24, opened, plusDays(opened, 30)), fmt.Sprintf("row %d restated to 24%%", id))
	}
	nearly(t, newPart, interestFor(10_000, 24, plusDays(opened, 90), plusDays(opened, 105)), "the new row is its own 15 days at 24%")
	var restatedSum float64
	for _, v := range restated {
		restatedSum += v
	}
	nearly(t, newPart+restatedSum, interest, "restated shares and the new row add up to the interest charged")
	nearly(t, l.AccruedInterest+interest, interestFor(10_000, 24, opened, plusDays(opened, 105)), "the total is 105 days at 24%")
	if !anchor.Equal(plusDays(opened, 105)) {
		t.Fatalf("anchor %s, want day 105", anchor)
	}
}
