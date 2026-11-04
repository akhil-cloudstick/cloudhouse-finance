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
