package controllers

import (
	"context"
	"math"
	"math/rand"
	"testing"
	"time"
)

// synthetic ledger rows of kinds that need no database (loan_accrual = debit
// when out, loan_payment = credit), spread over 1995-2026 with several rows a day
func syntheticLedgerRows(n int, seed int64) []ledgerSourceRow {
	r := rand.New(rand.NewSource(seed))
	start := time.Date(1995, 1, 1, 0, 0, 0, 0, time.UTC)
	rows := make([]ledgerSourceRow, n)
	for i := range rows {
		kind := "loan_payment"
		out := false
		if r.Intn(3) == 0 {
			kind, out = "loan_accrual", true
		}
		rows[i] = ledgerSourceRow{
			Kind:   kind,
			ID:     uint(i + 1),
			Date:   start.AddDate(0, 0, r.Intn(32*365)),
			Amount: math.Round(r.Float64()*100000) / 100,
			IsOut:  out,
			Memo:   r.Intn(40) == 0,
		}
	}
	return rows
}

// fetchFrom answers like the real scans: from inclusive, to inclusive (whole day), zero = unbounded.
func fetchFrom(all []ledgerSourceRow) func(from, to time.Time) ([]ledgerSourceRow, error) {
	return func(from, to time.Time) ([]ledgerSourceRow, error) {
		var out []ledgerSourceRow
		for _, r := range all {
			if !from.IsZero() && r.Date.Before(from) {
				continue
			}
			if !to.IsZero() && !r.Date.Before(to.AddDate(0, 0, 1)) {
				continue
			}
			out = append(out, r)
		}
		return out, nil
	}
}

// reference: the original all-in-memory path (every row in range, opening from every earlier row)
func referenceLedger(ctx context.Context, all []ledgerSourceRow, from, to time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals) {
	fetch := fetchFrom(all)
	rows, _ := fetch(from, to)
	opening := 0.0
	if !from.IsZero() {
		prior, _ := fetch(time.Time{}, from.AddDate(0, 0, -1))
		for _, r := range prior {
			opening += signedLedgerAmount(r)
		}
	}
	out, total, totals, err := paginateLedgerRowsFrom(ctx, rows, opening, limit, offset)
	if err != nil {
		panic(err)
	}
	return out, total, totals
}

func TestPaginateLedgerWindowedMatchesAllInMemory(t *testing.T) {
	all := syntheticLedgerRows(6000, 7)
	ctx := context.Background()
	d := func(s string) time.Time {
		if s == "" {
			return time.Time{}
		}
		v, _ := time.Parse("2006-01-02", s)
		return v
	}
	cases := []struct {
		from, to      string
		limit, offset int
	}{
		{"", "", 12, 0}, {"", "", 12, 12}, {"", "", 12, 3000}, {"", "", 12, 5995}, {"", "", 12, 99999},
		{"2010-03-15", "", 12, 0}, {"2010-03-15", "", 50, 700}, {"2010-03-15", "2018-06-30", 25, 100},
		{"", "2001-12-31", 10, 40}, {"2026-01-01", "", 12, 0}, {"1995-01-01", "1995-12-31", 7, 3},
	}
	for _, c := range cases {
		from, to := d(c.from), d(c.to)
		want, wantTotal, wantTotals := referenceLedger(ctx, all, from, to, c.limit, c.offset)
		got, gotTotal, gotTotals, err := paginateLedgerWindowed(ctx, fetchFrom(all), nil, from, to, c.limit, c.offset)
		if err != nil {
			t.Fatalf("%+v: %v", c, err)
		}
		if gotTotal != wantTotal || math.Abs(gotTotals.TotalDebit-wantTotals.TotalDebit) > 0.001 || math.Abs(gotTotals.TotalCredit-wantTotals.TotalCredit) > 0.001 {
			t.Fatalf("%+v: totals got %d %+v want %d %+v", c, gotTotal, gotTotals, wantTotal, wantTotals)
		}
		if len(got) != len(want) {
			t.Fatalf("%+v: page size got %d want %d", c, len(got), len(want))
		}
		for i := range got {
			if got[i].ID != want[i].ID || math.Abs(got[i].RunningBalance-want[i].RunningBalance) > 0.001 {
				t.Fatalf("%+v row %d: got id %d bal %.2f, want id %d bal %.2f", c, i, got[i].ID, got[i].RunningBalance, want[i].ID, want[i].RunningBalance)
			}
		}
	}
}

func TestPaginateLedgerWindowedFocusAndExportCap(t *testing.T) {
	all := syntheticLedgerRows(3000, 11)
	target := all[1234]
	ctx := context.WithValue(context.Background(), ledgerFocusKey{}, ledgerFocus{date: target.Date.Format("2006-01-02"), amount: target.Amount})
	_, _, want := referenceLedger(ctx, all, time.Time{}, time.Time{}, 12, 0)
	_, _, got, err := paginateLedgerWindowed(ctx, fetchFrom(all), nil, time.Time{}, time.Time{}, 12, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.FocusPage != want.FocusPage || got.FocusPage == 0 {
		t.Fatalf("focus page got %d want %d", got.FocusPage, want.FocusPage)
	}
	big := syntheticLedgerRows(ledgerExportMaxRows+10, 3)
	if _, _, _, err := paginateLedgerWindowed(context.Background(), fetchFrom(big), nil, time.Time{}, time.Time{}, 0, 0); err == nil {
		t.Fatal("an export over the row cap must be refused")
	}
}

func TestPaginateLedgerWindowedCacheMatches(t *testing.T) {
	// windows before the current year are cached; a cached second call must equal
	// the uncached result, and a changed fingerprint must drop the cache.
	all := syntheticLedgerRows(5000, 21)
	ctx := context.Background()
	fp := "v1"
	fingerprint := func(context.Context, time.Time) (string, error) { return fp, nil }
	from, _ := time.Parse("2006-01-02", "2012-07-01")
	for _, c := range []struct {
		from          time.Time
		limit, offset int
	}{{time.Time{}, 12, 0}, {time.Time{}, 12, 2400}, {from, 20, 60}} {
		want, wantTotal, wantTotals, _ := paginateLedgerWindowed(ctx, fetchFrom(all), nil, c.from, time.Time{}, c.limit, c.offset)
		for round := 0; round < 2; round++ {
			got, gotTotal, gotTotals, err := paginateLedgerWindowedCached(ctx, "test", fingerprint, fetchFrom(all), nil, c.from, time.Time{}, c.limit, c.offset)
			if err != nil {
				t.Fatal(err)
			}
			if gotTotal != wantTotal || math.Abs(gotTotals.TotalDebit-wantTotals.TotalDebit) > 0.001 || len(got) != len(want) {
				t.Fatalf("round %d %+v: got %d/%+v want %d/%+v", round, c, gotTotal, gotTotals, wantTotal, wantTotals)
			}
			for i := range got {
				if got[i].ID != want[i].ID || math.Abs(got[i].RunningBalance-want[i].RunningBalance) > 0.001 {
					t.Fatalf("round %d row %d mismatch", round, i)
				}
			}
		}
	}
	// a backdated change: the old cache would be wrong; the new fingerprint must refresh it
	changed := append([]ledgerSourceRow{}, all...)
	changed[10].Amount += 1000
	changed[10].Date = time.Date(2001, 5, 5, 0, 0, 0, 0, time.UTC)
	fp = "v2"
	want, _, wantTotals, _ := paginateLedgerWindowed(ctx, fetchFrom(changed), nil, time.Time{}, time.Time{}, 12, 0)
	got, _, gotTotals, err := paginateLedgerWindowedCached(ctx, "test", fingerprint, fetchFrom(changed), nil, time.Time{}, time.Time{}, 12, 0)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(gotTotals.TotalCredit-wantTotals.TotalCredit) > 0.001 || math.Abs(gotTotals.TotalDebit-wantTotals.TotalDebit) > 0.001 || got[0].RunningBalance != want[0].RunningBalance {
		t.Fatalf("stale cache after fingerprint change: got %+v want %+v", gotTotals, wantTotals)
	}
}

func TestFocusMatchesByUniqueRef(t *testing.T) {
	d := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	rows := []ledgerSourceRow{
		{Kind: "cash_movement", ID: 5, Date: d, Amount: 1000},
		{Kind: "expense", ID: 5, Date: d, Amount: 1000},
		{Kind: "cash_movement", ID: 6, Date: d, Amount: 1000},
		{Kind: "gold_sale", ID: 5, Date: d, Amount: 1000},
	}
	for ref, want := range map[string]int{"m:5": 0, "e:5": 1, "m:6": 2, "g:5": 3} {
		ex, fb := focusMatches(rows, ledgerFocus{date: "2026-10-02", amount: 1000, ref: ref})
		if ex != want || fb != want {
			t.Fatalf("ref %s: got %d/%d want %d", ref, ex, fb, want)
		}
	}
	if ex, fb := focusMatches(rows, ledgerFocus{amount: 1000, ref: "m:99"}); ex != -1 || fb != -1 {
		t.Fatalf("unknown ref must match nothing, got %d/%d", ex, fb)
	}
	if got := toLedgerRow(rows[1]).Ref; got != "e:5" {
		t.Fatalf("row ref %q", got)
	}
}
