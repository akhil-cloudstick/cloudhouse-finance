package controllers

import (
	"strings"
	"testing"
	"time"

	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
)

// sanctionedLoan opens a pending 10,000 loan with a flat 100 service charge and sanctions it through
// SaveLoanApproval (payout 9,900 in cash), so the disbursement row and cash lines are the app's own.
func sanctionedLoan(t *testing.T) *ledgerLoan {
	t.Helper()
	ctx := integrationCtx(t)
	bank := testBank(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 0)
	t.Cleanup(func() { removeLoan(id) })
	stage, err := firstSanctionStage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	exec(t, `UPDATE loans SET status = 'Pending Approval', approval_stage = ?, principal_amount = 10000, outstanding_amount = 10000, sanctioned_amount = 0, disbursed_amount = 0,
		service_charge_type = 'Flat', service_charge_value = 100, service_charge_amount = 100, disbursement_date = NULL WHERE id = ?`, stage, id)
	for i := 0; i < 6; i++ {
		cur, _ := findLoanByID(ctx, id)
		if cur.ApprovalStage == models.ApprovalStageApproved {
			break
		}
		if _, err := SaveLoanApproval(ctx, id, ApprovalInput{Stage: cur.ApprovalStage, Action: models.ApprovalStageApproved, ActorRoleID: adminRoleID, CashAmount: 9900}); err != nil {
			t.Fatalf("sanction: %v", err)
		}
	}
	loan, _ := findLoanByID(ctx, id)
	return &ledgerLoan{t: t, ctx: ctx, id: id, number: loan.LoanNumber, opened: loan.OpenedDate.UTC(), bank: bank, live: true}
}

func disbLines(t *testing.T, l *ledgerLoan) (n int, sum float64) {
	t.Helper()
	if err := config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(amount),0) FROM cash_movements WHERE source_id = ? AND source_type = 'loan_disbursement'`, l.id).Row().Scan(&n, &sum); err != nil {
		t.Fatal(err)
	}
	return
}

func TestIntegrationLedger_SanctionEdits(t *testing.T) {
	integrationCtx(t)
	type c struct {
		name  string
		in    func(l *ledgerLoan) *EditDisbursementInput
		check func(t *testing.T, l *ledgerLoan)
	}
	earlier := func() *time.Time { d := time.Now().AddDate(0, 0, -4); return &d }
	cases := []c{
		{"amount 10000->9000 (flat charge stays)", func(l *ledgerLoan) *EditDisbursementInput {
			return &EditDisbursementInput{SanctionedAmount: f64(9000), CashAmount: f64(8900)}
		}, func(t *testing.T, l *ledgerLoan) {
			ln := l.loan()
			if !closeTo(ln.SanctionedAmount, 9000) || !closeTo(ln.PrincipalAmount, 9000) || !closeTo(ln.DisbursedAmount, 8900) || !closeTo(ln.OutstandingAmount, 9000) {
				t.Errorf("loan %+v", summarize(ln))
			}
			if n, sum := disbLines(t, l); n == 0 || sum < 8899 {
				t.Errorf("disbursement lines %d totalling %.2f", n, sum)
			}
		}},
		{"service charge 100->250", func(l *ledgerLoan) *EditDisbursementInput {
			return &EditDisbursementInput{ServiceCharge: f64(250), CashAmount: f64(9750)}
		}, func(t *testing.T, l *ledgerLoan) {
			if ln := l.loan(); !closeTo(ln.ServiceChargeAmount, 250) || !closeTo(ln.DisbursedAmount, 9750) {
				t.Errorf("charge %.2f disbursed %.2f", ln.ServiceChargeAmount, ln.DisbursedAmount)
			}
		}},
		{"payout split cash->cash+UPI", func(l *ledgerLoan) *EditDisbursementInput {
			return &EditDisbursementInput{CashAmount: f64(9000), UpiAmount: f64(900), BankID: &l.bank}
		}, func(t *testing.T, l *ledgerLoan) {
			if got := scalarFloat(t, `SELECT COALESCE(sum(amount),0) FROM cash_movements WHERE source_id = ? AND source_type = 'loan_disbursement' AND mode = 'UPI'`, l.id); !closeTo(got, 900) {
				t.Errorf("UPI payout lines %.2f", got)
			}
		}},
		{"date earlier by 4 days", func(l *ledgerLoan) *EditDisbursementInput { return &EditDisbursementInput{DisbursedOn: earlier()} },
			func(t *testing.T, l *ledgerLoan) {
				ln := l.loan()
				want := dayOf(time.Now().AddDate(0, 0, -4))
				if dayOf(*ln.DisbursementDate) != want || dayOf(ln.OpenedDate) != want {
					t.Errorf("disbursed %s opened %s, want %s", ln.DisbursementDate, ln.OpenedDate, want)
				}
			}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			l := sanctionedLoan(t)
			in := tc.in(l)
			snap := snapshotLoan(t, l.id)
			dry, _, err := editLoanDisbursement(l.ctx, l.id, in, "x", true)
			if err != nil {
				t.Fatalf("dry run: %v", err)
			}
			if snapshotLoan(t, l.id) != snap {
				t.Fatal("dry run changed the database")
			}
			res, _, err := editLoanDisbursement(l.ctx, l.id, in, "x", false)
			if err != nil {
				t.Fatalf("edit: %v", err)
			}
			if dry.After != res.After {
				t.Errorf("preview %+v differs from saved %+v", dry.After, res.After)
			}
			tc.check(t, l)
			fullReplayHolds(t, "after sanction edit", l)
			var rows []string
			config.BaseDB.Raw(`SELECT cash_transaction_group_id FROM loan_payments WHERE loan_id = ? AND type = 'Disbursement'`, l.id).Scan(&rows)
			if len(rows) != 1 || rows[0] == "" || len(groupLines(t, rows[0])) == 0 {
				t.Errorf("the disbursement row does not carry its cash group: %v", rows)
			}
			if n := scalarInt(t, `SELECT count(DISTINCT transaction_group_id) FROM cash_movements WHERE source_id = ? AND source_type IN ('loan_disbursement','loan_service_charge')`, l.id); n != 1 {
				t.Errorf("%d cash groups for the disbursement, want 1 (old lines must be gone)", n)
			}
		})
	}
}

func TestIntegrationLedger_SanctionRefusals(t *testing.T) {
	integrationCtx(t)
	l := sanctionedLoan(t)
	l.pids = append(l.pids, l.pay(payStep{day: 0, typ: models.PaymentTypePrincipal, amt: 9500, cash: 9500}))
	snap := snapshotLoan(t, l.id)
	_, _, err := editLoanDisbursement(l.ctx, l.id, &EditDisbursementInput{SanctionedAmount: f64(9000), CashAmount: f64(8900)}, "x", false)
	l.wantRefused(err, 400, "no longer fits", snap)
	future := time.Now().AddDate(0, 0, 3)
	for name, c := range map[string]struct {
		in       *EditDisbursementInput
		contains string
	}{
		"zero amount":           {&EditDisbursementInput{SanctionedAmount: f64(0)}, "greater than zero"},
		"charge above amount":   {&EditDisbursementInput{ServiceCharge: f64(20000)}, "less than"},
		"negative charge":       {&EditDisbursementInput{ServiceCharge: f64(-1)}, "negative"},
		"future date":           {&EditDisbursementInput{DisbursedOn: &future}, "future"},
		"split not adding up":   {&EditDisbursementInput{CashAmount: f64(10)}, ""},
		"UPI without a bank":    {&EditDisbursementInput{CashAmount: f64(0), UpiAmount: f64(9900)}, "bank"},
		"above the gold allows": {&EditDisbursementInput{SanctionedAmount: f64(900000), CashAmount: f64(899900)}, "eligible"},
	} {
		_, _, err := editLoanDisbursement(l.ctx, l.id, c.in, "x", false)
		if err == nil || codeOf(err) != 400 || !strings.Contains(err.Error(), c.contains) {
			t.Errorf("%s: got %d %v", name, codeOf(err), err)
		}
		if snapshotLoan(t, l.id) != snap {
			t.Errorf("%s: the database changed", name)
		}
	}
	p := sanctionedLoan(t)
	exec(t, `UPDATE loans SET status = 'Pending Approval' WHERE id = ?`, p.id)
	s2 := snapshotLoan(t, p.id)
	_, _, err = editLoanDisbursement(p.ctx, p.id, &EditDisbursementInput{ServiceCharge: f64(1)}, "x", false)
	p.wantRefused(err, 409, "pending approval", s2)
	q := sanctionedLoan(t)
	exec(t, `DELETE FROM cash_movements WHERE source_id = ? AND source_type LIKE 'loan_%'`, q.id)
	s3 := snapshotLoan(t, q.id)
	_, _, err = editLoanDisbursement(q.ctx, q.id, &EditDisbursementInput{ServiceCharge: f64(1)}, "x", false)
	q.wantRefused(err, 409, "cannot be identified exactly", s3)
}
