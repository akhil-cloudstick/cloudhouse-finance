package controllers

import (
	"context"
	"testing"
	"time"
)

func TestExpandSplitPayment(t *testing.T) {
	bank := uint(3)
	base := ledgerSourceRow{Kind: "loan_payment", ID: 9, Method: "Split", Amount: 1000, RunningBalance: 4000, BankID: &bank, BankName: "SBI"}
	rows := expandSplitPayment(base, splitParts{Cash: 600, Upi: 400})
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	if rows[0].Method != "Cash" || rows[0].Amount != 600 || rows[0].RunningBalance != 4400 || rows[0].BankID != nil {
		t.Errorf("cash part = %+v", rows[0])
	}
	if rows[1].Method != "UPI" || rows[1].Amount != 400 || rows[1].RunningBalance != 4000 || rows[1].BankID == nil {
		t.Errorf("upi part = %+v", rows[1])
	}
	if got := onlyMode(expandSplitPayment(base, splitParts{Cash: 600, Upi: 400}), "UPI"); len(got) != 1 || got[0].Amount != 400 {
		t.Errorf("onlyMode(UPI) = %+v", got)
	}
	if got := withoutCashParts(expandSplitPayment(base, splitParts{Cash: 600, Upi: 400})); len(got) != 1 || got[0].Method != "UPI" {
		t.Errorf("withoutCashParts = %+v", got)
	}
	single := base
	single.Method = "Cash"
	if got := expandSplitPayment(single, splitParts{Cash: 1000}); len(got) != 1 || got[0].Amount != 1000 || got[0].BankID == nil {
		t.Errorf("single-mode payment changed: %+v", got)
	}
}

func TestExpandPaymentRows_OneRowPerComponentInItsMode(t *testing.T) {
	r := ledgerSourceRow{Kind: "loan_payment", ID: 7, Reference: "LN-0092", Amount: 10000, Method: "Split"}
	parts := splitParts{Cash: 5000, Upi: 5000}
	comps := paymentComponents("Partial", 0, 1000, 9000, 0, 10000)
	rows := expandPaymentRows(r, parts, comps)
	want := []struct {
		typ, method string
		amount      float64
	}{{"Interest", "Cash", 1000}, {"Principal", "Cash", 4000}, {"Principal", "UPI", 5000}}
	if len(rows) != len(want) {
		t.Fatalf("got %d rows, want %d: %+v", len(rows), len(want), rows)
	}
	var total float64
	for i, w := range want {
		if rows[i].Type != w.typ || rows[i].Method != w.method || rows[i].Amount != w.amount {
			t.Errorf("row %d = %s/%s/%.2f, want %s/%s/%.2f", i, rows[i].Type, rows[i].Method, rows[i].Amount, w.typ, w.method, w.amount)
		}
		total += rows[i].Amount
	}
	if total != 10000 {
		t.Errorf("rows add up to %.2f, want 10000", total)
	}
}

func TestPaymentComponents_FallsBackWhenPartsDoNotAddUp(t *testing.T) {
	if got := paymentComponents("Interest", 0, 0, 0, 0, 500); got != nil {
		t.Errorf("a payment with nothing applied should fall back, got %v", got)
	}
	if got := paymentComponents("Disbursement Reversal", 0, 100, 0, 0, 100); got != nil {
		t.Errorf("only repayments are split into components, got %v", got)
	}
}

func TestCashOutLabel(t *testing.T) {
	cases := map[string]string{
		"Loan disbursement — LN-0092":                 "Loan",
		"Loan top-up — LN-0092":                       "Loan",
		"Loan disbursement — PL-00026":                "Personal Loan",
		"Interest payout — INV-00001":                 "Investment",
		"Principal return — INV-00001":                "Investment",
		"Interest & Principal withdrawal — INV-00003": "Investment",
		"Auction surplus settlement — LN-0092":        "Auction",
		"Auction expenses — LN-0092":                  "Auction",
		"Bank pledge release — HDFC — LN-0092":        "Bank Pledge",
		"Office rent": "Expense",
		"":            "Expense",
	}
	for purpose, want := range cases {
		if got := cashOutLabel(purpose); got != want {
			t.Errorf("cashOutLabel(%q) = %q, want %q", purpose, got, want)
		}
	}
}

func TestAuctionRepaymentRows(t *testing.T) {
	day := time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC)
	comps := paymentComponents("Auction Sale", 0, 533.33, 19000, 0, 19533.33)
	payment := ledgerSourceRow{Kind: "loan_payment", ID: 9, Date: day, Type: "Auction Sale", Method: "UPI", Amount: 19533.33, Reference: "LN-00005"}

	// A sale saved with its own repayment cash lines is an ordinary repayment: real credit rows.
	real := expandPaymentRows(payment, splitParts{Upi: 19533.33}, comps)
	if len(real) != 2 || real[0].Memo || real[0].Description != "Interest — Auction Sale" || real[1].Description != "Principal — Auction Sale" {
		t.Fatalf("a linked sale should give two real repayment rows, got %+v", real)
	}
	_, _, totals, err := paginateLedgerRows(context.Background(), real, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if totals.TotalCredit != 19533.33 {
		t.Errorf("real rows should count, credit total = %.2f", totals.TotalCredit)
	}

	// An older sale (no cash lines of its own) is shown as a memo: listed, but not counted twice.
	old := payment
	old.Memo = true
	memo := expandPaymentRows(old, splitParts{Upi: 19533.33}, comps)
	sale := ledgerSourceRow{Kind: "loan_payment", ID: 1, Date: day, Description: "Auction sale proceeds — LN-00005", Type: "Auction", Method: "UPI", Amount: 25000}
	rows := append([]ledgerSourceRow{sale}, memo...)
	_, total, totals, err := paginateLedgerRows(context.Background(), rows, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || totals.TotalCredit != 25000 {
		t.Errorf("memo rows should be listed (3 rows) but not counted: got %d rows, credit %.2f", total, totals.TotalCredit)
	}
	if !memo[0].Memo || memo[0].Description != "Interest — Auction Sale (applied to loan)" {
		t.Errorf("older sale rows should read as applied-to-loan memos, got %+v", memo[0])
	}
}
