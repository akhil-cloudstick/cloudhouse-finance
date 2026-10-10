package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/PersonalLoan/models"
	"math"
	"testing"
	"time"
)

func TestBuildLedger_DisbursementInterestSplitAndPenal(t *testing.T) {
	d0 := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	l := &models.PersonalLoan{
		ID: 7, LoanNumber: "PL-00025", Status: models.StatusActive,
		PrincipalAmount: 10000, InterestAmount: 500, DisbursedAmount: 9500,
		DisbursedAt: d0, OpenedDate: d0,
	}
	bid := uint(3)
	payments := []models.PersonalLoanPayment{
		{ID: 1, PersonalLoanID: 7, Amount: 4000, PaidOn: d0.AddDate(0, 0, 5), Method: "Split",
			CashAmount: 1000, UpiAmount: 3000, BankID: &bid, BankRef: &commonModels.Bank{Name: "HDFC"}},
	}
	penal := []models.PersonalLoanHistory{{ID: 1, Event: models.EventPenalApplied, Amount: 600, OccurredAt: d0.AddDate(0, 0, 2), Detail: "x"}}
	rows := BuildLedger(l, payments, penal)
	if len(rows) != 5 {
		t.Fatalf("rows = %d, want 5", len(rows))
	}
	for _, r := range rows {
		if r.RefNo != "PL-00025" {
			t.Errorf("refNo = %q", r.RefNo)
		}
	}
	if rows[0].Particulars != "Loan disbursed" || rows[0].Debit != 9500 {
		t.Errorf("first row = %+v", rows[0])
	}
	if rows[1].Debit != 500 || math.Abs(rows[1].Balance-10000) > 0.001 {
		t.Errorf("interest row = %+v", rows[1])
	}
	if rows[2].Kind != "penal" || rows[2].Balance != 10600 {
		t.Errorf("penal row = %+v", rows[2])
	}
	if rows[3].Mode != "Cash" || rows[3].BankID != nil || rows[3].Balance != 10600-1000 {
		t.Errorf("cash share = %+v", rows[3])
	}
	if rows[4].Mode != "UPI" || rows[4].BankID == nil || rows[4].BankName != "HDFC" || rows[4].Balance != 6600 {
		t.Errorf("upi share = %+v", rows[4])
	}
}

func TestBuildLedger_PendingApprovalHasNoDisbursement(t *testing.T) {
	l := &models.PersonalLoan{LoanNumber: "PL-00001", Status: models.StatusPendingApproval, PrincipalAmount: 100, DisbursedAmount: 100}
	if rows := BuildLedger(l, nil, nil); len(rows) != 0 {
		t.Fatalf("rows = %d", len(rows))
	}
}
