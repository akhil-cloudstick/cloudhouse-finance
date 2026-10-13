package controllers

import (
	"testing"
	"time"
)

// Simulates the hourly sweep for 70 days and counts how many reminders would be sent.
func TestInterestReminderSendsOncePerCycle(t *testing.T) {
	opened := time.Date(2026, 1, 31, 10, 0, 0, 0, time.UTC)
	var reminded *time.Time
	sent := 0
	for h := 0; h < 24*70; h++ {
		now := time.Date(2026, 2, 20, 0, 0, 0, 0, time.UTC).Add(time.Duration(h) * time.Hour)
		cycle := currentInterestCycle(opened, now)
		if !cycle.IsZero() && (reminded == nil || reminded.Before(cycle)) {
			n := now
			reminded = &n
			sent++
			t.Logf("sent at %s (cycle %s)", now.Format("2006-01-02 15:04"), cycle.Format("2006-01-02"))
		}
	}
	if sent != 3 {
		t.Fatalf("expected 3 sends in 70 days, got %d", sent)
	}
}
