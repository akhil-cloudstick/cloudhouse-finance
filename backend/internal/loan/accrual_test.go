package loan

import (
	"math"
	"testing"
	"time"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/scheme"
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
	(&Service{}).enrich(l)

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
	(&Service{}).enrich(l)
	if !l.IsDefaulted {
		t.Fatal("genuine interest arrears past 90 days must still flag Defaulted")
	}
}

// Once a loan is past its first month (i.e. this isn't the very first
// accrual — see TestProjectAccrual_FirstMonthFloorChargedImmediately for
// that case), a part-way-through cycle now owes a running daily charge —
// `OutstandingAmount × (monthlyRate/30) × days` — rather than nothing, and
// the anchor advances to asOf every call so those days are never
// recounted. The whole-month lump still lands in full the moment the
// month actually completes, with the leftover exactly zero right at that
// boundary (no double-count).
func TestProjectAccrual_DailyProrationPastFirstMonth(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	from := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusActive,
		OutstandingAmount: 100_000,
		LastAccrualDate:   from,
		DueDate:           from.AddDate(1, 0, 0),
		Scheme:            sch,
	}

	// 100,000 × (0.01/30) × days = 33.333/day.
	for _, days := range []int{1, 12, 29} {
		i, p, anchor := projectAccrual(l, &sch, from.AddDate(0, 0, days))
		nearly(t, i, 100_000*0.01/30*float64(days), "daily-prorated interest")
		if p != 0 {
			t.Fatalf("day %d: no penal interest owed with no overdue months, got %.4f", days, p)
		}
		if !anchor.Equal(from.AddDate(0, 0, days)) {
			t.Fatalf("day %d: anchor should advance to asOf so these days aren't recounted, got %s", days, anchor)
		}
	}

	// The month completes on the 15th — the full month lands at once, with
	// zero leftover exactly at the boundary (not the whole month PLUS a
	// day's worth of proration).
	i, _, anchor := projectAccrual(l, &sch, from.AddDate(0, 1, 0))
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
		Scheme:            sch,
	}

	// Settled 5 days in — still owes a full month, not 5 days' worth.
	i, p, anchor := projectAccrual(l, &sch, opened.AddDate(0, 0, 5))
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
	i2, _, anchor2 := projectAccrual(l, &sch, opened.AddDate(0, 0, 20))
	if i2 != 0 {
		t.Fatalf("no interest should accrue again inside the already-billed first month, got %.4f", i2)
	}
	if !anchor2.Equal(anchor) {
		t.Fatalf("anchor must not move when asOf hasn't reached it yet, got %s", anchor2)
	}
}

// The daily-proration base must match whichever base that method's own
// whole-month charge already uses — Flat monthly charges (and prorates)
// off the original PrincipalAmount, ignoring repayments, never off the
// (possibly much smaller) reducing OutstandingAmount.
func TestProjectAccrual_FlatMonthlyProratesOffPrincipalNotOutstanding(t *testing.T) {
	sch := scheme.Scheme{InterestRate: 12, InterestMethod: "Flat monthly"}
	from := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	l := &Loan{
		Status:            StatusActive,
		PrincipalAmount:   100_000,
		OutstandingAmount: 40_000, // most of it already repaid
		LastAccrualDate:   from,
		DueDate:           from.AddDate(1, 0, 0),
		Scheme:            sch,
	}

	i, _, _ := projectAccrual(l, &sch, from.AddDate(0, 0, 10))
	nearly(t, i, 100_000*0.01/30*10, "Flat monthly's daily proration uses PrincipalAmount")
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
		Scheme:            sch,
	}

	// Simulate a fetch every day for 90 days, persisting the anchor each time
	// exactly as accrueAndSave does.
	for day := 1; day <= 90; day++ {
		i, _, anchor := projectAccrual(l, &sch, from.AddDate(0, 0, day))
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
		Scheme:            sch,
	}

	i, _, anchor := projectAccrual(l, &sch, from.AddDate(0, 3, 0))
	// 1%/month compounding: 1000 + 1010 + 1020.10
	nearly(t, i, 3030.10, "three compounded months")
	l.AccruedInterest += i
	l.LastAccrualDate = anchor

	// Leaving it unpaid, month four charges on principal + the 3030.10 owed.
	unpaid := *l
	i, _, _ = projectAccrual(&unpaid, &sch, from.AddDate(0, 4, 0))
	nearly(t, i, 1030.30, "month four compounds on unpaid interest")

	// Clearing that interest drops month four back to plain principal — the
	// customer stops paying interest on interest the moment they settle it.
	settled := *l
	settled.InterestPaid = settled.AccruedInterest
	i, _, _ = projectAccrual(&settled, &sch, from.AddDate(0, 4, 0))
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
		Scheme:            sch,
	}

	// 2026 is not a leap year, so the cycle completes on 28 Feb, not 3 Mar.
	// 27 Feb is still mid-cycle (27 days of daily proration since 31 Jan),
	// not the full month yet.
	iMidCycle, _, _ := projectAccrual(l, &sch, time.Date(2026, 2, 27, 0, 0, 0, 0, time.UTC))
	nearly(t, iMidCycle, 100_000*0.01/30*27, "27 days' daily proration, not the full month yet")
	i, _, anchor := projectAccrual(l, &sch, time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC))
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
		Scheme:            sch,
	}

	// Read at 1 June: overdue months completed from 20 Mar are 20 Apr and
	// 20 May, so exactly two months of penal at 2%/month.
	_, p, anchor := projectAccrual(l, &sch, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	nearly(t, p, 4000, "two overdue months of penal")
	l.AccruedPenalInterest += p
	l.LastAccrualDate = anchor

	// Reading again the next day must not re-charge those same months.
	_, p, _ = projectAccrual(l, &sch, time.Date(2026, 6, 2, 0, 0, 0, 0, time.UTC))
	if p != 0 {
		t.Fatalf("already-charged overdue months must not repeat, got %.4f", p)
	}
}
