package controllers

import (
	"strings"
	"testing"
	"time"

	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
)

func settlementRow(t *testing.T, l *ledgerLoan) *models.LoanPayment {
	t.Helper()
	var rows []models.LoanPayment
	if err := config.BaseDB.WithContext(l.ctx).Where("loan_id = ? AND description = ?", l.id, topUpSettlementDescription).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		return nil
	}
	return &rows[0]
}

func scalarStrings(t *testing.T, sql string, args ...any) []string {
	t.Helper()
	var out []string
	if err := config.BaseDB.Raw(sql, args...).Scan(&out).Error; err != nil {
		t.Fatal(err)
	}
	return out
}

type topEdit struct {
	name string
	edit func(l *ledgerLoan) *EditTopUpInput
	twin *topStep // the top-up as it would have been entered; nil when no such loan can be saved
}

func TestIntegrationLedger_TopUpEdits(t *testing.T) {
	integrationCtx(t)
	day := func(l *ledgerLoan, d int) *time.Time { return dayTime(l, d) }
	cases := []topEdit{
		{"amount 2000->2500", func(l *ledgerLoan) *EditTopUpInput {
			return &EditTopUpInput{Amount: f64(2500), CashAmount: f64(2500)}
		}, &topStep{day: 90, amount: 2500, cash: 2500, settle: "deduct"}},
		{"amount 2000->1500", func(l *ledgerLoan) *EditTopUpInput {
			return &EditTopUpInput{Amount: f64(1500), CashAmount: f64(1500)}
		}, &topStep{day: 90, amount: 1500, cash: 1500, settle: "deduct"}},
		{"split cash->cash+UPI+bank transfer", func(l *ledgerLoan) *EditTopUpInput {
			return &EditTopUpInput{CashAmount: f64(1500), UpiAmount: f64(300), BankTransferAmount: f64(200), BankID: &l.bank}
		}, nil},
		{"date earlier d90->d85", func(l *ledgerLoan) *EditTopUpInput { return &EditTopUpInput{OccurredOn: day(l, 85)} }, nil},
		{"date earlier d90->d81 (just after the principal payment)", func(l *ledgerLoan) *EditTopUpInput { return &EditTopUpInput{OccurredOn: day(l, 81)} }, nil},
		{"date later d90->d94", func(l *ledgerLoan) *EditTopUpInput { return &EditTopUpInput{OccurredOn: day(l, 94)} }, nil},
		{"reference only", func(l *ledgerLoan) *EditTopUpInput { return &EditTopUpInput{Reference: str("new ref")} }, nil},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			f := topUpHistory(t)
			l := f.ledgerLoan
			target := f.tops[0]
			beforeUp := topUps(t, l)[0]
			if settlementRow(t, l) == nil {
				t.Fatal("fixture has no interest settlement row")
			}
			in := c.edit(l)

			snap := snapshotLoan(t, l.id)
			dry, _, err := editLoanTopUp(l.ctx, l.id, target, in, "x", true)
			if err != nil {
				t.Fatalf("dry run: %v", err)
			}
			if snapshotLoan(t, l.id) != snap {
				t.Fatal("dry run changed the database")
			}
			res, _, err := editLoanTopUp(l.ctx, l.id, target, in, "x", false)
			if err != nil {
				t.Fatalf("edit: %v", err)
			}
			if dry.After != res.After {
				t.Errorf("preview %+v differs from saved %+v", dry.After, res.After)
			}
			fullReplayHolds(t, "after top-up edit", l)
			cashMatchesRows(t, "after top-up edit", l)
			topUpCashMatches(t, "after top-up edit", l)
			up := topUps(t, l)[0]
			if in.Amount != nil && !closeTo(up.Amount, *in.Amount) {
				t.Errorf("amount saved as %.2f", up.Amount)
			}
			if in.Amount != nil || in.CashAmount != nil || in.OccurredOn != nil {
				if up.CashTransactionGroupID == "" || up.CashTransactionGroupID == beforeUp.CashTransactionGroupID {
					t.Errorf("cash group after the edit %q (before %q)", up.CashTransactionGroupID, beforeUp.CashTransactionGroupID)
				}
				if n := len(groupLines(t, beforeUp.CashTransactionGroupID)); n != 0 {
					t.Errorf("%d old top-up cash lines left", n)
				}
			}
			if in.OccurredOn != nil {
				if !sameDay(up.OccurredOn.UTC(), in.OccurredOn.UTC()) {
					t.Errorf("top-up dated %s, want %s", up.OccurredOn, in.OccurredOn)
				}
				for _, ln := range scalarStrings(t, `SELECT to_char(occurred_on AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM cash_movements WHERE transaction_group_id = ?`, up.CashTransactionGroupID) {
					if ln != in.OccurredOn.UTC().Format("2006-01-02") {
						t.Errorf("a cash line of the top-up is dated %s, want %s", ln, in.OccurredOn.UTC().Format("2006-01-02"))
					}
				}
				// the interest taken from the payout belongs to the top-up's own day
				if s := settlementRow(t, l); s == nil {
					t.Error("the interest settlement row vanished")
				} else {
					if !sameDay(s.PaidOn.UTC(), in.OccurredOn.UTC()) {
						t.Errorf("the interest settled from the payout is still dated %s after the top-up moved to %s", s.PaidOn.UTC().Format("2006-01-02"), in.OccurredOn.UTC().Format("2006-01-02"))
					}
					for _, ln := range scalarStrings(t, `SELECT to_char(occurred_on AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM cash_movements WHERE transaction_group_id = ?`, s.CashTransactionGroupID) {
						if ln != in.OccurredOn.UTC().Format("2006-01-02") {
							t.Errorf("a cash line of the interest settlement is dated %s, want %s", ln, in.OccurredOn.UTC().Format("2006-01-02"))
						}
					}
				}
			}
			if c.twin != nil {
				twin := topUpHistoryWith(t, *c.twin)
				sameLedger(t, "edited vs twin", l, twin.ledgerLoan)
			}
			if _, _, err := editLoanTopUp(l.ctx, l.id, target, &EditTopUpInput{}, "x", true); err != nil {
				t.Errorf("a further no-op edit is refused: %v", err)
			}
		})
	}
}

func TestIntegrationLedger_TopUpDelete(t *testing.T) {
	integrationCtx(t)
	f := topUpHistory(t)
	l := f.ledgerLoan
	target := f.tops[0]
	up := topUps(t, l)[0]
	settle := settlementRow(t, l)
	snap := snapshotLoan(t, l.id)
	dry, _, err := editLoanTopUp(l.ctx, l.id, target, nil, "x", true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if snapshotLoan(t, l.id) != snap {
		t.Fatal("dry run changed the database")
	}
	res, _, err := editLoanTopUp(l.ctx, l.id, target, nil, "x", false)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if dry.After != res.After {
		t.Errorf("preview %+v differs from saved %+v", dry.After, res.After)
	}
	if n := scalarInt(t, `SELECT count(*) FROM loan_top_ups WHERE id = ? AND status = 'Active'`, target); n != 0 {
		t.Error("top-up still active")
	}
	if n := len(groupLines(t, up.CashTransactionGroupID)); n != 0 {
		t.Errorf("%d top-up cash lines left", n)
	}
	if settle != nil {
		if n := scalarInt(t, `SELECT count(*) FROM loan_payments WHERE id = ?`, settle.ID); n != 0 {
			t.Error("the interest settled from the payout was not removed with the top-up")
		}
		if n := len(groupLines(t, settle.CashTransactionGroupID)); n != 0 {
			t.Errorf("%d cash lines of the interest settlement left", n)
		}
	}
	ln := l.loan()
	if !closeTo(ln.PrincipalAmount, 10000) {
		t.Errorf("principal after deleting the top-up %.2f, want 10000", ln.PrincipalAmount)
	}
	fullReplayHolds(t, "after top-up delete", l)
	cashMatchesRows(t, "after top-up delete", l)
	topUpCashMatches(t, "after top-up delete", l)
	// a loan that never had the top-up (so no interest was settled from a payout either)
	twin := newLedgerLoan(t, ledgerAge).build([]payStep{
		{day: 35, typ: models.PaymentTypeInterest, amt: 100, cash: 100},
		{day: 50, typ: models.PaymentTypePartial, amt: 2000, cash: 1500, upi: 500, override: f64(40)},
		{day: 80, typ: models.PaymentTypePrincipal, amt: 3000, cash: 3000},
		{day: 95, typ: models.PaymentTypeInterest, amt: 5, cash: 5},
	})
	tl := twin.loan()
	if !closeTo(ln.OutstandingAmount, tl.OutstandingAmount) || !closeTo(ln.AccruedInterest, tl.AccruedInterest) || !closeTo(ln.InterestPaid, tl.InterestPaid) {
		t.Errorf("after the delete: principal %.2f accrued %.2f paid %.2f; a loan that never had the top-up: %.2f %.2f %.2f",
			ln.OutstandingAmount, ln.AccruedInterest, ln.InterestPaid, tl.OutstandingAmount, tl.AccruedInterest, tl.InterestPaid)
	}
}

func TestIntegrationLedger_TopUpRefusals(t *testing.T) {
	integrationCtx(t)
	t.Run("deleting a top-up that a later principal payment depends on is refused, nothing saved", func(t *testing.T) {
		f := topUpHistory(t)
		l := f.ledgerLoan
		// principal after the top-up is 7040; 6500 is more than the 5040 the loan would carry without it
		l.pids = append(l.pids, l.pay(payStep{day: 96, typ: models.PaymentTypePrincipal, amt: 6500, cash: 6500}))
		snap := snapshotLoan(t, l.id)
		for _, dry := range []bool{true, false} {
			_, _, err := editLoanTopUp(l.ctx, l.id, f.tops[0], nil, "x", dry)
			l.wantRefused(err, 400, "no longer fits", snap)
		}
		_, _, err := editLoanTopUp(l.ctx, l.id, f.tops[0], &EditTopUpInput{Amount: f64(500), CashAmount: f64(500)}, "x", false)
		l.wantRefused(err, 400, "no longer fits", snap)
	})
	t.Run("validation errors are 400, unknown ids 404, nothing saved", func(t *testing.T) {
		f := topUpHistory(t)
		l := f.ledgerLoan
		other := newLedgerLoan(t, ledgerAge).withOrnaments()
		otherTop := other.mustTopUp(topStep{day: 90, amount: 500, cash: 500, settle: "deduct"})
		snap := snapshotLoan(t, l.id)
		future := time.Now().AddDate(0, 0, 3)
		early := l.opened.AddDate(0, 0, -3)
		for name, c := range map[string]struct {
			in       *EditTopUpInput
			contains string
		}{
			"zero amount":            {&EditTopUpInput{Amount: f64(0), CashAmount: f64(0)}, ""},
			"split not adding up":    {&EditTopUpInput{Amount: f64(2000), CashAmount: f64(1000)}, ""},
			"UPI without a bank":     {&EditTopUpInput{CashAmount: f64(1000), UpiAmount: f64(1000)}, "bank"},
			"future date":            {&EditTopUpInput{OccurredOn: &future}, "future"},
			"before the loan opened": {&EditTopUpInput{OccurredOn: &early}, "before the loan was opened"},
		} {
			_, _, err := editLoanTopUp(l.ctx, l.id, f.tops[0], c.in, "x", false)
			if err == nil || codeOf(err) != 400 || !strings.Contains(err.Error(), c.contains) {
				t.Errorf("%s: got %d %v", name, codeOf(err), err)
			}
			if snapshotLoan(t, l.id) != snap {
				t.Errorf("%s: the database changed", name)
			}
		}
		_, _, err := editLoanTopUp(l.ctx, l.id, 99999999, &EditTopUpInput{Reference: str("x")}, "x", false)
		l.wantRefused(err, 404, "cannot be edited", snap)
		_, _, err = editLoanTopUp(l.ctx, l.id, otherTop, nil, "x", false)
		l.wantRefused(err, 404, "cannot be edited", snap)
		exec(t, `UPDATE loans SET status = 'Pending Approval' WHERE id = ?`, l.id)
		snap = snapshotLoan(t, l.id)
		_, _, err = editLoanTopUp(l.ctx, l.id, f.tops[0], &EditTopUpInput{Reference: str("x")}, "x", false)
		l.wantRefused(err, 409, "cannot have its ledger edited", snap)
	})
	t.Run("an old top-up without a cash group: found by exact match, otherwise refused 409", func(t *testing.T) {
		f := topUpHistory(t)
		l := f.ledgerLoan
		group := topUps(t, l)[0].CashTransactionGroupID
		exec(t, `UPDATE loan_top_ups SET cash_transaction_group_id = NULL WHERE id = ?`, f.tops[0])
		if _, _, err := editLoanTopUp(l.ctx, l.id, f.tops[0], &EditTopUpInput{Amount: f64(2200), CashAmount: f64(2200)}, "x", false); err != nil {
			t.Fatalf("exact-match fallback refused: %v", err)
		}
		if n := len(groupLines(t, group)); n != 0 {
			t.Errorf("%d original lines left beside the corrected ones", n)
		}
		topUpCashMatches(t, "after fallback edit", l)

		g := topUpHistory(t)
		gl := g.ledgerLoan
		old := topUps(t, gl)[0].CashTransactionGroupID
		exec(t, `UPDATE loan_top_ups SET cash_transaction_group_id = NULL WHERE id = ?`, g.tops[0])
		exec(t, `UPDATE cash_movements SET amount = amount + 1 WHERE transaction_group_id = ?`, old)
		snap := snapshotLoan(t, gl.id)
		_, _, err := editLoanTopUp(gl.ctx, gl.id, g.tops[0], &EditTopUpInput{Amount: f64(2200), CashAmount: f64(2200)}, "x", false)
		gl.wantRefused(err, 409, "cannot be identified exactly", snap)
		_, _, err = editLoanTopUp(gl.ctx, gl.id, g.tops[0], nil, "x", false)
		gl.wantRefused(err, 409, "cannot be identified exactly", snap)
	})
	t.Run("an edit that pushes the principal past what the gold allows is refused", func(t *testing.T) {
		f := topUpHistory(t)
		l := f.ledgerLoan
		snap := snapshotLoan(t, l.id)
		_, _, err := editLoanTopUp(l.ctx, l.id, f.tops[0], &EditTopUpInput{Amount: f64(500000), CashAmount: f64(500000)}, "x", false)
		l.wantRefused(err, 400, "eligible", snap)
	})
}
