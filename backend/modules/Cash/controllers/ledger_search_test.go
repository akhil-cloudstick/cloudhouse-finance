package controllers

import (
	"testing"
	"time"
)

func TestLedgerRowMatchesEveryDisplayedColumn(t *testing.T) {
	r := ledgerSourceRow{
		Kind: "loan_payment", ID: 3, Date: time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC),
		Description: "Interest received", Type: "Collection", Method: "UPI", Reference: "REF-9981",
		LoanNumber: "LN-00069", BankName: "HDFC Main", CustomerName: "Asha Kumar", Amount: 5000,
	}
	for _, needle := range []string{"ln-00069", "ref-9981", "interest rec", "collection", "upi", "hdfc", "asha", "02-10-2026", "2026-10-02", "5,000", "5000"} {
		if !ledgerRowMatches(r, needle) {
			t.Errorf("needle %q found nothing", needle)
		}
	}
	if ledgerRowMatches(r, "zzz") {
		t.Error("unrelated needle matched")
	}
}
