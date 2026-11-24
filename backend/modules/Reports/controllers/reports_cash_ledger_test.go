package controllers

import (
	"testing"
	"time"
)

func day(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func TestCashLedger_ParticularsAreLoanNumberAndYearOpened(t *testing.T) {
	years := map[int]int{144: 2026, 7: 2025}
	cases := map[string]string{
		"Loan disbursement — LN-00144":          "00144/26",
		"Gold Loan · Partial — LN-00007":        "00007/25",
		"Loan disbursement — LN-00999":          "00999", // loan not found: number only
		"Collection · Personal Loan — PL-00013": "",      // not a gold loan
		"Savings": "",
	}
	for purpose, want := range cases {
		if got := ledgerParticulars(ledgerLoanNumber(purpose), years); got != want {
			t.Errorf("%q: particulars %q, want %q", purpose, got, want)
		}
	}
}

func TestCashLedger_LoanQueryForms(t *testing.T) {
	for q, want := range map[string]int{"00144/26": 144, "LN-00144": 144, "ln-144": 144, "144": 144, " 00144 ": 144, "": 0, "abc": 0} {
		if got := ledgerLoanQuery(q); got != want {
			t.Errorf("%q: loan %d, want %d", q, got, want)
		}
	}
}

func TestCashLedger_RunningBalanceAndMonthSubtotals(t *testing.T) {
	moves := []ledgerMovement{
		{day("2026-09-29"), "out", 25_000, "Loan disbursement — LN-00144"},
		{day("2026-09-30"), "in", 1_000, "Savings"},
		{day("2026-10-02"), "in", 5_000, "Gold Loan · Partial — LN-00144"},
		{day("2026-10-03"), "out", 300, "Expense — Tea"},
	}
	rows, totals := buildCashLedger(100_000, moves, map[int]int{144: 2026}, 0)

	want := []struct {
		particulars            string
		debit, credit, balance float64
		total                  bool
	}{
		{"00144/26", 25_000, 0, 75_000, false},
		{"", 0, 1_000, 76_000, false},
		{"Total — September 2026", 25_000, 1_000, 76_000, true},
		{"00144/26", 0, 5_000, 81_000, false},
		{"", 300, 0, 80_700, false},
		{"Total — October 2026", 300, 5_000, 80_700, true},
	}
	if len(rows) != len(want) {
		t.Fatalf("got %d rows, want %d: %+v", len(rows), len(want), rows)
	}
	for i, w := range want {
		r := rows[i]
		if r.Particulars != w.particulars || r.Debit != w.debit || r.Credit != w.credit || r.Balance != w.balance || r.Total != w.total {
			t.Errorf("row %d: got %+v, want %+v", i, r, w)
		}
	}
	if totals.OpeningBalance != 100_000 || totals.TotalDebit != 25_300 || totals.TotalCredit != 6_000 || totals.ClosingBalance != 80_700 {
		t.Errorf("totals %+v", totals)
	}
}

// Movements carry paise; the balance and subtotals keep them, as the Ledger page does.
func TestCashLedger_KeepsPaise(t *testing.T) {
	moves := []ledgerMovement{
		{day("2026-10-01"), "out", 5_987.17, "Loan disbursement — LN-00003"},
		{day("2026-10-02"), "in", 649.86, "Gold Loan · Partial — LN-00003"},
		{day("2026-10-02"), "in", 0.1, "Savings"},
		{day("2026-10-02"), "in", 0.2, "Savings"},
	}
	rows, totals := buildCashLedger(90_000, moves, nil, 0)
	if rows[0].Balance != 84_012.83 || rows[1].Balance != 84_662.69 {
		t.Errorf("balances %.2f, %.2f — want 84012.83 then 84662.69", rows[0].Balance, rows[1].Balance)
	}
	if month := rows[len(rows)-1]; !month.Total || month.Credit != 650.16 || month.Balance != 84_662.99 {
		t.Errorf("month total %+v — want credit 650.16, balance 84662.99", month)
	}
	if totals.TotalCredit != 650.16 || totals.ClosingBalance != 84_662.99 {
		t.Errorf("totals %+v", totals)
	}
}

// Narrowing to one loan hides the other rows but keeps the ledger's balances, as the Ledger page does.
func TestCashLedger_LoanFilterKeepsLedgerBalance(t *testing.T) {
	moves := []ledgerMovement{
		{day("2026-10-01"), "out", 25_000, "Loan disbursement — LN-00144"},
		{day("2026-10-02"), "in", 1_000, "Savings"},
		{day("2026-10-03"), "in", 5_000, "Gold Loan · Partial — LN-00144"},
	}
	rows, totals := buildCashLedger(50_000, moves, map[int]int{144: 2026}, 144)
	if len(rows) != 3 {
		t.Fatalf("want 2 entries + 1 month total, got %+v", rows)
	}
	if rows[0].Balance != 25_000 || rows[1].Balance != 31_000 {
		t.Errorf("balances %.2f, %.2f — want 25000 then 31000 (the hidden 1000 still counts)", rows[0].Balance, rows[1].Balance)
	}
	if !rows[2].Total || rows[2].Debit != 25_000 || rows[2].Credit != 5_000 {
		t.Errorf("month total %+v", rows[2])
	}
	if totals.TotalDebit != 25_000 || totals.TotalCredit != 5_000 || totals.ClosingBalance != 31_000 {
		t.Errorf("totals %+v", totals)
	}
}
