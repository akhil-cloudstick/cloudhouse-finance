package controllers

import (
	"testing"
	"time"
)

// A loan's Discount appears on the main ledger as a debit in Cash, but moves no money: it never changes a balance
// or a total.
func TestDiscountLedgerRow(t *testing.T) {
	on := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	src := discountLedgerRow(7, 261, on, "interest", "", "LN-00069", 98.63, 0, 9, "Adithyan")
	row := toLedgerRow(src)
	if row.DebitOrCredit != "debit" || !row.Memo || row.Method != "Cash" || row.Type != "Discount" {
		t.Fatalf("discount row = %+v, want a Cash debit memo of type Discount", row)
	}
	if row.LoanID != 261 || row.PaymentID != 7 {
		t.Fatalf("discount row ids = loan %d payment %d, want 261/7 so it can be edited from the ledger", row.LoanID, row.PaymentID)
	}
	if row.Description != "Interest discount — LN-00069" {
		t.Fatalf("description = %q", row.Description)
	}
	// a memo row is shown but is left out of the totals and the net
	agg := aggregateLedgerRows([]ledgerSourceRow{src})
	if agg.count != 1 || agg.debit != 0 || agg.credit != 0 || agg.net != 0 {
		t.Fatalf("aggregate = %+v, want one row and no amounts", agg)
	}
	if got := ledgerRowTypeBuckets(src); len(got) != 1 || got[0] != "collection" {
		t.Fatalf("type buckets = %v, want [collection]", got)
	}
}

func TestDiscountLedgerRow_KeepsItsMode(t *testing.T) {
	src := discountLedgerRow(1, 2, time.Now(), "penal_interest", "UPI", "LN-1", 10, 0, 1, "x")
	if src.Method != "UPI" {
		t.Fatalf("method = %q, want UPI", src.Method)
	}
}
