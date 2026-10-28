package controllers

// Payment edits and deletes against the scratch database, checked three ways: (a) entries before the edit are left
// byte-for-byte alone, (b) the result equals a recalculation from day 0 of the same rows AND a twin loan saved from
// scratch with the edited figures, (c) the cash book matches the payment rows. See integration_ledger_helpers_test.go.

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	packetModels "cloudhouse/backend/modules/Packet/models"
)

// The base history (days after opening). Replay order is P1, P2, Discount, P3, P4, P5.
//
//	P1 d35 Interest 100 (cash)
//	P2 d50 Partial 2000 with a typed interest figure of 40 (cash 1500 + UPI 500)
//	   d60 Discount 20 then P3 Partial 1000 (cash)
//	P4 d80 Principal 3000 (cash)
//	P5 d90 Interest 5 (cash)
func baseSteps() []payStep {
	return []payStep{
		{day: 35, typ: models.PaymentTypeInterest, amt: 100, cash: 100},
		{day: 50, typ: models.PaymentTypePartial, amt: 2000, cash: 1500, upi: 500, override: f64(40)},
		{day: 60, typ: models.PaymentTypePartial, amt: 1000, cash: 1000, discount: 20},
		{day: 80, typ: models.PaymentTypePrincipal, amt: 3000, cash: 3000},
		{day: 90, typ: models.PaymentTypeInterest, amt: 5, cash: 5},
	}
}

func TestIntegrationLedger_BaseLoanIsConsistent(t *testing.T) {
	l := newLedgerLoan(t, ledgerAge).build(baseSteps())
	for _, p := range l.payments() {
		t.Logf("   %s", rowKey(p))
	}
	ln := l.loan()
	t.Logf("loan: principal %.2f accrued %.2f paid %.2f status %s; interest rows %v", ln.OutstandingAmount, ln.AccruedInterest, ln.InterestPaid, ln.Status, l.accruals())
	fullReplayHolds(t, "base", l)
	cashMatchesRows(t, "base", l)
	if probeErr := func() error { _, err := l.editPay(l.pids[4], &EditPaymentInput{}, true); return err }(); probeErr != nil {
		t.Fatalf("no-op edit refused on an untouched loan: %v", probeErr)
	}
}

// replayPos is the position (in replay order) of a payment id.
func replayPos(rows []models.LoanPayment, id uint) int {
	for i, r := range rows {
		if r.ID == id {
			return i
		}
	}
	return -1
}

// editCase is one edit of one payment of the base history. twin edits the matching step so a loan saved from scratch
// can be compared with the edited one; it is nil when no such history exists (the same-day discount stays on its date).
type editCase struct {
	name   string
	target int // index into baseSteps (0 = P1 first, 2 = P3 middle, 4 = P5 last, 1 = P2 typed-over middle)
	edit   func(l *ledgerLoan) *EditPaymentInput
	twin   func(s *payStep)
	// check runs after the edit for case-specific assertions
	check func(t *testing.T, l *ledgerLoan, res *EditPaymentResult)
}

func paymentEditCases() []editCase {
	setDay := func(d int) (func(l *ledgerLoan) *EditPaymentInput, func(s *payStep)) {
		return func(l *ledgerLoan) *EditPaymentInput { return &EditPaymentInput{PaidOn: dayTime(l, d)} }, func(s *payStep) { s.day = d }
	}
	var cases []editCase
	add := func(name string, target int, edit func(l *ledgerLoan) *EditPaymentInput, twin func(s *payStep)) {
		cases = append(cases, editCase{name: name, target: target, edit: edit, twin: twin})
	}
	// FIRST (P1)
	add("first/amount 100->80", 0, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{Amount: f64(80), CashAmount: f64(80)}
	}, func(s *payStep) { s.amt, s.cash = 80, 80 })
	e, tw := setDay(32)
	add("first/date earlier d35->d32", 0, e, tw)
	e, tw = setDay(45)
	add("first/date later d35->d45", 0, e, tw)
	add("first/type Interest->Principal", 0, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{Type: str(models.PaymentTypePrincipal)}
	}, func(s *payStep) { s.typ = models.PaymentTypePrincipal })
	add("first/split cash->UPI+bank", 0, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{CashAmount: f64(0), UpiAmount: f64(60), BankTransferAmount: f64(40), BankID: &l.bank}
	}, func(s *payStep) { s.cash, s.upi, s.bank = 0, 60, 40 })
	// MIDDLE typed-over partial (P2) and the partial after a same-day discount (P3)
	add("middle-typed/amount 2000->2500", 1, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{Amount: f64(2500), CashAmount: f64(2000), UpiAmount: f64(500), BankID: &l.bank}
	}, func(s *payStep) { s.amt, s.cash = 2500, 2000 })
	e, tw = setDay(45)
	add("middle-typed/date earlier d50->d45", 1, e, tw)
	e, tw = setDay(58)
	add("middle-typed/date later d50->d58", 1, e, tw)
	add("middle-typed/override 40->55", 1, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{InterestOverride: f64(55)}
	}, func(s *payStep) { s.override = f64(55) })
	add("middle/amount 1000->1200", 2, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{Amount: f64(1200), CashAmount: f64(1200)}
	}, func(s *payStep) { s.amt, s.cash = 1200, 1200 })
	add("middle/type Partial->Principal", 2, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{Type: str(models.PaymentTypePrincipal)}
	}, func(s *payStep) { s.typ = models.PaymentTypePrincipal })
	add("middle/split cash->cash+bank", 2, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{CashAmount: f64(400), BankTransferAmount: f64(600), BankID: &l.bank}
	}, func(s *payStep) { s.cash, s.bank = 400, 600 })
	e, _ = setDay(55) // the discount stays on d60, so it now comes AFTER this partial
	add("middle/date earlier d60->d55 (before its discount)", 2, e, nil)
	e, _ = setDay(70)
	add("middle/date later d60->d70", 2, e, nil)
	e, _ = setDay(85) // jumps over P4 (d80)
	add("middle/date later d60->d85 (past the principal)", 2, e, nil)
	// LAST (P5)
	add("last/amount 5->6.50", 4, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{Amount: f64(6.5), CashAmount: f64(6.5)}
	}, func(s *payStep) { s.amt, s.cash = 6.5, 6.5 })
	e, tw = setDay(95)
	add("last/date later d90->d95", 4, e, tw)
	e, tw = setDay(85)
	add("last/date earlier d90->d85", 4, e, tw)
	e, tw = setDay(70)
	add("last/date earlier d90->d70 (before the principal)", 4, e, tw)
	add("last/type Interest->Principal", 4, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{Type: str(models.PaymentTypePrincipal)}
	}, func(s *payStep) { s.typ = models.PaymentTypePrincipal })
	add("last/type Interest->Partial", 4, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{Type: str(models.PaymentTypePartial), Amount: f64(400), CashAmount: f64(400)}
	}, func(s *payStep) { s.typ, s.amt, s.cash = models.PaymentTypePartial, 400, 400 })
	add("last/split cash->UPI", 4, func(l *ledgerLoan) *EditPaymentInput {
		return &EditPaymentInput{CashAmount: f64(0), UpiAmount: f64(5), BankID: &l.bank}
	}, func(s *payStep) { s.cash, s.upi = 0, 5 })
	return cases
}

func TestIntegrationLedger_PaymentEdits(t *testing.T) {
	integrationCtx(t)
	for _, c := range paymentEditCases() {
		c := c
		t.Run(c.name, func(t *testing.T) {
			l := newLedgerLoan(t, ledgerAge).build(baseSteps())
			target := l.pids[c.target]
			before := l.payments()
			beforeAcc := l.accruals()
			beforeJSON := map[uint]string{}
			for _, p := range before {
				beforeJSON[p.ID] = scalarString(t, `SELECT row_to_json(x)::text FROM loan_payments x WHERE id = ?`, p.ID)
			}
			oldGroup := before[replayPos(before, target)].CashTransactionGroupID
			in := c.edit(l)

			// (d) a preview saves nothing and says what the save will say
			snap := snapshotLoan(t, l.id)
			dry, err := l.editPay(target, in, true)
			if err != nil {
				t.Fatalf("dry run: %v", err)
			}
			if after := snapshotLoan(t, l.id); after != snap {
				t.Fatalf("dry run changed the database")
			}
			res, err := l.editPay(target, in, false)
			if err != nil {
				t.Fatalf("edit: %v", err)
			}
			if dry.After != res.After || dry.Before != res.Before {
				t.Errorf("preview %+v / %+v differs from the saved result %+v / %+v", dry.Before, dry.After, res.Before, res.After)
			}

			// (a) nothing before the edit was touched
			after := l.payments()
			newPos := replayPos(after, target)
			oldPos := replayPos(before, target)
			from := oldPos
			if newPos < from {
				from = newPos
			}
			for i := 0; i < from; i++ {
				if got := scalarString(t, `SELECT row_to_json(x)::text FROM loan_payments x WHERE id = ?`, before[i].ID); got != beforeJSON[before[i].ID] {
					t.Errorf("entry %d before the edit was rewritten:\n  %s\n  %s", i, beforeJSON[before[i].ID], got)
				}
				if before[i].ID != after[i].ID {
					t.Errorf("entry %d before the edit moved", i)
				}
			}
			if from > 0 {
				boundary := before[from-1].PaidOn.Add(12 * time.Hour)
				var kept []accrualRow
				for _, r := range beforeAcc {
					if !r.AccruedOn.After(boundary) {
						kept = append(kept, r)
					}
				}
				var now []accrualRow
				for _, r := range l.accruals() {
					if !r.AccruedOn.After(boundary) {
						now = append(now, r)
					}
				}
				if fmt.Sprint(kept) != fmt.Sprint(now) {
					t.Errorf("interest rows up to %s changed: %v -> %v", boundary.Format("2006-01-02"), kept, now)
				}
			}

			// (b) equals a full recalculation, and a loan saved from scratch with the edited figures
			fullReplayHolds(t, "after edit", l)
			if c.twin != nil {
				steps := baseSteps()
				c.twin(&steps[c.target])
				// saved in date order, ties in the original order
				order := make([]int, len(steps))
				for i := range order {
					order[i] = i
				}
				for i := 1; i < len(order); i++ {
					for j := i; j > 0 && steps[order[j]].day < steps[order[j-1]].day; j-- {
						order[j], order[j-1] = order[j-1], order[j]
					}
				}
				var ordered []payStep
				for _, i := range order {
					ordered = append(ordered, steps[i])
				}
				twin := newLedgerLoan(t, ledgerAge).build(ordered)
				sameLedger(t, "edited vs twin", l, twin)
			}

			// (c) cash lines: the old ones are gone, corrected ones present, group saved on the row
			cashMatchesRows(t, "after edit", l)
			p := after[newPos]
			if p.CashTransactionGroupID == "" || p.CashTransactionGroupID == oldGroup {
				t.Errorf("payment's cash group after the edit is %q (before: %q)", p.CashTransactionGroupID, oldGroup)
			}
			if n := len(groupLines(t, oldGroup)); n != 0 {
				t.Errorf("%d old cash lines left behind", n)
			}
			if !isCashPaymentType(p.Type) {
				t.Errorf("unexpected type %s", p.Type)
			}
			// the other payments' cash lines are the same lines as before
			for _, b := range before {
				if b.ID == target || b.CashTransactionGroupID == "" {
					continue
				}
				if n := len(groupLines(t, b.CashTransactionGroupID)); n == 0 {
					t.Errorf("another payment's cash lines vanished (%s)", rowKey(b))
				}
			}
			if _, err := l.editPay(target, &EditPaymentInput{}, true); err != nil {
				t.Errorf("a further edit of the edited loan is refused: %v", err)
			}
		})
	}
}

func TestIntegrationLedger_PaymentEditRefusals(t *testing.T) {
	integrationCtx(t)
	t.Run("amount more than owed -> 400 with the owed figure, nothing saved", func(t *testing.T) {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		snap := snapshotLoan(t, l.id)
		for _, dry := range []bool{true, false} {
			_, err := l.editPay(l.pids[3], &EditPaymentInput{Amount: f64(9000), CashAmount: f64(9000)}, dry) // principal 3000 -> 9000
			l.wantRefused(err, 400, "no longer fits", snap)
			if !strings.Contains(err.Error(), "the loan owed") || !strings.Contains(err.Error(), "at most") {
				t.Errorf("the refusal does not say what was owed: %v", err)
			}
		}
		_, err := l.editPay(l.pids[4], &EditPaymentInput{Amount: f64(50000), CashAmount: f64(50000)}, false) // interest far above owed
		l.wantRefused(err, 400, "no longer fits", snap)
		t.Logf("refusal text: %v", err)
	})
	t.Run("an earlier edit that starves a later payment is refused", func(t *testing.T) {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		snap := snapshotLoan(t, l.id)
		// P1 becomes a Partial of 9000: principal falls so far that the later Principal of 3000 cannot be applied
		_, err := l.editPay(l.pids[0], &EditPaymentInput{Type: str(models.PaymentTypePartial), Amount: f64(9000), CashAmount: f64(9000)}, false)
		l.wantRefused(err, 400, "no longer fits", snap)
	})
	t.Run("validation errors are 400 and save nothing", func(t *testing.T) {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		snap := snapshotLoan(t, l.id)
		future := time.Now().AddDate(0, 0, 3)
		before := l.opened.AddDate(0, 0, -5)
		for name, c := range map[string]struct {
			in       *EditPaymentInput
			contains string
		}{
			"zero amount":           {&EditPaymentInput{Amount: f64(0)}, "greater than zero"},
			"future date":           {&EditPaymentInput{PaidOn: &future}, "future"},
			"before the loan opened": {&EditPaymentInput{PaidOn: &before}, "before the loan was opened"},
			"split not adding up":   {&EditPaymentInput{Amount: f64(100), CashAmount: f64(30)}, ""},
			"UPI without a bank":    {&EditPaymentInput{CashAmount: f64(0), UpiAmount: f64(100)}, "bank is required"},
			"unknown type":          {&EditPaymentInput{Type: str("Gibberish")}, "type must be"},
		} {
			_, err := l.editPay(l.pids[0], c.in, false)
			if err == nil || codeOf(err) != 400 || !strings.Contains(err.Error(), c.contains) {
				t.Errorf("%s: got %d %v", name, codeOf(err), err)
			}
			if after := snapshotLoan(t, l.id); after != snap {
				t.Errorf("%s: the database changed", name)
			}
		}
	})
	t.Run("unknown payment, other loan's payment and the disbursement row are 404", func(t *testing.T) {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		other := newLedgerLoan(t, ledgerAge).build(baseSteps()[:1])
		snap := snapshotLoan(t, l.id)
		for name, id := range map[string]uint{"missing": 99999999, "another loan's": other.pids[0]} {
			_, err := l.editPay(id, &EditPaymentInput{Amount: f64(10)}, false)
			l.wantRefused(err, 404, "cannot be edited", snap)
			_, _, err = editLoanPayment(l.ctx, l.id, id, nil, "x", false)
			l.wantRefused(err, 404, "cannot be edited", snap)
			_ = name
		}
	})
	t.Run("a Pending Approval / Rejected loan cannot have its ledger edited -> 409", func(t *testing.T) {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		exec(t, `UPDATE loans SET status = 'Pending Approval' WHERE id = ?`, l.id)
		snap := snapshotLoan(t, l.id)
		_, err := l.editPay(l.pids[0], &EditPaymentInput{Amount: f64(10)}, false)
		l.wantRefused(err, 409, "cannot have its ledger edited", snap)
	})
	t.Run("history the recalculation cannot explain is refused 409", func(t *testing.T) {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		exec(t, `UPDATE loan_payments SET principal_applied = principal_applied + 25 WHERE id = ?`, l.pids[3])
		exec(t, `UPDATE loan_payments SET running_balance = running_balance WHERE id = ?`, l.pids[3])
		snap := snapshotLoan(t, l.id)
		_, err := l.editPay(l.pids[4], &EditPaymentInput{Amount: f64(6), CashAmount: f64(6)}, false)
		l.wantRefused(err, 409, "cannot be reproduced", snap)
	})
}

func TestIntegrationLedger_PaymentDeletes(t *testing.T) {
	integrationCtx(t)
	for _, c := range []struct {
		name   string
		target int
	}{{"first", 0}, {"typed-over middle", 1}, {"middle after the discount", 2}, {"principal", 3}, {"last", 4}} {
		c := c
		t.Run(c.name, func(t *testing.T) {
			l := newLedgerLoan(t, ledgerAge).build(baseSteps())
			target := l.pids[c.target]
			before := l.payments()
			oldGroup := before[replayPos(before, target)].CashTransactionGroupID
			beforeJSON := map[uint]string{}
			for _, p := range before {
				beforeJSON[p.ID] = scalarString(t, `SELECT row_to_json(x)::text FROM loan_payments x WHERE id = ?`, p.ID)
			}
			snap := snapshotLoan(t, l.id)
			dry, _, err := editLoanPayment(l.ctx, l.id, target, nil, "x", true)
			if err != nil {
				t.Fatalf("dry run: %v", err)
			}
			if snapshotLoan(t, l.id) != snap {
				t.Fatal("dry-run delete changed the database")
			}
			res, _, err := editLoanPayment(l.ctx, l.id, target, nil, "x", false)
			if err != nil {
				t.Fatalf("delete: %v", err)
			}
			if dry.After != res.After {
				t.Errorf("preview %+v differs from saved %+v", dry.After, res.After)
			}
			pos := replayPos(before, target)
			for i := 0; i < pos; i++ {
				if got := scalarString(t, `SELECT row_to_json(x)::text FROM loan_payments x WHERE id = ?`, before[i].ID); got != beforeJSON[before[i].ID] {
					t.Errorf("entry %d before the deleted one was rewritten", i)
				}
			}
			if n := scalarInt(t, `SELECT count(*) FROM loan_payments WHERE id = ?`, target); n != 0 {
				t.Error("payment still there")
			}
			if n := len(groupLines(t, oldGroup)); n != 0 {
				t.Errorf("%d cash lines of the deleted payment remain", n)
			}
			fullReplayHolds(t, "after delete", l)
			cashMatchesRows(t, "after delete", l)
			// a loan that never had the payment (twin)
			steps := baseSteps()
			steps = append(steps[:c.target], steps[c.target+1:]...)
			if c.target == 2 { // deleting the partial leaves its discount behind: no twin can be saved
				return
			}
			if c.target > 2 || c.target < 2 {
				twin := newLedgerLoan(t, ledgerAge).build(steps)
				sameLedger(t, "deleted vs twin", l, twin)
			}
		})
	}
	t.Run("the discount row can be deleted too", func(t *testing.T) {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		var disc models.LoanPayment
		if err := config.BaseDB.WithContext(l.ctx).Where("loan_id = ? AND type = 'Discount'", l.id).First(&disc).Error; err != nil {
			t.Fatal(err)
		}
		if _, _, err := editLoanPayment(l.ctx, l.id, disc.ID, nil, "x", false); err != nil {
			t.Fatalf("delete discount: %v", err)
		}
		fullReplayHolds(t, "after deleting the discount", l)
		cashMatchesRows(t, "after deleting the discount", l)
		twin := newLedgerLoan(t, ledgerAge).build(func() []payStep { s := baseSteps(); s[2].discount = 0; return s }())
		sameLedger(t, "discount deleted vs twin", l, twin)
	})
	t.Run("deleting a payment that a later full settlement depends on is refused cleanly", func(t *testing.T) {
		l := closedLoan(t, models.StatusClosureRequested)
		snap := snapshotLoan(t, l.id)
		_, _, err := editLoanPayment(l.ctx, l.id, l.pids[0], nil, "x", false)
		l.wantRefused(err, 400, "no longer fits", snap)
		_, _, err = editLoanPayment(l.ctx, l.id, l.pids[1], nil, "x", false)
		l.wantRefused(err, 400, "no longer fits", snap)
	})
}

// A loan whose last payment (today) is a Full Settlement for exactly what is owed, so it is cleared.
func closedLoan(t *testing.T, status string) *ledgerLoan {
	t.Helper()
	l := newLedgerLoan(t, ledgerAge)
	l.pids = append(l.pids, l.pay(payStep{day: 35, typ: models.PaymentTypeInterest, amt: 100, cash: 100}))
	l.pids = append(l.pids, l.pay(payStep{day: 50, typ: models.PaymentTypePrincipal, amt: 4000, cash: 4000}))
	loan, err := GetLoan(l.ctx, l.id, nil)
	if err != nil {
		t.Fatal(err)
	}
	owed := loan.TotalOutstandingBalance
	l.pids = append(l.pids, l.pay(payStep{day: ledgerAge, typ: models.PaymentTypeFullSettlement, amt: owed, cash: owed}))
	got := l.loan()
	if got.Status != models.StatusClosureRequested {
		t.Fatalf("expected Closure Requested, got %s (owed %.2f)", got.Status, owed)
	}
	if status == models.StatusClosed {
		exec(t, `UPDATE loans SET status = 'Closed' WHERE id = ?`, l.id)
	}
	return l
}

// The typed-over interest figure: a Partial saved with less interest than the loan calculated and no override stored.
func TestIntegrationLedger_TypedOverInterestIsInferred(t *testing.T) {
	integrationCtx(t)
	strip := func(t *testing.T) *ledgerLoan {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		exec(t, `UPDATE loan_payments SET interest_override = NULL WHERE loan_id = ?`, l.id)
		return l
	}
	override := func(l *ledgerLoan) *float64 {
		var v *float64
		config.BaseDB.Raw(`SELECT interest_override FROM loan_payments WHERE id = ?`, l.pids[1]).Row().Scan(&v)
		return v
	}
	t.Run("editing the typed-over payment itself stores the override", func(t *testing.T) {
		l := strip(t)
		if _, err := l.editPay(l.pids[1], &EditPaymentInput{Amount: f64(2100), CashAmount: f64(1600), UpiAmount: f64(500), BankID: &l.bank}, false); err != nil {
			t.Fatalf("edit refused: %v", err)
		}
		if v := override(l); v == nil || !closeTo(*v, 40) {
			t.Errorf("override stored as %v, want 40", v)
		}
		fullReplayHolds(t, "typed-over itself", l)
	})
	t.Run("editing an earlier payment stores it too (the recalculation reaches it)", func(t *testing.T) {
		l := strip(t)
		if _, err := l.editPay(l.pids[0], &EditPaymentInput{Amount: f64(80), CashAmount: f64(80)}, false); err != nil {
			t.Fatalf("edit refused: %v", err)
		}
		if v := override(l); v == nil || !closeTo(*v, 40) {
			t.Errorf("override stored as %v, want 40", v)
		}
		fullReplayHolds(t, "typed-over earlier edit", l)
	})
	t.Run("editing a later payment leaves the earlier row alone and succeeds", func(t *testing.T) {
		l := strip(t)
		beforeRow := scalarString(t, `SELECT row_to_json(x)::text FROM loan_payments x WHERE id = ?`, l.pids[1])
		if _, err := l.editPay(l.pids[4], &EditPaymentInput{Amount: f64(7), CashAmount: f64(7)}, false); err != nil {
			t.Fatalf("edit refused: %v", err)
		}
		if got := scalarString(t, `SELECT row_to_json(x)::text FROM loan_payments x WHERE id = ?`, l.pids[1]); got != beforeRow {
			t.Errorf("the earlier row was rewritten")
		}
		// the figures still hold when the history is later recalculated from the start: the first such edit infers it
		if _, err := l.editPay(l.pids[0], &EditPaymentInput{Amount: f64(90), CashAmount: f64(90)}, false); err != nil {
			t.Fatalf("a later edit from the start refused: %v", err)
		}
		fullReplayHolds(t, "typed-over later edits", l)
	})
	t.Run("deleting the first payment of a legacy typed-over history works", func(t *testing.T) {
		l := strip(t)
		if _, _, err := editLoanPayment(l.ctx, l.id, l.pids[0], nil, "x", false); err != nil {
			t.Fatalf("delete refused: %v", err)
		}
		fullReplayHolds(t, "typed-over delete first", l)
	})
}

// Editing a payment of a cleared loan so it no longer clears it reopens the loan and offers the packet back.
func TestIntegrationLedger_ClosedLoanReopensAndOffersPacket(t *testing.T) {
	integrationCtx(t)
	mkPacket := func(t *testing.T, l *ledgerLoan, status, previous string) uint {
		p := packetModels.Packet{Code: fmt.Sprintf("TST-PKT-%d", time.Now().UnixNano()%1_000_000), LoanID: l.id, Status: status}
		if err := config.DB.WithContext(l.ctx).Create(&p).Error; err != nil {
			t.Fatal(err)
		}
		if err := config.DB.WithContext(l.ctx).Create(&packetModels.PacketMovement{PacketID: p.ID, FromStatus: previous, ToStatus: status, Remarks: "test"}).Error; err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	packetStatus := func(id uint) string { return scalarString(t, `SELECT status FROM packets WHERE id = ?`, id) }

	for _, status := range []string{models.StatusClosureRequested, models.StatusClosed} {
		status := status
		t.Run(status+" loan: settlement lowered -> Active, packet offered, reversed on request", func(t *testing.T) {
			l := closedLoan(t, status)
			pid := mkPacket(t, l, "Released", "Locker Stored")
			settlement := l.pids[2]
			owed := l.payments()[2].Amount

			// previewing shows the status change and the offer, and changes nothing
			snap := snapshotLoan(t, l.id)
			dry, err := l.editPay(settlement, &EditPaymentInput{Type: str(models.PaymentTypePartial), Amount: f64(owed - 100), CashAmount: f64(owed - 100)}, true)
			if err != nil {
				t.Fatalf("dry run: %v", err)
			}
			applyPacketReversal(l.ctx, l.id, 0, dry, true, true) // reverse=true but dry: must not move it
			if dry.After.Status != models.StatusActive || dry.Packet == nil || dry.Packet.PreviousStatus != "Locker Stored" || dry.PacketReversed {
				t.Fatalf("preview: after %s packet %+v reversed %v", dry.After.Status, dry.Packet, dry.PacketReversed)
			}
			if snapshotLoan(t, l.id) != snap || packetStatus(pid) != "Released" {
				t.Fatal("the preview changed something")
			}

			// saved but the staff member keeps the packet where it is
			res, err := l.editPay(settlement, &EditPaymentInput{Type: str(models.PaymentTypePartial), Amount: f64(owed - 100), CashAmount: f64(owed - 100)}, false)
			if err != nil {
				t.Fatalf("edit: %v", err)
			}
			applyPacketReversal(l.ctx, l.id, 0, res, false, false)
			if got := l.loan().Status; got != models.StatusActive {
				t.Fatalf("loan status %s, want Active", got)
			}
			if res.Before.Status != status || res.After.Status != models.StatusActive {
				t.Errorf("result status %s -> %s", res.Before.Status, res.After.Status)
			}
			if res.Packet == nil || res.PacketReversed || packetStatus(pid) != "Released" {
				t.Fatalf("offer without reverse_packet moved the packet: %+v reversed %v status %s", res.Packet, res.PacketReversed, packetStatus(pid))
			}
			fullReplayHolds(t, "reopened", l)
			cashMatchesRows(t, "reopened", l)

			// reverse_packet=true on a second reopening edit is accepted; here the same packet is moved back for real
			res2, err := l.editPay(settlement, &EditPaymentInput{Amount: f64(owed - 90), CashAmount: f64(owed - 90)}, false)
			if err != nil {
				t.Fatalf("second edit: %v", err)
			}
			applyPacketReversal(l.ctx, l.id, 0, res2, true, false)
			if !res2.PacketReversed || res2.PacketError != "" || packetStatus(pid) != "Locker Stored" {
				t.Fatalf("reverse_packet=true did not move the packet back: reversed %v err %q status %s", res2.PacketReversed, res2.PacketError, packetStatus(pid))
			}
			if n := scalarInt(t, `SELECT count(*) FROM packet_movements WHERE packet_id = ? AND from_status = 'Released' AND to_status = 'Locker Stored'`, pid); n != 1 {
				t.Errorf("%d reversal movements recorded, want 1", n)
			}
		})
	}
	t.Run("an edit that keeps the loan cleared offers no packet move", func(t *testing.T) {
		l := closedLoan(t, models.StatusClosed)
		pid := mkPacket(t, l, "Released", "Locker Stored")
		// only the payment split changes
		res, err := l.editPay(l.pids[2], &EditPaymentInput{CashAmount: f64(0), UpiAmount: f64(l.payments()[2].Amount), BankID: &l.bank}, false)
		if err != nil {
			t.Fatalf("edit: %v", err)
		}
		applyPacketReversal(l.ctx, l.id, 0, res, true, false)
		if res.Packet != nil || res.PacketReversed || packetStatus(pid) != "Released" || l.loan().Status != models.StatusClosed {
			t.Errorf("packet %+v reversed %v status %s loan %s", res.Packet, res.PacketReversed, packetStatus(pid), l.loan().Status)
		}
		cashMatchesRows(t, "closed split edit", l)
	})
	t.Run("an earlier edit that breaks the exact settlement is refused and saves nothing", func(t *testing.T) {
		l := closedLoan(t, models.StatusClosed)
		mkPacket(t, l, "Released", "Locker Stored")
		snap := snapshotLoan(t, l.id)
		_, err := l.editPay(l.pids[1], &EditPaymentInput{Amount: f64(3000), CashAmount: f64(3000)}, false)
		l.wantRefused(err, 400, "no longer fits", snap)
	})
}

// A payment saved before cash groups were kept (no group on the row) must not be "corrected" by adding a second set of
// cash lines beside the first: the edit is either refused or replaces the original lines.
func TestIntegrationLedger_PaymentWithoutCashGroup(t *testing.T) {
	integrationCtx(t)
	l := newLedgerLoan(t, ledgerAge).build(baseSteps())
	exec(t, `UPDATE loan_payments SET cash_transaction_group_id = NULL WHERE id = ?`, l.pids[0])
	collections := func() float64 {
		return scalarFloat(t, `SELECT COALESCE(sum(amount),0) FROM cash_movements WHERE source = 'Collection' AND purpose LIKE '% — ' || ? AND type = 'in'`, l.number)
	}
	before := collections()
	if _, err := l.editPay(l.pids[0], &EditPaymentInput{Amount: f64(80), CashAmount: f64(80)}, false); err != nil {
		t.Fatalf("a payment whose lines can be identified exactly should be editable: %v", err)
	}
	// the edit went through: the loan's collection total must equal what the rows say (100 became 80)
	var want float64
	for _, p := range l.payments() {
		if isCashPaymentType(p.Type) {
			want += p.Amount
		}
	}
	if got := collections(); !closeTo(got, want) {
		t.Errorf("cash book holds %.2f of collections for the loan, payment rows say %.2f (it held %.2f before the edit): the original lines were left beside the corrected ones", got, want, before)
	}
}

func TestIntegrationLedger_PaymentWithoutCashGroupAndLines(t *testing.T) {
	integrationCtx(t)
	for _, del := range []bool{false, true} {
		l := newLedgerLoan(t, ledgerAge).build(baseSteps())
		group := l.payments()[0].CashTransactionGroupID
		exec(t, `UPDATE loan_payments SET cash_transaction_group_id = NULL WHERE id = ?`, l.pids[0])
		exec(t, `UPDATE cash_movements SET amount = amount + 1 WHERE transaction_group_id = ?`, group) // can no longer be matched exactly
		snap := snapshotLoan(t, l.id)
		var err error
		if del {
			_, _, err = editLoanPayment(l.ctx, l.id, l.pids[0], nil, "x", false)
		} else {
			_, err = l.editPay(l.pids[0], &EditPaymentInput{Amount: f64(80), CashAmount: f64(80)}, false)
		}
		l.wantRefused(err, 409, "cannot be identified exactly", snap)
	}
}
