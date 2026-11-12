package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"testing"
	"time"
)

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func TestDaysPastDue_DueDateItselfIsNotPastDue(t *testing.T) {
	due := day(2026, time.October, 7)
	// Any time during the due date itself is still day 0.
	for _, h := range []int{0, 9, 23} {
		asOf := time.Date(2026, time.October, 7, h, 30, 0, 0, time.UTC)
		if got := daysPastDue(due, asOf); got != 0 {
			t.Errorf("hour %d on the due date: got %d days past due, want 0", h, got)
		}
	}
	if got := daysPastDue(due, time.Date(2026, time.October, 8, 0, 5, 0, 0, time.UTC)); got != 1 {
		t.Errorf("day after the due date: got %d, want 1", got)
	}
}

func TestEnrichStatusFlags_DueDateIsDueSoonNotOverdue(t *testing.T) {
	l := &models.Loan{Status: models.StatusActive, DueDate: day(2026, time.October, 7), TotalOutstandingBalance: 1000}
	enrichStatusFlags(l, time.Date(2026, time.October, 7, 15, 0, 0, 0, time.UTC))
	if l.IsOverdue || l.DaysOverdue != 0 {
		t.Fatalf("a loan due today must not be overdue (overdue=%v days=%d)", l.IsOverdue, l.DaysOverdue)
	}
	if !l.IsDueSoon {
		t.Fatal("a loan due today must be due soon")
	}

	l = &models.Loan{Status: models.StatusActive, DueDate: day(2026, time.October, 7), TotalOutstandingBalance: 1000}
	enrichStatusFlags(l, time.Date(2026, time.October, 8, 9, 0, 0, 0, time.UTC))
	if !l.IsOverdue || l.DaysOverdue != 1 {
		t.Fatalf("the day after the due date must be 1d overdue (overdue=%v days=%d)", l.IsOverdue, l.DaysOverdue)
	}
}

func TestEnrichStatusFlags_NothingOwedIsNeverOverdue(t *testing.T) {
	l := &models.Loan{Status: models.StatusOverdue, DueDate: day(2026, time.October, 7)}
	enrichStatusFlags(l, time.Date(2026, time.November, 12, 9, 0, 0, 0, time.UTC))
	if l.IsOverdue || l.IsDueSoon || l.IsDefaulted || l.Status != models.StatusClosureRequested {
		t.Fatalf("a loan with nothing outstanding must read Closure Requested, not overdue (status=%q overdue=%v)", l.Status, l.IsOverdue)
	}
}

func TestEnrichStatusFlags_PendingApprovalIsNeverDueOrOverdue(t *testing.T) {
	asOf := time.Date(2026, time.October, 7, 12, 0, 0, 0, time.UTC)
	for name, due := range map[string]time.Time{
		"due tomorrow": day(2026, time.October, 8),
		"already past": day(2026, time.August, 1),
	} {
		l := &models.Loan{Status: models.StatusPendingApproval, DueDate: due}
		enrichStatusFlags(l, asOf)
		if l.IsDueSoon || l.IsOverdue || l.IsDefaulted {
			t.Errorf("%s: pending-approval loan was flagged (due soon=%v overdue=%v defaulted=%v)",
				name, l.IsDueSoon, l.IsOverdue, l.IsDefaulted)
		}
	}
}

func TestNormalStatusFor_DueDateStaysActiveRange(t *testing.T) {
	l := &models.Loan{DueDate: day(2026, time.October, 7)}
	if got := normalStatusFor(l, time.Date(2026, time.October, 7, 18, 0, 0, 0, time.UTC)); got != models.StatusDueSoon {
		t.Errorf("on the due date: got %q, want %q", got, models.StatusDueSoon)
	}
	if got := normalStatusFor(l, time.Date(2026, time.October, 8, 1, 0, 0, 0, time.UTC)); got != models.StatusOverdue {
		t.Errorf("day after: got %q, want %q", got, models.StatusOverdue)
	}
}

func TestServicingCandidates_BoundariesAreStartOfToday(t *testing.T) {
	now := time.Date(2026, time.October, 7, 15, 30, 0, 0, time.UTC)
	today := startOfDay(now)

	notIn, before, from := servicingCandidates("overdue", now)
	if before == nil || !before.Equal(today) {
		t.Errorf("overdue must be due_date < start of today, got %v", before)
	}
	hasPending := false
	for _, s := range notIn {
		if s == models.StatusPendingApproval {
			hasPending = true
		}
	}
	if !hasPending {
		t.Error("overdue candidates must exclude Pending Approval")
	}
	_ = from

	_, _, dueFrom := servicingCandidates("due_soon", now)
	if dueFrom == nil || !dueFrom.Equal(today) {
		t.Errorf("due_soon must include loans due today (due_date >= start of today), got %v", dueFrom)
	}
}

func TestMatchesServicing_BankPledgedDefaultedStaysUnderDefaulted(t *testing.T) {
	pledged := &models.Loan{Status: models.StatusOverdue, IsOverdue: true, IsDefaulted: true, BankPledgeStatus: models.BankPledgeStatusPledged}
	// There is no separate "awaiting gold release" list: the loan is simply Defaulted,
	// and the auction steps themselves refuse it until the bank releases the gold.
	if !matchesServicing(pledged, "defaulted") {
		t.Error("a bank-pledged defaulted loan must still appear under Defaulted")
	}
	if validServicing("defaulted_pledged") {
		t.Error("defaulted_pledged is not a servicing class")
	}
}

func TestLoanClosedOn_PrefersRecordedClosingTime(t *testing.T) {
	closed := time.Date(2026, time.October, 7, 11, 0, 0, 0, time.UTC)
	l := &models.Loan{ClosedAt: &closed}
	// With a recorded closing time no database lookup is needed, and printing
	// the agreement a day later must not move its date.
	if got := loanClosedOn(nil, l); !got.Equal(closed) {
		t.Fatalf("got %v, want the recorded closing time %v", got, closed)
	}
}
