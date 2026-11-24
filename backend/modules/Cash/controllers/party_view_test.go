package controllers

import "testing"

// A category (party) ledger reads from the party's side: expense = credit, cash received = debit.
func TestPartyViewFlipsDirection(t *testing.T) {
	exp := toLedgerRow(ledgerSourceRow{Kind: "expense", IsOut: true, PartyView: true, Amount: 100})
	in := toLedgerRow(ledgerSourceRow{Kind: "cash_movement", PartyView: true, Amount: 100})
	if exp.DebitOrCredit != "credit" || in.DebitOrCredit != "debit" {
		t.Fatalf("party view: expense=%s cash-in=%s", exp.DebitOrCredit, in.DebitOrCredit)
	}
	e2 := toLedgerRow(ledgerSourceRow{Kind: "expense", IsOut: true, Amount: 100})
	if e2.DebitOrCredit != "debit" {
		t.Fatalf("daybook expense=%s", e2.DebitOrCredit)
	}
}
