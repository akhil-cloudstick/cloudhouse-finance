package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"testing"
)

type splitRow struct {
	component, mode string
	amount          float64
}

func repaymentRows(entries []LoanLedgerEntry) []LoanLedgerEntry {
	var rows []LoanLedgerEntry
	for _, e := range entries {
		if e.Kind == "payment" {
			rows = append(rows, e)
		}
	}
	return rows
}

// One repayment shows as a line for each thing it paid (penal interest, interest, principal), and the parts are
// taken from the modes in order: cash first, then UPI, then bank transfer.
func TestRepaymentIsSplitIntoComponentsPaidFromCashThenUpiThenBank(t *testing.T) {
	disbursed := ledgerTestDay("2026-10-02")
	l := &models.Loan{SanctionedAmount: 100000, DisbursedAmount: 100000, DisbursementDate: &disbursed}
	payments := []models.LoanPayment{
		{ID: 1, Type: models.PaymentTypeDisbursement, Amount: 100000, PaidOn: disbursed, CashAmount: 100000},
		{
			ID: 2, Type: models.PaymentTypePartial, Amount: 10000, PaidOn: ledgerTestDay("2026-11-05"),
			CashAmount: 1000, UpiAmount: 4000, BankTransferAmount: 5000,
			PenalInterestApplied: 500, InterestApplied: 2500, PrincipalApplied: 7000, RunningBalance: 93000,
		},
	}
	got := repaymentRows(buildLoanLedger(l, payments, nil, nil, nil))
	// 500 penal + 500 interest from cash; the other 2,000 of interest and 2,000 of principal from UPI;
	// the remaining 5,000 of principal from bank transfer.
	want := []splitRow{
		{"Penal Interest", "Cash", 500},
		{"Interest", "Cash", 500},
		{"Interest", "UPI", 2000},
		{"Principal", "UPI", 2000},
		{"Principal", "Bank Transfer", 5000},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d rows, want %d: %+v", len(got), len(want), got)
	}
	var total float64
	for i, w := range want {
		g := got[i]
		if g.Component != w.component || g.Mode != w.mode || g.Amount != w.amount {
			t.Errorf("row %d = %s via %s %.0f, want %s via %s %.0f", i, g.Component, g.Mode, g.Amount, w.component, w.mode, w.amount)
		}
		total += g.Amount
	}
	if total != 10000 {
		t.Errorf("rows add up to %.0f, want the 10000 paid", total)
	}
}

// A mode that was not used is skipped: the part it would have covered is covered by the next mode.
func TestRepaymentSkipsAModeThatWasNotUsed(t *testing.T) {
	disbursed := ledgerTestDay("2026-10-02")
	l := &models.Loan{SanctionedAmount: 100000, DisbursedAmount: 100000, DisbursementDate: &disbursed}
	payments := []models.LoanPayment{
		{ID: 1, Type: models.PaymentTypeDisbursement, Amount: 100000, PaidOn: disbursed, CashAmount: 100000},
		{
			ID: 2, Type: models.PaymentTypeInterest, Amount: 3000, PaidOn: ledgerTestDay("2026-11-05"),
			BankTransferAmount: 3000, InterestApplied: 3000, RunningBalance: 100000,
		},
	}
	got := repaymentRows(buildLoanLedger(l, payments, nil, nil, nil))
	if len(got) != 1 || got[0].Component != "Interest" || got[0].Mode != "Bank Transfer" || got[0].Amount != 3000 {
		t.Fatalf("want one Interest row paid by bank transfer, got %+v", got)
	}
}

// A payment whose parts do not add up to the amount (an older row) is still shown as before.
func TestRepaymentWithUnknownPartsStaysOneRow(t *testing.T) {
	disbursed := ledgerTestDay("2026-10-02")
	l := &models.Loan{SanctionedAmount: 100000, DisbursedAmount: 100000, DisbursementDate: &disbursed}
	payments := []models.LoanPayment{
		{ID: 1, Type: models.PaymentTypeDisbursement, Amount: 100000, PaidOn: disbursed, CashAmount: 100000},
		{ID: 2, Type: models.PaymentTypePartial, Amount: 5000, PaidOn: ledgerTestDay("2026-11-05"), CashAmount: 5000, RunningBalance: 95000},
	}
	got := repaymentRows(buildLoanLedger(l, payments, nil, nil, nil))
	if len(got) != 1 || got[0].Component != "" || got[0].Amount != 5000 {
		t.Fatalf("want one plain 5000 row, got %+v", got)
	}
}

// A payment that pays half of a month's interest is paid up to half way through that month, and one that
// clears the month is paid up to its last day.
func TestInterestPaidThroughDate(t *testing.T) {
	opened := ledgerTestDay("2026-10-01")
	l := &models.Loan{OpenedDate: opened}
	accruals := []models.LoanAccrual{
		{ID: 1, AccruedOn: ledgerTestDay("2026-10-31"), Interest: 1000},
		{ID: 2, AccruedOn: ledgerTestDay("2026-11-30"), Interest: 1000},
	}
	payments := []models.LoanPayment{
		{ID: 10, Type: models.PaymentTypeInterest, PaidOn: ledgerTestDay("2026-10-31"), Amount: 1000, InterestApplied: 1000},
		{ID: 11, Type: models.PaymentTypeInterest, PaidOn: ledgerTestDay("2026-11-30"), Amount: 500, InterestApplied: 500},
		{ID: 12, Type: models.PaymentTypeInterest, PaidOn: ledgerTestDay("2026-12-01"), Amount: 500, InterestApplied: 500},
	}
	got := interestPaidThroughDates(l, payments, accruals)
	// 1,000 clears the first month; 500 more is half of the second, 30 days long, so 15 days in
	want := map[uint]string{10: "2026-10-31", 11: "2026-11-15", 12: "2026-11-30"}
	for id, w := range want {
		if got[id] != w {
			t.Errorf("payment %d paid through %q, want %q", id, got[id], w)
		}
	}
}

func TestInterestPaidThroughIgnoresPaymentsThatPaidNoInterest(t *testing.T) {
	l := &models.Loan{OpenedDate: ledgerTestDay("2026-10-01")}
	accruals := []models.LoanAccrual{{ID: 1, AccruedOn: ledgerTestDay("2026-10-31"), Interest: 1000}}
	payments := []models.LoanPayment{{ID: 5, Type: models.PaymentTypePrincipal, Amount: 4000, PrincipalApplied: 4000, PaidOn: ledgerTestDay("2026-10-20")}}
	if got := interestPaidThroughDates(l, payments, accruals); len(got) != 0 {
		t.Errorf("want no date for a principal-only payment, got %v", got)
	}
}
