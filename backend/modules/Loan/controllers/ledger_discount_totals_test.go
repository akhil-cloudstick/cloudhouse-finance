package controllers

import (
	"testing"

	"cloudhouse/backend/modules/Loan/models"
)

// A Discount is a debit entry of the loan ledger (the company gives the amount up), a repayment is a credit.
func TestLedgerColumnTotals_DiscountIsADebit(t *testing.T) {
	rows := []LoanLedgerEntry{
		{Kind: "sanction", Amount: 10000},
		{Kind: "payment", Amount: 2000, Payment: &models.LoanPayment{Type: models.PaymentTypePartial}},
		{Kind: "payment", Amount: 300, Payment: &models.LoanPayment{Type: models.PaymentTypeDiscount}},
	}
	debit, credit := ledgerColumnTotals(rows)
	if debit != 10300 || credit != 2000 {
		t.Fatalf("totals = debit %.2f credit %.2f, want 10300 / 2000", debit, credit)
	}
}
