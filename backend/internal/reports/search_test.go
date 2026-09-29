package reports

import (
	"testing"
	"time"
)

func TestMatchRows(t *testing.T) {
	paid := time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC)
	rows := []InterestPayoutRegisterRow{
		{InvestmentID: 1, InvestmentNumber: "INV-001", CustomerName: "Anita Rao", Amount: 1500, Status: "Paid", PaidAt: &paid},
		{InvestmentID: 2, InvestmentNumber: "INV-002", CustomerName: "Bala K", Amount: 2750.5, Status: "Pending"},
	}

	cases := map[string][]uint{
		"":           {1, 2},
		"anita":      {1}, // string, case-insensitive
		"inv-002":    {2}, // string
		"2750.5":     {2}, // float via fmt
		"2026-03-04": {1}, // *time.Time followed, date-formatted
		"pending":    {2}, // status
		"nomatch":    {},  // nothing
		"  bala  ":   {2}, // trimmed
	}
	for q, want := range cases {
		got := MatchRows(rows, q)
		if len(got) != len(want) {
			t.Errorf("q=%q: got %d rows, want %d", q, len(got), len(want))
			continue
		}
		for i := range want {
			if got[i].InvestmentID != want[i] {
				t.Errorf("q=%q: row %d id=%d, want %d", q, i, got[i].InvestmentID, want[i])
			}
		}
	}

	// Idempotent — respond applies it again after the services already did.
	once := MatchRows(rows, "anita")
	if twice := MatchRows(once, "anita"); len(twice) != len(once) {
		t.Errorf("not idempotent: %d vs %d", len(twice), len(once))
	}
}
