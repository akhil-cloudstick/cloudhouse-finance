package controllers

import (
	"testing"
	"time"
)

func d(y int, m time.Month, day int) time.Time { return time.Date(y, m, day, 0, 0, 0, 0, time.UTC) }

func TestMonthlyOccurrences_ThirtiethKeepsFebruaryAndDoesNotDrift(t *testing.T) {
	got := monthlyOccurrences(d(2026, time.January, 30), d(2026, time.January, 1), d(2026, time.April, 30))
	want := []time.Time{d(2026, time.January, 30), d(2026, time.February, 28), d(2026, time.March, 30), d(2026, time.April, 30)}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if !got[i].Equal(want[i]) {
			t.Errorf("occurrence %d: got %v, want %v", i, got[i], want[i])
		}
	}
}

func TestMonthlyOccurrences_LeapYearFebruary(t *testing.T) {
	got := monthlyOccurrences(d(2027, time.December, 31), d(2028, time.February, 1), d(2028, time.March, 31))
	if len(got) != 2 || !got[0].Equal(d(2028, time.February, 29)) || !got[1].Equal(d(2028, time.March, 31)) {
		t.Fatalf("got %v, want 29 Feb and 31 Mar 2028", got)
	}
}

func TestMonthlyOccurrences_WindowAndOpenedDateBounds(t *testing.T) {
	// Nothing before the loan was opened.
	if got := monthlyOccurrences(d(2026, time.March, 10), d(2026, time.January, 1), d(2026, time.March, 9)); len(got) != 0 {
		t.Errorf("window before opening: got %v", got)
	}
	// Only the occurrences inside the requested window.
	got := monthlyOccurrences(d(2026, time.January, 10), d(2026, time.May, 1), d(2026, time.June, 30))
	if len(got) != 2 || !got[0].Equal(d(2026, time.May, 10)) || !got[1].Equal(d(2026, time.June, 10)) {
		t.Errorf("got %v, want 10 May and 10 Jun", got)
	}
}

func TestMonthlyOccurrences_StopsAtTheCallersCap(t *testing.T) {
	// The caller caps `to` at the loan's due date, so nothing after it is produced.
	due := d(2026, time.April, 10)
	got := monthlyOccurrences(d(2026, time.January, 10), d(2026, time.January, 1), due)
	if len(got) != 4 || !got[len(got)-1].Equal(due) {
		t.Fatalf("got %v, want 10 Jan..10 Apr", got)
	}
}

func TestUnsettledInterestOccurrences(t *testing.T) {
	d := func(y int, m time.Month, day int) time.Time { return time.Date(y, m, day, 0, 0, 0, 0, time.UTC) }
	opened, due := d(2026, 1, 10), d(2026, 7, 10)
	from, to := d(2026, 1, 1), d(2026, 7, 10)
	count := func(paid ...time.Time) int { return len(unsettledInterestOccurrences(opened, from, to, due, paid)) }
	base := count() // the opening-day entry plus six monthly ones
	if base != 7 {
		t.Fatalf("no payments: got %d, want 7", base)
	}
	if got := count(d(2026, 2, 10)); got != base-1 {
		t.Errorf("one payment on the Feb due date: got %d, want %d", got, base-1)
	}
	if got := count(d(2026, 2, 5)); got != base-1 {
		t.Errorf("paying ahead of the Feb due date: got %d, want %d", got, base-1)
	}
	if got := count(d(2026, 2, 20)); got != base-1 {
		t.Errorf("paying late clears the oldest open one: got %d, want %d", got, base-1)
	}
	if got := count(d(2026, 2, 10), d(2026, 3, 10)); got != base-2 {
		t.Errorf("two payments: got %d, want %d", got, base-2)
	}
	// the cleared one is the earliest, so Feb is gone but March remains
	rest := unsettledInterestOccurrences(opened, from, to, due, []time.Time{d(2026, 2, 10)})
	for _, o := range rest {
		if o.Equal(d(2026, 2, 10)) {
			t.Error("Feb 10 reminder should be cleared")
		}
	}
}

func TestInterestTakenOnOpeningDayClearsTheFirstReminder(t *testing.T) {
	opened, due := d(2026, 10, 13), d(2027, 4, 13)
	got := unsettledInterestOccurrences(opened, d(2026, 10, 1), d(2026, 12, 31), due, []time.Time{d(2026, 10, 13)})
	for _, o := range got {
		if o.Equal(d(2026, 11, 13)) {
			t.Error("the November reminder should be cleared by interest paid on the opening day")
		}
	}
}
