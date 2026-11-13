package controllers

import (
	"strings"
	"testing"

	"cloudhouse/backend/modules/Cash/models"
)

func TestValidateMovementMode(t *testing.T) {
	bank := uint(4)
	cases := []struct {
		name    string
		m       models.CashMovement
		wantErr bool
		bankNil bool
	}{
		{"cash drops a stray bank", models.CashMovement{Mode: "Cash", BankID: &bank}, false, true},
		{"upi with a bank", models.CashMovement{Mode: "UPI", BankID: &bank}, false, false},
		{"bank transfer with a bank", models.CashMovement{Mode: "Bank Transfer", BankID: &bank}, false, false},
		{"upi without a bank", models.CashMovement{Mode: "UPI"}, true, true},
		{"blank mode", models.CashMovement{}, true, true},
		{"cheque is not a mode", models.CashMovement{Mode: "Cheque", BankID: &bank}, true, false},
		{"free text mode", models.CashMovement{Mode: "NEFT", BankID: &bank}, true, false},
	}
	for _, c := range cases {
		m := c.m
		err := validateMovementMode(&m)
		if (err != nil) != c.wantErr {
			t.Errorf("%s: err = %v, wantErr %v", c.name, err, c.wantErr)
		}
		if err == nil && c.bankNil && m.BankID != nil {
			t.Errorf("%s: bank id should be cleared", c.name)
		}
	}
}

// cash_movements has no loan_number column: a search clause that names one makes every search query fail
// (nothing is returned for any field). The number is looked up through its real tables instead.
func TestMovementSearchClauseUsesRealColumns(t *testing.T) {
	clause, args := movementSearchClause("LN-00007")
	if strings.Contains(strings.ReplaceAll(clause, "loan_cash_sources WHERE loan_number", ""), " loan_number ILIKE ? OR") {
		t.Fatalf("bare loan_number column on cash_movements: %s", clause)
	}
	if n := strings.Count(clause, "?"); n != len(args) {
		t.Fatalf("%d placeholders, %d args", n, len(args))
	}
	for _, col := range []string{"purpose", "source", "bank", "mode", "remarks", "occurred_on", "amount", "loan_cash_sources", "categories"} {
		if !strings.Contains(clause, col) {
			t.Fatalf("search clause misses %s", col)
		}
	}
}
