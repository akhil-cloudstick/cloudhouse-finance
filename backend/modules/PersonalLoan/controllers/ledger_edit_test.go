package controllers

import (
	"cloudhouse/backend/modules/PersonalLoan/models"
	"testing"
	"time"
)

func pay(id uint, amt float64, day int) models.PersonalLoanPayment {
	return models.PersonalLoanPayment{ID: id, Amount: amt, PaidOn: time.Date(2026, 1, day, 10, 0, 0, 0, time.UTC)}
}

func TestReplayBalances(t *testing.T) {
	run, out, err := replayBalances(1000, []models.PersonalLoanPayment{pay(1, 300, 1), pay(2, 200, 2)})
	if err != nil || out != 500 || run[0] != 700 || run[1] != 500 {
		t.Fatalf("run=%v out=%v err=%v", run, out, err)
	}
	if _, _, err := replayBalances(1000, []models.PersonalLoanPayment{pay(1, 600, 1), pay(2, 500, 2)}); err == nil {
		t.Fatal("expected overpayment error")
	}
	_, out, err = replayBalances(1000, []models.PersonalLoanPayment{pay(1, 1000, 1)})
	if err != nil || out != 0 {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestReplayInstallments(t *testing.T) {
	insts := []models.PersonalLoanInstallment{
		{SequenceNo: 1, Amount: 300, Status: "Paid", PaidAmount: 300},
		{SequenceNo: 2, Amount: 300, Status: "PartiallyPaid", PaidAmount: 100},
		{SequenceNo: 3, Amount: 300, Status: "Pending"},
	}
	got := replayInstallments(insts, 250)
	if got[0].Status != "PartiallyPaid" || got[0].PaidAmount != 250 || got[1].Status != "Pending" || got[1].PaidAmount != 0 {
		t.Fatalf("got %+v", got)
	}
	if sameInstallments(insts, replayInstallments(insts, 400)) != "" {
		t.Fatal("400 paid should reproduce the saved instalments")
	}
	if sameInstallments(insts, got) == "" {
		t.Fatal("expected a difference")
	}
}

func TestGuardPersonalEditable(t *testing.T) {
	l := &models.PersonalLoan{Status: models.StatusActive}
	if err := guardPersonalEditable(l, nil); err != nil {
		t.Fatal(err)
	}
	l.PenalCycleCount = 1
	if guardPersonalEditable(l, nil) == nil {
		t.Fatal("penal loans must be refused")
	}
	l = &models.PersonalLoan{Status: models.StatusActive}
	if guardPersonalEditable(l, []models.PersonalLoanPayment{{Method: rolloverMethod}}) == nil {
		t.Fatal("rollover must be refused")
	}
	l.Status = models.StatusPendingApproval
	if guardPersonalEditable(l, nil) == nil {
		t.Fatal("unapproved must be refused")
	}
}

func TestProbePersonalLoan(t *testing.T) {
	l := &models.PersonalLoan{PrincipalAmount: 1000, OutstandingAmount: 500, TotalPaid: 500}
	p1, p2 := pay(1, 300, 1), pay(2, 200, 2)
	p1.RunningBalance, p2.RunningBalance = 700, 500
	insts := []models.PersonalLoanInstallment{{SequenceNo: 1, Amount: 500, Status: "Paid", PaidAmount: 500}, {SequenceNo: 2, Amount: 500, Status: "Pending"}}
	if err := probePersonalLoan(l, []models.PersonalLoanPayment{p1, p2}, insts); err != nil {
		t.Fatal(err)
	}
	p2.RunningBalance = 400
	if probePersonalLoan(l, []models.PersonalLoanPayment{p1, p2}, insts) == nil {
		t.Fatal("mismatched running balance must be refused")
	}
}

func TestApplyReplayReopensClosedLoan(t *testing.T) {
	l := &models.PersonalLoan{PrincipalAmount: 1000, Status: models.StatusClosed, OutstandingAmount: 0}
	now := time.Now()
	l.ClosedAt = &now
	insts := []models.PersonalLoanInstallment{{SequenceNo: 1, Amount: 1000, Status: "Paid", PaidAmount: 1000, DueDate: time.Now().AddDate(1, 0, 0)}}
	rows := []models.PersonalLoanPayment{pay(1, 600, 1)}
	if _, err := applyReplay(l, rows, insts, models.StatusClosed); err != nil {
		t.Fatal(err)
	}
	if l.Status != models.StatusActive || l.ClosedAt != nil || l.OutstandingAmount != 400 || l.TotalPaid != 600 {
		t.Fatalf("%+v", l)
	}
	rows = []models.PersonalLoanPayment{pay(1, 1000, 1)}
	if _, err := applyReplay(l, rows, insts, models.StatusActive); err != nil || l.Status != models.StatusClosed {
		t.Fatalf("%v %+v", err, l)
	}
}
