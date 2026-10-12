package controllers

import (
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
