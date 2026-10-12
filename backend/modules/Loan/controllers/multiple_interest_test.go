package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
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

func monthStart(m int) time.Time { return time.Date(2026, time.Month(m), 1, 0, 0, 0, 0, time.UTC) }

// interestFor is the expected interest worked out independently: principal x
// annual rate / 365 x the actual days between two dates.
func interestFor(principal, rate float64, from, to time.Time) float64 {
	return principal * rate / 100 / 365 * float64(dayDiff(from, to))
}

func TestMultipleInterest_UsesActualDaysNotThirtyDayMonths(t *testing.T) {
	l := multipleLoan(monthStart(1), 0)
	// January has 31 days, February 28: each month's interest follows its own length
	nearly(t, accrue(l, monthStart(2)), interestFor(100_000, 12, monthStart(1), monthStart(2)), "31-day January")
	nearly(t, accrue(l, monthStart(3)), interestFor(100_000, 12, monthStart(2), monthStart(3)), "28-day February")
	nearly(t, accrue(l, monthStart(3)), 0, "nothing more accrues inside the month")
	nearly(t, l.AccruedInterest, interestFor(100_000, 12, monthStart(1), monthStart(3)), "59 days in total")
}

func TestMultipleInterest_UnpaidLoanIsRepricedAtEachStep(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 0)
	for m := 2; m <= 4; m++ {
		accrue(l, monthStart(m))
	}
	// exactly 90 days unpaid is still step 1
	nearly(t, l.AccruedInterest, interestFor(100_000, 12, opened, monthStart(4)), "90 days at 12%")
	if l.RateTierLevel != 0 {
		t.Fatalf("level %d, want 0", l.RateTierLevel)
	}

	// day 120: all 90 accrued days become 18%, then the next 30 days are charged at 18%
	accrue(l, monthStart(5))
	nearly(t, l.AccruedInterest, interestFor(100_000, 18, opened, monthStart(5)), "120 days, all at 18%")
	if l.RateTierLevel != 1 {
		t.Fatalf("level %d, want 1", l.RateTierLevel)
	}

	// day 151: all 120 accrued days become 24%, then the next 31 days at 24%
	accrue(l, monthStart(6))
	nearly(t, l.AccruedInterest, interestFor(100_000, 24, opened, monthStart(6)), "151 days, all at 24%")
	if l.RateTierLevel != 2 {
		t.Fatalf("level %d, want 2", l.RateTierLevel)
	}
}

func TestMultipleInterest_TwoStepsCrossedInOneCall(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 0)
	accrue(l, monthStart(2))
	accrue(l, monthStart(3))
	accrue(l, monthStart(4))
	// one catch-up call covers May and June
	accrue(l, monthStart(6))
	nearly(t, l.AccruedInterest, interestFor(100_000, 24, opened, monthStart(6)), "everything re-priced to 24%")
	if l.RateTierLevel != 2 {
		t.Fatalf("level %d, want 2", l.RateTierLevel)
	}
}

func TestMultipleInterest_PaymentResetsToFirstRate(t *testing.T) {
	l := multipleLoan(monthStart(1), 0)
	for m := 2; m <= 6; m++ {
		accrue(l, monthStart(m))
	}
	if l.RateTierLevel != 2 {
		t.Fatalf("setup: loan should be on step 3, got %d", l.RateTierLevel)
	}
	paidOn := monthStart(6)
	l.InterestPaid = l.AccruedInterest
	resetRateCycle(l, paidOn)
	if l.RateTierLevel != 0 || l.ArrearsSince == nil || !l.ArrearsSince.Equal(paidOn) {
		t.Fatalf("payment must return the loan to step 1 and restart the count, got level %d since %v", l.RateTierLevel, l.ArrearsSince)
	}
	nearly(t, accrue(l, monthStart(7)), interestFor(100_000, 12, monthStart(6), monthStart(7)), "the month after paying is back at 12%")
}

func TestMultipleInterest_FirstMonthChargedUpFrontAtFirstRate(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 0)
	nearly(t, accrue(l, opened.AddDate(0, 0, 1)), interestFor(100_000, 12, opened, monthStart(2)), "31 days at 12%")
	if !l.LastAccrualDate.Equal(monthStart(2)) {
		t.Fatalf("first accrual should anchor one month on, got %s", l.LastAccrualDate)
	}
}

func TestMultipleInterest_MinimumPeriodExtendsFirstCharge(t *testing.T) {
	opened := monthStart(1)
	l := multipleLoan(opened, 45)
	nearly(t, accrue(l, opened.AddDate(0, 0, 1)), interestFor(100_000, 12, opened, opened.AddDate(0, 0, 45)), "45 minimum days at 12%")
	if want := opened.AddDate(0, 0, 45); !l.LastAccrualDate.Equal(want) {
		t.Fatalf("anchor should be opened + 45 days, got %s", l.LastAccrualDate)
	}
	short := multipleLoan(opened, 10)
	nearly(t, accrue(short, opened.AddDate(0, 0, 1)), interestFor(100_000, 12, opened, monthStart(2)), "a minimum shorter than the month changes nothing")
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

// Paid every month, a Multiple-interest loan never leaves its first rate and
// owes the 12% of each month's actual days.
func TestNormalVsMultiple_PaidEveryMonthStaysOnFirstRate(t *testing.T) {
	multiple := multipleLoan(monthStart(1), 0)
	var want float64
	for m := 2; m <= 7; m++ {
		asOf := monthStart(m)
		accrue(multiple, asOf)
		want += interestFor(100_000, 12, monthStart(m-1), asOf)
		multiple.InterestPaid = multiple.AccruedInterest
		resetRateCycle(multiple, asOf)
		if multiple.RateTierLevel != 0 {
			t.Fatalf("month %d: a paid-up loan must stay on step 1, got %d", m, multiple.RateTierLevel)
		}
	}
	nearly(t, multiple.AccruedInterest, want, "six months paid on time")
}

// Left unpaid, the normal scheme keeps charging 12% while the Multiple scheme
// re-prices what has built up.
func TestNormalVsMultiple_UnpaidDiverges(t *testing.T) {
	normal, multiple := normalLoan(monthStart(1)), multipleLoan(monthStart(1), 0)
	for m := 2; m <= 6; m++ {
		accrue(normal, monthStart(m))
		accrue(multiple, monthStart(m))
	}
	nearly(t, normal.AccruedInterest, 5000, "normal scheme: 5 months at 1%")
	nearly(t, multiple.AccruedInterest, interestFor(100_000, 24, monthStart(1), monthStart(6)), "multiple scheme: 151 days re-priced to 24%")
	if multiple.AccruedInterest <= normal.AccruedInterest {
		t.Fatal("an unpaid Multiple-interest loan must owe more than the same loan on a normal scheme")
	}
}

// A loan unpaid for four months on a 30 / 60 / thereafter ladder, caught up in
// one go from its first month's charge.
func TestMultipleInterest_ShortLadderCatchUpAfterFourMonths(t *testing.T) {
	opened := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	l := multipleLoan(opened, 15)
	l.OutstandingAmount, l.PrincipalAmount = 157_453, 157_453
	l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 18}, {Days: 0, Rate: 24}}
	first := accrue(l, opened.AddDate(0, 0, 1))
	nearly(t, first, interestFor(157_453, 12, opened, time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)), "first month at 12%")
	accrue(l, time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC))
	nearly(t, l.AccruedInterest, interestFor(157_453, 24, opened, time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC)), "122 days all at 24%")
	if l.RateTierLevel != 2 {
		t.Fatalf("level %d, want 2", l.RateTierLevel)
	}
}

// The ledger shows one interest entry per month, even when a loan is caught up
// over several months in one go, and the entries add up to the interest charged.
func TestMultipleInterest_CatchUpIsSavedAsOneRowPerMonth(t *testing.T) {
	opened := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	l := multipleLoan(opened, 0)
	l.OutstandingAmount, l.PrincipalAmount = 157_453, 157_453
	l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 18}, {Days: 0, Rate: 24}}
	l.LastAccrualDate = time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	interest, penal, anchor, _, parts := projectAccrualDetail(l, time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC), nil)
	rows := accrualRows(l.ID, interest, penal, anchor, parts)
	if len(rows) != 3 {
		t.Fatalf("want one row for each of Aug, Sep and Oct, got %d", len(rows))
	}
	wantDates := []time.Time{
		time.Date(2026, 8, 12, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC),
	}
	var sum float64
	for i, r := range rows {
		if !r.AccruedOn.Equal(wantDates[i]) {
			t.Fatalf("row %d dated %s, want %s", i, r.AccruedOn, wantDates[i])
		}
		sum += r.Interest
	}
	nearly(t, sum, interest, "the monthly rows add up to the interest charged")
	// August carries the re-price of the first month (12% -> 18%) plus its own 31 days at 18%
	nearly(t, rows[0].Interest, interestFor(157_453, 6, opened, l.LastAccrualDate)+interestFor(157_453, 18, l.LastAccrualDate, wantDates[0]), "August row")
}
