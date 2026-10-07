package loan

import (
	"testing"
	"time"
)

func TestMatchesServicing(t *testing.T) {
	cases := []struct {
		name string
		l    Loan
		want map[string]bool // due_soon, overdue, defaulted
	}{
		{"due soon", Loan{Status: StatusDueSoon, IsDueSoon: true}, map[string]bool{ServicingDueSoon: true}},
		{"overdue in arrears", Loan{Status: StatusOverdue, IsOverdue: true}, map[string]bool{ServicingOverdue: true}},
		{"overdue but interest paid (Active)", Loan{Status: StatusActive, IsOverdue: true}, map[string]bool{}},
		{"defaulted is not also overdue", Loan{Status: StatusOverdue, IsOverdue: true, IsDefaulted: true}, map[string]bool{ServicingDefaulted: true}},
		{"auction eligible is neither", Loan{Status: StatusAuctionEligible, IsOverdue: true, IsDefaulted: true}, map[string]bool{}},
		{"balance due is neither", Loan{Status: StatusAuctionedBalanceDue, IsOverdue: true, IsDefaulted: true}, map[string]bool{}},
	}
	for _, c := range cases {
		for _, sv := range []string{ServicingDueSoon, ServicingOverdue, ServicingDefaulted} {
			if got := matchesServicing(&c.l, sv); got != c.want[sv] {
				t.Errorf("%s / %s: got %v, want %v", c.name, sv, got, c.want[sv])
			}
		}
	}
}

// The SQL side must be a superset of the exact check: a loan the exact test
// accepts can never be excluded by the candidate window.
func TestServicingCandidatesWindow(t *testing.T) {
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	_, before, from := servicingCandidates(ServicingDueSoon, now)
	if from == nil || before == nil || !from.Equal(now) || !before.Equal(now.AddDate(0, 0, dueSoonWindowDays+1)) {
		t.Fatalf("due_soon window wrong: from=%v before=%v", from, before)
	}
	notIn, before, _ := servicingCandidates(ServicingDefaulted, now)
	if before == nil || !before.Equal(now.AddDate(0, 0, -defaultedAfterDays)) {
		t.Fatalf("defaulted cutoff wrong: %v", before)
	}
	for _, s := range []string{StatusAuctionEligible, StatusAuctionedBalanceDue, StatusClosed} {
		found := false
		for _, n := range notIn {
			if n == s {
				found = true
			}
		}
		if !found {
			t.Errorf("defaulted candidates should exclude %q", s)
		}
	}
	if validServicing("bogus") || !validServicing(ServicingOverdue) {
		t.Error("validServicing wrong")
	}
}
