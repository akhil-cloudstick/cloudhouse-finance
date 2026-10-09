package loan

import (
	"context"
	"math"
	"testing"
	"time"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/scheme"
)

func nearly(t *testing.T, got, want float64, label string) {
	t.Helper()
	if math.Abs(got-want) > 0.01 {
		t.Fatalf("%s: got %.4f, want %.4f", label, got, want)
	}
}

// A past-term loan that has cleared its interest reads as Active, not
// Overdue — and reverts the moment arrears build up again. The revert half
// matters most: without it, one catch-up payment would park the loan on
// Active permanently and it would never re-enter collections.
func TestRefreshServicingStatus_FlipsBothWays(t *testing.T) {
	now := time.Now()
	l := &Loan{
		Status:            StatusOverdue,
		OutstandingAmount: 5488.33,
		DueDate:           now.AddDate(0, 0, -120),
		AccruedInterest:   500,
		InterestPaid:      0,
	}

	// In arrears past its due date — stays Overdue.
	refreshServicingStatus(l, now)
	if l.Status != StatusOverdue {
		t.Fatalf("a loan in arrears past due must stay Overdue, got %q", l.Status)
	}

	// Interest paid off — back to Active despite still being 120 days past term.
	l.InterestPaid = 500
	refreshServicingStatus(l, now)
	if l.Status != StatusActive {
		t.Fatalf("interest cleared must read as Active, got %q", l.Status)
	}

	// Next month's interest accrues — straight back to Overdue.
	l.AccruedInterest = 554.88
	refreshServicingStatus(l, now)
	if l.Status != StatusOverdue {
		t.Fatalf("fresh arrears must revert to Overdue, got %q", l.Status)
	}

	// Penal interest alone is enough to count as arrears.
	l.AccruedInterest, l.InterestPaid = 554.88, 554.88
	l.AccruedPenalInterest, l.PenalInterestPaid = 10, 0
	refreshServicingStatus(l, now)
	if l.Status != StatusOverdue {
		t.Fatalf("outstanding penal interest is still arrears, got %q", l.Status)
	}

	// Statuses owned by other workflows are never rewritten from here.
	for _, s := range []string{StatusAuctionEligible, StatusClosed, StatusPendingApproval, StatusAuctionedBalanceDue} {
		l.Status = s
		l.AccruedPenalInterest, l.PenalInterestPaid = 0, 0
		if refreshServicingStatus(l, now) || l.Status != s {
			t.Fatalf("%q is owned by its own workflow and must not be rewritten, got %q", s, l.Status)
		}
	}
}

// Rounding at every write is what keeps a serviced loan landing on EXACTLY
// zero rather than a residue — the guard in enrichStatusFlags is the safety
// net, this is the actual fix. Simulates two years of accrue-then-settle
// cycles the way accrueAndSave and RecordPayment now write them.
func TestMoneyRounding_ServicedLoanLandsExactlyOnZero(t *testing.T) {
	var accrued, paid float64
	monthly := 5488.33 * 0.12 / 12 // 54.8833 — deliberately not a round figure

	for month := 0; month < 24; month++ {
		accrued = platform.RoundMoney(accrued + monthly)
		paid = platform.RoundMoney(paid + (accrued - paid)) // customer settles in full
		if accrued-paid != 0 {
			t.Fatalf("month %d: serviced balance must be exactly 0, got %g", month+1, accrued-paid)
		}
	}

}

// A loan whose interest has been paid off in full must not read as Defaulted,
// however long it has been overdue — Defaulted is what unlocks "Mark Auction
// Eligible", so float noise here put a fully-serviced customer's gold up for
// auction. Accrued and paid totals are float64 sums, so a cleared balance
// lands a whisker above zero rather than exactly on it.
func TestEnrich_ClearedInterestDoesNotFlagDefault(t *testing.T) {
	l := &Loan{
		Status:            StatusOverdue,
		OutstandingAmount: 5488.33,
		DueDate:           time.Now().AddDate(0, 0, -101),
		AccruedInterest:   0.1 + 0.2, // 0.30000000000000004
		InterestPaid:      0.3,
	}
	(&Service{}).enrich(context.Background(), l)

	if l.OutstandingInterest != 0 {
		t.Fatalf("a cleared interest balance must read as exactly 0, got %g", l.OutstandingInterest)
	}
	if l.IsDefaulted {
		t.Fatal("interest paid in full must not be Defaulted — this is what puts gold up for auction")
	}
	// Still genuinely overdue, though: principal remains and the due date has
	// passed. Clearing the arrears must not erase that.
	if !l.IsOverdue {
		t.Fatal("a loan past its due date is still Overdue")
	}

	// Real arrears must still be caught.
	l.AccruedInterest, l.InterestPaid = 500, 0
	(&Service{}).enrich(context.Background(), l)
	if !l.IsDefaulted {
		t.Fatal("genuine interest arrears past 90 days must still flag Defaulted")
	}
}

// Once a loan is past its first month (i.e. this isn't the very first
// accrual — see TestProjectAccrual_FirstMonthFloorChargedImmediately for
// that case), a part-way-through cycle owes nothing — interest posts only
// when a whole month completes, so the figure shown to the customer does
// not creep up on every page view. The anchor stays at the last boundary.
func TestProjectAccrual_NoDailyProrationPastFirstMonth(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	from := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusActive,
		OutstandingAmount: 100_000,
		LastAccrualDate:   from,
		DueDate:           from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}

	for _, days := range []int{1, 12, 29} {
		i, p, anchor := projectAccrual(l, from.AddDate(0, 0, days), nil)
		if i != 0 || p != 0 {
			t.Fatalf("day %d: nothing accrues mid-month, got interest %.4f penal %.4f", days, i, p)
		}
		if !anchor.Equal(from) {
			t.Fatalf("day %d: anchor must stay at the last boundary, got %s", days, anchor)
		}
	}

	// The month completes on the 15th — the full month lands at once.
	i, _, anchor := projectAccrual(l, from.AddDate(0, 1, 0), nil)
	nearly(t, i, 1000, "one completed month at 12% p.a. on 100,000, no double-count at the boundary")
	if !anchor.Equal(from.AddDate(0, 1, 0)) {
		t.Fatalf("anchor should advance to the month boundary, got %s", anchor)
	}
}

// The minimum-one-month floor fires ONLY on a loan's first-ever accrual
// (LastAccrualDate == OpenedDate, exactly how CreateLoan seeds it — see
// service.go) — a loan settled 5 days after opening still owes a full
// month, billed immediately, with the anchor jumping a full logical month
// past OpenedDate so no real day in that month can ever be recounted.
func TestProjectAccrual_FirstMonthFloorChargedImmediately(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusActive,
		OutstandingAmount: 100_000,
		OpenedDate:        opened,
		LastAccrualDate:   opened, // exactly how CreateLoan seeds a fresh loan
		DueDate:           opened.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}

	// Settled 5 days in — still owes a full month, not 5 days' worth.
	i, p, anchor := projectAccrual(l, opened.AddDate(0, 0, 5), nil)
	nearly(t, i, 1000, "same-month settlement still owes a full month's interest")
	if p != 0 {
		t.Fatalf("no penal interest expected, got %.4f", p)
	}
	wantAnchor := addMonths(opened, 1)
	if !anchor.Equal(wantAnchor) {
		t.Fatalf("anchor should jump a full logical month past OpenedDate, got %s want %s", anchor, wantAnchor)
	}

	// Persist the anchor exactly as accrueAndSave does, then read again
	// later that SAME calendar month (still before the anchor) — must not
	// re-charge anything, since those days were already consumed by the
	// floor's own anchor jump.
	l.LastAccrualDate = anchor
	i2, _, anchor2 := projectAccrual(l, opened.AddDate(0, 0, 20), nil)
	if i2 != 0 {
		t.Fatalf("no interest should accrue again inside the already-billed first month, got %.4f", i2)
	}
	if !anchor2.Equal(anchor) {
		t.Fatalf("anchor must not move when asOf hasn't reached it yet, got %s", anchor2)
	}
}

// A top-up landing before a loan's first-ever accrual splits the flat
// first-month floor day-by-day across each balance actually held, instead
// of charging the whole month on the post-top-up total.
func TestProjectAccrual_TopUpDuringFirstMonthSplitsDaily(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	topUpDate := opened.AddDate(0, 0, 10)
	l := &Loan{
		Status: StatusActive,
		// Already reflects the top-up, exactly as TopUpLoan leaves it —
		// projectAccrual must reconstruct the pre-top-up 100,000 from this
		// plus the LoanTopUp record below, not read it directly.
		OutstandingAmount:    150_000,
		OpenedDate:           opened,
		LastAccrualDate:      opened,
		DueDate:              opened.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
	}
	topUps := []LoanTopUp{{Amount: 50_000, OccurredOn: topUpDate}}

	i, p, anchor := projectAccrual(l, opened.AddDate(0, 0, 25), topUps)
	// monthlyRate = 1%/month => daily = 0.01/30. 10 days at 100,000, then 20
	// days at 150,000 (the month is Jan 1 -> Feb 1, 31 real days, but the
	// split itself is measured in days between OpenedDate/top-up/monthEnd,
	// not a flat 30 — here that's exactly 10 + 21 since Jan has 31 days).
	monthEnd := addMonths(opened, 1)
	preDays := topUpDate.Sub(opened).Hours() / 24
	postDays := monthEnd.Sub(topUpDate).Hours() / 24
	want := 100_000*(0.01/30)*preDays + 150_000*(0.01/30)*postDays
	nearly(t, i, want, "first month split day-by-day around the top-up")
	if p != 0 {
		t.Fatalf("no penal interest expected, got %.4f", p)
	}
	if !anchor.Equal(monthEnd) {
		t.Fatalf("anchor should still jump to the month boundary, got %s want %s", anchor, monthEnd)
	}

	// Sanity: this must be LESS than charging the flat month on the full
	// post-top-up 150,000 (the bug being fixed) — the customer had the
	// smaller balance for most of the month.
	flatOnFinal := 150_000 * (sch.InterestRate / 100 / 12)
	if i >= flatOnFinal {
		t.Fatalf("split charge %.4f should be less than the flat post-top-up charge %.4f", i, flatOnFinal)
	}
}

// A top-up that lands AFTER the first month has already completed (i.e. on
// a loan whose LastAccrualDate has already moved past OpenedDate) must not
// trigger the split — that machinery only exists for the still-unaccrued
// first month.
func TestProjectAccrual_TopUpAfterFirstMonthUsesOrdinaryAccrual(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	anchor := addMonths(opened, 1)
	l := &Loan{
		Status:               StatusActive,
		OutstandingAmount:    150_000,
		OpenedDate:           opened,
		LastAccrualDate:      anchor, // first month already accrued and anchored
		DueDate:              opened.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
	}
	// A top-up recorded well into the SECOND month — irrelevant to the
	// first-month floor since LastAccrualDate is no longer at OpenedDate.
	topUps := []LoanTopUp{{Amount: 50_000, OccurredOn: anchor.AddDate(0, 0, 5)}}

	i, _, _ := projectAccrual(l, anchor.AddDate(0, 1, 0), topUps)
	nearly(t, i, 1500, "ordinary whole-month charge on the current 150,000 balance, unaffected by firstMonthTopUps")
}

// Flat monthly charges off the original PrincipalAmount, ignoring
// repayments, never off the (possibly much smaller) reducing
// OutstandingAmount.
func TestProjectAccrual_FlatMonthlyChargesOffPrincipalNotOutstanding(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Flat monthly"}
	from := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusActive,
		PrincipalAmount:   100_000,
		OutstandingAmount: 40_000, // most of it already repaid
		LastAccrualDate:   from,
		DueDate:           from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}

	i, _, _ := projectAccrual(l, from.AddDate(0, 1, 0), nil)
	nearly(t, i, 100_000*0.01, "Flat monthly's monthly charge uses PrincipalAmount")
}

// A loan read many times a day must accrue exactly as much as one read at the
// end of the month. Storing time.Now() as the anchor instead of the period
// boundary would discard the part-month on every fetch, so a frequently-viewed
// loan would never complete a month and would accrue nothing at all.
func TestProjectAccrual_RemainderSurvivesRepeatedReads(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	from := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusActive,
		OutstandingAmount: 100_000,
		LastAccrualDate:   from,
		DueDate:           from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}

	// Simulate a fetch every day for 90 days, persisting the anchor each time
	// exactly as accrueAndSave does.
	for day := 1; day <= 90; day++ {
		i, _, anchor := projectAccrual(l, from.AddDate(0, 0, day), nil)
		l.AccruedInterest += i
		l.LastAccrualDate = anchor
	}
	nearly(t, l.AccruedInterest, 3000, "three completed months of daily reads")
}

// "Compound monthly" must charge each month on principal PLUS interest still
// unpaid — that is what distinguishes it from "Monthly simple interest".
func TestProjectAccrual_CompoundChargesInterestOnUnpaidInterest(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Compound monthly"}
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusActive,
		OutstandingAmount: 100_000,
		LastAccrualDate:   from,
		DueDate:           from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}

	i, _, anchor := projectAccrual(l, from.AddDate(0, 3, 0), nil)
	// 1%/month compounding: 1000 + 1010 + 1020.10
	nearly(t, i, 3030.10, "three compounded months")
	l.AccruedInterest += i
	l.LastAccrualDate = anchor

	// Leaving it unpaid, month four charges on principal + the 3030.10 owed.
	unpaid := *l
	i, _, _ = projectAccrual(&unpaid, from.AddDate(0, 4, 0), nil)
	nearly(t, i, 1030.30, "month four compounds on unpaid interest")

	// Clearing that interest drops month four back to plain principal — the
	// customer stops paying interest on interest the moment they settle it.
	settled := *l
	settled.InterestPaid = settled.AccruedInterest
	i, _, _ = projectAccrual(&settled, from.AddDate(0, 4, 0), nil)
	nearly(t, i, 1000, "month four on principal alone once interest is paid")
}

// Months are real calendar months, so a month-end loan accrues on the last day
// of short months rather than skipping into the following month.
func TestProjectAccrual_MonthEndClampsInsteadOfOverflowing(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	from := time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusActive,
		OutstandingAmount: 100_000,
		LastAccrualDate:   from,
		DueDate:           from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}

	// 2026 is not a leap year, so the cycle completes on 28 Feb, not 3 Mar.
	// 27 Feb is still mid-cycle, so nothing accrues yet.
	iMidCycle, _, _ := projectAccrual(l, time.Date(2026, 2, 27, 0, 0, 0, 0, time.UTC), nil)
	nearly(t, iMidCycle, 0, "mid-cycle: not the full month yet")
	i, _, anchor := projectAccrual(l, time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC), nil)
	nearly(t, i, 1000, "cycle completes on 28 Feb")
	if anchor.Day() != 28 || anchor.Month() != time.February {
		t.Fatalf("anchor should clamp to 28 Feb, got %s", anchor)
	}
}

// Penal interest is counted in whole overdue months from DueDate, and months
// already charged are never charged again — even when the due date falls in
// the middle of an interest cycle.
func TestProjectAccrual_PenalCountsWholeOverdueMonthsOnce(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, PenalRate: 24, InterestMethod: "Monthly simple interest"}
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	due := time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusOverdue,
		OutstandingAmount: 100_000,
		LastAccrualDate:   opened,
		DueDate:           due,
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}

	// Read at 1 June: overdue months completed from 20 Mar are 20 Apr and
	// 20 May, so exactly two months of penal at 2%/month — on OutstandingAmount
	// (100,000) PLUS the interest this same call accrues but leaves unpaid
	// (5 months at 1%/month = 5,000), i.e. 2% * 105,000 = 2,100 per month.
	i, p, anchor := projectAccrual(l, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC), nil)
	nearly(t, p, 4200, "two overdue months of penal on outstanding principal plus unpaid interest")
	l.AccruedInterest += i
	l.AccruedPenalInterest += p
	l.LastAccrualDate = anchor

	// Reading again the next day must not re-charge those same months.
	_, p, _ = projectAccrual(l, time.Date(2026, 6, 2, 0, 0, 0, 0, time.UTC), nil)
	if p != 0 {
		t.Fatalf("already-charged overdue months must not repeat, got %.4f", p)
	}
}

// Opened on the day it was entered, disbursed 19 days later: interest, the
// opened date and the due date all start from disbursement, tenure intact.
func TestStartAccrualAtDisbursement_ShiftsSameDayLoan(t *testing.T) {
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.Local)
	l := &Loan{
		OpenedDate:        opened,
		DueDate:           time.Date(2027, 1, 1, 0, 0, 0, 0, time.Local),
		LastAccrualDate:   opened,
		CreatedAt:         time.Date(2026, 1, 1, 10, 30, 0, 0, time.Local),
		OverdueNotifiedAt: &opened,
	}
	startAccrualAtDisbursement(l, time.Date(2026, 1, 20, 15, 45, 0, 0, time.Local))

	wantOpened := time.Date(2026, 1, 20, 0, 0, 0, 0, time.Local)
	if !l.OpenedDate.Equal(wantOpened) || !l.LastAccrualDate.Equal(wantOpened) {
		t.Fatalf("accrual start: opened %v, lastAccrual %v, want %v", l.OpenedDate, l.LastAccrualDate, wantOpened)
	}
	if want := time.Date(2027, 1, 20, 0, 0, 0, 0, time.Local); !l.DueDate.Equal(want) {
		t.Fatalf("due date: got %v, want %v", l.DueDate, want)
	}
	if l.OverdueNotifiedAt != nil {
		t.Fatal("overdue reminder should be re-armed for the shifted due date")
	}
}

// A backdated loan keeps accruing from the date staff chose.
func TestStartAccrualAtDisbursement_KeepsBackdatedLoan(t *testing.T) {
	opened := time.Date(2025, 3, 1, 0, 0, 0, 0, time.Local)
	due := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	l := &Loan{OpenedDate: opened, DueDate: due, LastAccrualDate: opened, CreatedAt: time.Date(2026, 1, 1, 9, 0, 0, 0, time.Local)}
	startAccrualAtDisbursement(l, time.Date(2026, 1, 20, 12, 0, 0, 0, time.Local))

	if !l.OpenedDate.Equal(opened) || !l.DueDate.Equal(due) || !l.LastAccrualDate.Equal(opened) {
		t.Fatalf("backdated loan changed: opened %v, due %v, lastAccrual %v", l.OpenedDate, l.DueDate, l.LastAccrualDate)
	}
}

// Shape the DB actually holds: the form's "YYYY-MM-DD" parsed as UTC
// midnight. Created and opened on 3 Oct, approved 3 days later — a normal
// loan, not a backdated one, so it shifts to the approval day.
func TestStartAccrualAtDisbursement_UTCMidnightOpenedDate(t *testing.T) {
	opened := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		OpenedDate:      opened,
		DueDate:         time.Date(2027, 10, 3, 0, 0, 0, 0, time.UTC),
		LastAccrualDate: opened,
		CreatedAt:       time.Date(2026, 10, 3, 12, 47, 0, 0, time.Local),
	}
	startAccrualAtDisbursement(l, time.Date(2026, 10, 6, 11, 0, 0, 0, time.Local))

	if got := l.OpenedDate.In(time.Local).Format("2006-01-02"); got != "2026-10-06" {
		t.Fatalf("opened date: got %s, want 2026-10-06", got)
	}
	if got := l.DueDate.In(time.Local).Format("2006-01-02"); got != "2027-10-06" {
		t.Fatalf("due date: got %s, want 2027-10-06", got)
	}
}
