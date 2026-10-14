package controllers

import (
	"context"
	"fmt"
	"math"
	"testing"
	"time"

	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
)

var matrixOpened = time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)

func applyAccrual(l *models.Loan, interest, penal float64, anchor time.Time, level int) {
	l.AccruedInterest += interest
	l.AccruedPenalInterest += penal
	l.LastAccrualDate = anchor
	l.RateTierLevel = level
}

// viewAt is a page view: it saves the periods that have been completed, nothing more.
func viewAt(l *models.Loan, day int) {
	i, p, a, lv, _ := projectAccrualThrough(l, plusDays(matrixOpened, day), false, nil)
	applyAccrual(l, i, p, a, lv)
}

// payAt is what a payment does: it charges up to the payment date, in the same two passes accrueThroughInTx makes.
func payAt(l *models.Loan, day int) float64 {
	for k := 0; k < 2; k++ {
		i, p, a, lv, _ := projectAccrualThrough(l, plusDays(matrixOpened, day), true, nil)
		applyAccrual(l, i, p, a, lv)
	}
	return l.AccruedInterest
}

func matrixLoan(method string, minimum int, principal float64) *models.Loan {
	l := &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    principal,
		PrincipalAmount:      principal,
		OpenedDate:           matrixOpened,
		LastAccrualDate:      matrixOpened,
		DueDate:              matrixOpened.AddDate(0, 3, 0),
		SchemeInterestRate:   12,
		SchemeInterestMethod: method,
		SchemeMinimumDays:    minimum,
	}
	if method == commonModels.InterestMethodMultiple {
		l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Days: 60, Rate: 24}, {Days: 0, Rate: 36}}
	}
	return l
}

var matrixMethods = []string{
	"Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly", commonModels.InterestMethodMultiple,
}

var (
	matrixMinimums = []int{0, 30, 45, 60, 90}
	matrixPayDays  = []int{0, 1, 10, 20, 29, 30, 31, 32, 45, 59, 60, 61, 75, 89, 90, 91, 92, 100, 120, 150, 200}
	matrixViewSets = [][]int{nil, {3}, {31}, {3, 29, 31, 59, 61, 91}, {45}, {62, 93}}
)

// What is owed on a payment day never depends on which days the loan page was
// opened before it.
func TestMatrix_OwedDoesNotDependOnPageViews(t *testing.T) {
	for _, method := range matrixMethods {
		for _, minimum := range matrixMinimums {
			for _, day := range matrixPayDays {
				base := payAt(matrixLoan(method, minimum, 1000), day)
				for _, views := range matrixViewSets {
					l := matrixLoan(method, minimum, 1000)
					for _, v := range views {
						if v < day {
							viewAt(l, v)
						}
					}
					if got := payAt(l, day); math.Abs(got-base) > 0.005 {
						t.Errorf("%s min %d pay day %d, viewed on %v: owes %.4f, but %.4f with no views", method, minimum, day, views, got, base)
					}
				}
			}
		}
	}
}

// Paying again on the same day charges nothing more.
func TestMatrix_SecondPaymentOnTheSameDayChargesNothing(t *testing.T) {
	for _, method := range matrixMethods {
		for _, minimum := range matrixMinimums {
			for _, day := range matrixPayDays {
				l := matrixLoan(method, minimum, 1000)
				first := payAt(l, day)
				if second := payAt(l, day); math.Abs(second-first) > 0.005 {
					t.Errorf("%s min %d day %d: a second charge on the same day added %.4f", method, minimum, day, second-first)
				}
			}
		}
	}
}

// Inside the minimum period the full minimum is owed; interest never falls as days pass.
func TestMatrix_MinimumIsOwedAndInterestNeverFalls(t *testing.T) {
	for _, method := range matrixMethods {
		for _, minimum := range matrixMinimums {
			atMinimum := payAt(matrixLoan(method, minimum, 1000), minimum)
			prev := 0.0
			for _, day := range matrixPayDays {
				got := payAt(matrixLoan(method, minimum, 1000), day)
				if got+0.005 < prev {
					t.Errorf("%s min %d: interest fell from %.4f to %.4f on day %d", method, minimum, prev, got, day)
				}
				prev = got
				if day <= minimum && math.Abs(got-atMinimum) > 0.005 {
					t.Errorf("%s min %d day %d: owes %.4f inside the minimum, the minimum itself is %.4f", method, minimum, day, got, atMinimum)
				}
				if day > minimum && got+0.005 < atMinimum {
					t.Errorf("%s min %d day %d: owes %.4f, less than the minimum %.4f", method, minimum, day, got, atMinimum)
				}
			}
		}
	}
}

// Nothing is saved until a period is over, however often the loan is viewed.
func TestMatrix_ViewingNeverChargesAhead(t *testing.T) {
	for _, method := range matrixMethods {
		for _, minimum := range []int{30, 60, 90} {
			l := matrixLoan(method, minimum, 1000)
			for day := 1; day < minimum && day < 30; day++ {
				viewAt(l, day)
				if l.AccruedInterest != 0 || !l.LastAccrualDate.Equal(matrixOpened) {
					t.Fatalf("%s min %d: day %d view saved %.4f / moved the charge date to %s", method, minimum, day, l.AccruedInterest, l.LastAccrualDate)
				}
			}
		}
	}
}

// The worked example: ₹1,000, 12% a year, opened 13 Jul, on a monthly simple scheme.
func TestMatrix_NormalLoanWorkedExample(t *testing.T) {
	cases := []struct {
		minimum, day int
		want         float64
	}{
		{0, 20, 6.67}, {0, 45, 14.67}, {0, 75, 24.33},
		{30, 20, 10.00}, {30, 45, 14.67}, {30, 75, 24.33},
		{60, 20, 20.00}, {60, 45, 20.00}, {60, 75, 25.00},
	}
	for _, c := range cases {
		got := payAt(matrixLoan("Monthly simple interest", c.minimum, 1000), c.day)
		if math.Abs(got-c.want) > 0.005 {
			t.Errorf("minimum %d, paid on day %d: owes %.4f, want %.2f", c.minimum, c.day, got, c.want)
		}
	}
}

// The amount the loan page shows is the amount a payment saves.
func TestMatrix_PageShowsWhatAPaymentWouldCharge(t *testing.T) {
	today := time.Now().UTC().Truncate(24 * time.Hour)
	for _, method := range matrixMethods {
		for _, minimum := range []int{30, 60} {
			for _, age := range []int{5, 20, 45, 75, 110} {
				opened := today.AddDate(0, 0, -age).Add(9*time.Hour + 30*time.Minute)
				mk := func() *models.Loan {
					l := matrixLoan(method, minimum, 1000)
					l.OpenedDate, l.LastAccrualDate = opened, opened
					l.DueDate = opened.AddDate(0, 3, 0)
					return l
				}
				shown, _ := interestToDate(context.Background(), mk())
				paying := mk()
				for k := 0; k < 2; k++ {
					i, p, a, lv, _ := projectAccrualThrough(paying, sameClockAsOpened(paying, time.Now()), true, nil)
					applyAccrual(paying, i, p, a, lv)
				}
				if math.Abs(shown-paying.AccruedInterest) > 0.01 {
					t.Errorf("%s min %d age %d: page shows %.4f, a payment would save %.4f", method, minimum, age, shown, paying.AccruedInterest)
				}
			}
		}
	}
}

func TestMatrix_PrintTable(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	for _, method := range matrixMethods {
		line := fmt.Sprintf("%-26s", method)
		for _, minimum := range []int{30, 60, 90} {
			line += fmt.Sprintf(" | min %d:", minimum)
			for _, day := range []int{20, 45, 75, 100} {
				line += fmt.Sprintf(" %8.2f", payAt(matrixLoan(method, minimum, 1000), day))
			}
		}
		t.Log(line)
	}
}

// A loan opened today owes its minimum period today: the 15 day minimum of the scheme added on the loan page.
func TestMatrix_LoanOpenedTodayOwesItsMinimum(t *testing.T) {
	opened := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	mk := func(method string, minimum int) *models.Loan {
		l := matrixLoan(method, minimum, 10_000)
		l.OpenedDate, l.LastAccrualDate, l.DueDate = opened, opened, opened.AddDate(1, 0, 0)
		l.SchemeRateTiers = nil
		if method == commonModels.InterestMethodMultiple {
			l.SchemeRateTiers = []commonModels.RateTier{{Days: 30, Rate: 12}, {Rate: 60}}
		}
		return l
	}
	l := mk(commonModels.InterestMethodMultiple, 15)
	i, _, _, _, _ := projectAccrualThrough(l, opened, true, nil)
	nearly(t, i, interestFor(10_000, 12, opened, opened.AddDate(0, 0, 15)), "multiple: 15 minimum days at 12%")
	n := mk("Monthly simple interest", 15)
	ni, _, _, _, _ := projectAccrualThrough(n, opened, true, nil)
	nearly(t, ni, 10_000*0.12/12*15/30, "normal: 15 of 30 days of a month at 1%")
	// the page without a payment (not "through") still saves nothing on the opening day
	if saved, _, _, _, _ := projectAccrualThrough(mk(commonModels.InterestMethodMultiple, 15), opened, false, nil); saved != 0 {
		t.Fatalf("a page view on the opening day must not save interest, got %.4f", saved)
	}
}
