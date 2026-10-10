package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"math"
	"testing"
	"time"
)

func nearly(t *testing.T, got, want float64, label string) {
	t.Helper()
	if math.Abs(got-want) > 0.01 {
		t.Fatalf("%s: got %.4f, want %.4f", label, got, want)
	}
}

func TestRefreshServicingStatus_FlipsBothWays(t *testing.T) {
	now := time.Now()
	l := &models.Loan{
		Status:            models.StatusOverdue,
		OutstandingAmount: 5488.33,
		DueDate:           now.AddDate(0, 0, -120),
		AccruedInterest:   500,
		InterestPaid:      0,
	}
	refreshServicingStatus(l, now)
	if l.Status != models.StatusOverdue {
		t.Fatalf("a loan in arrears past due must stay Overdue, got %q", l.Status)
	}
	l.InterestPaid = 500
	refreshServicingStatus(l, now)
	if l.Status != models.StatusActive {
		t.Fatalf("interest cleared must read as Active, got %q", l.Status)
	}
	l.AccruedInterest = 554.88
	refreshServicingStatus(l, now)
	if l.Status != models.StatusOverdue {
		t.Fatalf("fresh arrears must revert to Overdue, got %q", l.Status)
	}
	l.AccruedInterest, l.InterestPaid = 554.88, 554.88
	l.AccruedPenalInterest, l.PenalInterestPaid = 10, 0
	refreshServicingStatus(l, now)
	if l.Status != models.StatusOverdue {
		t.Fatalf("outstanding penal interest is still arrears, got %q", l.Status)
	}
	// Statuses owned by other workflows are never rewritten from here.
	for _, s := range []string{models.StatusAuctionEligible, models.StatusClosed, models.StatusPendingApproval, models.StatusAuctionedBalanceDue} {
		l.Status = s
		l.AccruedPenalInterest, l.PenalInterestPaid = 0, 0
		if refreshServicingStatus(l, now) || l.Status != s {
			t.Fatalf("%q is owned by its own workflow and must not be rewritten, got %q", s, l.Status)
		}
	}
}

func TestMoneyRounding_ServicedLoanLandsExactlyOnZero(t *testing.T) {
	var accrued, paid float64
	monthly := 5488.33 * 0.12 / 12 // 54.8833 — deliberately not a round figure
	for month := 0; month < 24; month++ {
		accrued = common.RoundMoney(accrued + monthly)
		paid = common.RoundMoney(paid + (accrued - paid))
		if accrued-paid != 0 {
			t.Fatalf("month %d: serviced balance must be exactly 0, got %g", month+1, accrued-paid)
		}
	}
}

func TestEnrich_ClearedInterestDoesNotFlagDefault(t *testing.T) {
	l := &models.Loan{
		Status:            models.StatusOverdue,
		OutstandingAmount: 5488.33,
		DueDate:           time.Now().AddDate(0, 0, -101),
		AccruedInterest:   0.1 + 0.2,
		InterestPaid:      0.3,
	}
	enrichLoan(context.Background(), l)
	if l.OutstandingInterest != 0 {
		t.Fatalf("a cleared interest balance must read as exactly 0, got %g", l.OutstandingInterest)
	}
	if l.IsDefaulted {
		t.Fatal("interest paid in full must not be Defaulted — this is what puts gold up for auction")
	}
	if !l.IsOverdue {
		t.Fatal("a loan past its due date is still Overdue")
	}
	// Real arrears must still be caught.
	l.AccruedInterest, l.InterestPaid = 500, 0
	enrichLoan(context.Background(), l)
	if !l.IsDefaulted {
		t.Fatal("genuine interest arrears past 90 days must still flag Defaulted")
	}
}

func TestProjectAccrual_NoDailyProrationPastFirstMonth(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	from := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	l := &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    100_000,
		LastAccrualDate:      from,
		DueDate:              from.AddDate(1, 0, 0),
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
	i, _, anchor := projectAccrual(l, from.AddDate(0, 1, 0), nil)
	nearly(t, i, 1000, "one completed month at 12% p.a. on 100,000, no double-count at the boundary")
	if !anchor.Equal(from.AddDate(0, 1, 0)) {
		t.Fatalf("anchor should advance to the month boundary, got %s", anchor)
	}
}

func TestProjectAccrual_FirstMonthFloorChargedImmediately(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    100_000,
		OpenedDate:           opened,
		LastAccrualDate:      opened,
		DueDate:              opened.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}
	i, p, anchor := projectAccrual(l, opened.AddDate(0, 0, 5), nil)
	nearly(t, i, 1000, "same-month settlement still owes a full month's interest")
	if p != 0 {
		t.Fatalf("no penal interest expected, got %.4f", p)
	}
	wantAnchor := addMonths(opened, 1)
	if !anchor.Equal(wantAnchor) {
		t.Fatalf("anchor should jump a full logical month past OpenedDate, got %s want %s", anchor, wantAnchor)
	}
	l.LastAccrualDate = anchor
	i2, _, anchor2 := projectAccrual(l, opened.AddDate(0, 0, 20), nil)
	if i2 != 0 {
		t.Fatalf("no interest should accrue again inside the already-billed first month, got %.4f", i2)
	}
	if !anchor2.Equal(anchor) {
		t.Fatalf("anchor must not move when asOf hasn't reached it yet, got %s", anchor2)
	}
}

func TestProjectAccrual_TopUpDuringFirstMonthSplitsDaily(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	topUpDate := opened.AddDate(0, 0, 10)
	l := &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    150_000,
		OpenedDate:           opened,
		LastAccrualDate:      opened,
		DueDate:              opened.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
	}
	topUps := []models.LoanTopUp{{Amount: 50_000, OccurredOn: topUpDate}}
	i, p, anchor := projectAccrual(l, opened.AddDate(0, 0, 25), topUps)
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
	flatOnFinal := 150_000 * (sch.InterestRate / 100 / 12)
	if i >= flatOnFinal {
		t.Fatalf("split charge %.4f should be less than the flat post-top-up charge %.4f", i, flatOnFinal)
	}
}

func TestProjectAccrual_TopUpAfterFirstMonthUsesOrdinaryAccrual(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	anchor := addMonths(opened, 1)
	l := &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    150_000,
		OpenedDate:           opened,
		LastAccrualDate:      anchor,
		DueDate:              opened.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
	}
	topUps := []models.LoanTopUp{{Amount: 50_000, OccurredOn: anchor.AddDate(0, 0, 5)}}
	i, _, _ := projectAccrual(l, anchor.AddDate(0, 1, 0), topUps)
	nearly(t, i, 1500, "ordinary whole-month charge on the current 150,000 balance, unaffected by firstMonthTopUps")
}

func TestProjectAccrual_FlatMonthlyChargesOffPrincipalNotOutstanding(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, InterestMethod: "Flat monthly"}
	from := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	l := &models.Loan{
		Status:               models.StatusActive,
		PrincipalAmount:      100_000,
		OutstandingAmount:    40_000,
		LastAccrualDate:      from,
		DueDate:              from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}
	i, _, _ := projectAccrual(l, from.AddDate(0, 1, 0), nil)
	nearly(t, i, 100_000*0.01, "Flat monthly's monthly charge uses PrincipalAmount")
}

func TestProjectAccrual_RemainderSurvivesRepeatedReads(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	from := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	l := &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    100_000,
		LastAccrualDate:      from,
		DueDate:              from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}
	for day := 1; day <= 90; day++ {
		i, _, anchor := projectAccrual(l, from.AddDate(0, 0, day), nil)
		l.AccruedInterest += i
		l.LastAccrualDate = anchor
	}
	nearly(t, l.AccruedInterest, 3000, "three completed months of daily reads")
}

func TestProjectAccrual_CompoundChargesInterestOnUnpaidInterest(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, InterestMethod: "Compound monthly"}
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    100_000,
		LastAccrualDate:      from,
		DueDate:              from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}
	i, _, anchor := projectAccrual(l, from.AddDate(0, 3, 0), nil)
	nearly(t, i, 3030.10, "three compounded months")
	l.AccruedInterest += i
	l.LastAccrualDate = anchor
	unpaid := *l
	i, _, _ = projectAccrual(&unpaid, from.AddDate(0, 4, 0), nil)
	nearly(t, i, 1030.30, "month four compounds on unpaid interest")
	settled := *l
	settled.InterestPaid = settled.AccruedInterest
	i, _, _ = projectAccrual(&settled, from.AddDate(0, 4, 0), nil)
	nearly(t, i, 1000, "month four on principal alone once interest is paid")
}

func TestProjectAccrual_MonthEndClampsInsteadOfOverflowing(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, InterestMethod: "Monthly simple interest"}
	from := time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC)
	l := &models.Loan{
		Status:               models.StatusActive,
		OutstandingAmount:    100_000,
		LastAccrualDate:      from,
		DueDate:              from.AddDate(1, 0, 0),
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}
	iMidCycle, _, _ := projectAccrual(l, time.Date(2026, 2, 27, 0, 0, 0, 0, time.UTC), nil)
	nearly(t, iMidCycle, 0, "mid-cycle: not the full month yet")
	i, _, anchor := projectAccrual(l, time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC), nil)
	nearly(t, i, 1000, "cycle completes on 28 Feb")
	if anchor.Day() != 28 || anchor.Month() != time.February {
		t.Fatalf("anchor should clamp to 28 Feb, got %s", anchor)
	}
}

func TestProjectAccrual_PenalCountsWholeOverdueMonthsOnce(t *testing.T) {
	sch := commonModels.Scheme{InterestRate: 12, PenalRate: 24, InterestMethod: "Monthly simple interest"}
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	due := time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC)
	l := &models.Loan{
		Status:               models.StatusOverdue,
		OutstandingAmount:    100_000,
		LastAccrualDate:      opened,
		DueDate:              due,
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}
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

func TestStartAccrualAtDisbursement_ShiftsSameDayLoan(t *testing.T) {
	opened := time.Date(2026, 1, 1, 0, 0, 0, 0, time.Local)
	l := &models.Loan{
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

func TestStartAccrualAtDisbursement_KeepsBackdatedLoan(t *testing.T) {
	opened := time.Date(2025, 3, 1, 0, 0, 0, 0, time.Local)
	due := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	l := &models.Loan{OpenedDate: opened, DueDate: due, LastAccrualDate: opened, CreatedAt: time.Date(2026, 1, 1, 9, 0, 0, 0, time.Local)}
	startAccrualAtDisbursement(l, time.Date(2026, 1, 20, 12, 0, 0, 0, time.Local))
	if !l.OpenedDate.Equal(opened) || !l.DueDate.Equal(due) || !l.LastAccrualDate.Equal(opened) {
		t.Fatalf("backdated loan changed: opened %v, due %v, lastAccrual %v", l.OpenedDate, l.DueDate, l.LastAccrualDate)
	}
}

func TestStartAccrualAtDisbursement_UTCMidnightOpenedDate(t *testing.T) {
	opened := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	l := &models.Loan{
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
