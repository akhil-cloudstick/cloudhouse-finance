package controllers

// Pledge -> edit -> release -> edit -> delete against the scratch database, checking the cash lines and the
// "Bank Pledge Release" expense after every step (see integration_minimum_period_test.go for how to run):
//
//	WHATSAPP_ORIGIN=http://127.0.0.1:1 WHATSAPP_API_KEY=off DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations \
//	  go test ./modules/Loan/controllers/ -run IntegrationBankPledgeEdit -v

import (
	"testing"
	"time"

	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
)

func pledgeLines(t *testing.T, group string) (n int, sum float64) {
	t.Helper()
	if group == "" {
		return 0, 0
	}
	if err := config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(amount),0) FROM cash_movements WHERE transaction_group_id = ?`, group).Row().Scan(&n, &sum); err != nil {
		t.Fatal(err)
	}
	return
}

func TestIntegration_BankPledgeEditAndDelete(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 5)
	day := time.Now().AddDate(0, 0, -2)
	if _, err := SaveBankPledge(ctx, id, nil, BankPledgeInput{BankName: "Test Bank", PledgedAmount: 1000, PledgeDate: day, CashTreatment: models.BankPledgeCashTreatmentCashIn, CashAmount: 1000}); err != nil {
		t.Fatalf("pledge: %v", err)
	}
	recs, _ := findActivePledges(ctx, id)
	if len(recs) != 1 || recs[0].CashTransactionGroupID == "" {
		t.Fatalf("pledge not saved with a cash group: %+v", recs)
	}
	pid := recs[0].ID

	// preview changes nothing
	res, err := editBankPledge(ctx, id, pid, &EditBankPledgeInput{PledgedAmount: f64(1500)}, true)
	if err != nil || res.After.PledgedAmount != 1500 {
		t.Fatalf("dry run: %v %+v", err, res)
	}
	if n, sum := pledgeLines(t, recs[0].CashTransactionGroupID); n != 1 || sum != 1000 {
		t.Fatalf("dry run touched the ledger: %d %v", n, sum)
	}

	// edit: amount and bank
	if _, err := editBankPledge(ctx, id, pid, &EditBankPledgeInput{PledgedAmount: f64(1500), BankName: str("Other Bank")}, false); err != nil {
		t.Fatalf("edit: %v", err)
	}
	p, _ := findBankPledgeByID(ctx, pid)
	if p.PledgedAmount != 1500 || p.BankName != "Other Bank" || p.CashTransactionGroupID == recs[0].CashTransactionGroupID {
		t.Fatalf("record not rewritten: %+v", p)
	}
	if n, sum := pledgeLines(t, recs[0].CashTransactionGroupID); n != 0 || sum != 0 {
		t.Fatalf("old lines left behind: %d %v", n, sum)
	}
	if n, sum := pledgeLines(t, p.CashTransactionGroupID); n != 1 || sum != 1500 {
		t.Fatalf("new lines wrong: %d %v", n, sum)
	}

	// release, then edit the release amount through the pledge
	if _, err := releaseBankPledge(ctx, id, pid, nil, BankPledgeReleaseInput{CashAmount: 1500}, nil, ""); err != nil {
		t.Fatalf("release: %v", err)
	}
	p, _ = findBankPledgeByID(ctx, pid)
	if p.ReleaseCashTransactionGroupID == "" || p.ReleaseExpenseID == nil {
		t.Fatalf("release not linked: %+v", p)
	}
	oldRel, oldExp := p.ReleaseCashTransactionGroupID, *p.ReleaseExpenseID
	if _, err := editBankPledge(ctx, id, pid, &EditBankPledgeInput{PledgedAmount: f64(1200)}, false); err != nil {
		t.Fatalf("edit released: %v", err)
	}
	p, _ = findBankPledgeByID(ctx, pid)
	if n, sum := pledgeLines(t, oldRel); n != 0 || sum != 0 {
		t.Fatalf("old release lines left: %d %v", n, sum)
	}
	if n, sum := pledgeLines(t, p.ReleaseCashTransactionGroupID); n != 1 || sum != 1200 {
		t.Fatalf("new release lines wrong: %d %v", n, sum)
	}
	if n, sum := pledgeLines(t, p.CashTransactionGroupID); n != 1 || sum != 1200 {
		t.Fatalf("pledge lines wrong: %d %v", n, sum)
	}
	var expAmount float64
	if err := config.BaseDB.Raw(`SELECT amount FROM expenses WHERE id = ?`, oldExp).Row().Scan(&expAmount); err != nil || expAmount != 1200 || *p.ReleaseExpenseID != oldExp {
		t.Fatalf("expense not rewritten in place: %v %v", expAmount, err)
	}

	// delete removes the record, both line groups and the expense
	if _, err := editBankPledge(ctx, id, pid, nil, false); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := findBankPledgeByID(ctx, pid); err == nil {
		t.Fatal("pledge still there")
	}
	var left int
	_ = config.BaseDB.Raw(`SELECT (SELECT count(*) FROM cash_movements WHERE transaction_group_id IN (?, ?)) + (SELECT count(*) FROM expenses WHERE id = ?)`, p.CashTransactionGroupID, p.ReleaseCashTransactionGroupID, oldExp).Row().Scan(&left)
	if left != 0 {
		t.Fatalf("%d ledger rows left after delete", left)
	}
	l, _ := findLoanByID(ctx, id)
	if l.BankPledgeStatus != "Not Pledged" {
		t.Fatalf("loan pledge status %q", l.BankPledgeStatus)
	}
}
