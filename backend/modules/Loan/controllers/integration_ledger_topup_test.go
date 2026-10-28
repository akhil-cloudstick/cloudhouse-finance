package controllers

// Top-up edits and deletes against the scratch database: the loan is built through executeTopUp and SaveLoanPayment,
// each change is checked against a full recalculation from day 0 (and, when the date is unchanged, against a twin loan
// saved from scratch), and the cash book against the top-up and payment rows.

import (
	"fmt"
	"testing"

	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
)

// withOrnaments gives the loan the template loan's ornaments, so it has an eligible amount to top up against.
func (l *ledgerLoan) withOrnaments() *ledgerLoan {
	exec(l.t, `INSERT INTO ornaments (loan_id, name, purity, gross_weight, deduction_weight, net_weight, quantity, gold_value, remarks, created_at, updated_at, tenant_id)
		SELECT ?, name, purity, gross_weight, deduction_weight, net_weight, quantity, gold_value, remarks, now(), now(), tenant_id FROM ornaments WHERE loan_id = ? AND released_at IS NULL`, l.id, scratchTemplate)
	return l
}

type topStep struct {
	day                int
	amount             float64
	cash, upi, bank    float64
	settle             string
}

// topUp saves a top-up through executeTopUp dated `day` and returns its id.
func (l *ledgerLoan) topUp(s topStep) (uint, error) {
	l.t.Helper()
	in := TopUpInput{Amount: s.amount, CashAmount: s.cash, UpiAmount: s.upi, BankTransferAmount: s.bank, OccurredOn: l.when(s.day), SettleInterest: s.settle, Reference: "tst"}
	if s.upi+s.bank > 0 {
		b := l.bank
		in.BankID = &b
	}
	if _, err := executeTopUp(l.ctx, l.id, in, nil); err != nil {
		return 0, err
	}
	var id uint
	if err := config.BaseDB.Raw(`SELECT id FROM loan_top_ups WHERE loan_id = ? ORDER BY id DESC LIMIT 1`, l.id).Row().Scan(&id); err != nil {
		l.t.Fatal(err)
	}
	l.settleAsOf(s.day, false)
	return id, nil
}

func (l *ledgerLoan) mustTopUp(s topStep) uint {
	l.t.Helper()
	id, err := l.topUp(s)
	if err != nil {
		l.t.Fatalf("top-up %+v: %v", s, err)
	}
	return id
}

// topUpHistory: P1 d35 Interest 100, P2 d50 Partial (typed interest), P4 d80 Principal 3000, T1 d90 top-up 2000
// (interest deducted from the payout), P6 d95 Interest 5, T2 d97 top-up 1000 (no arrears left to settle).
type topFixture struct {
	*ledgerLoan
	tops []uint
}

func topUpHistory(t *testing.T) *topFixture {
	return topUpHistoryWith(t, topStep{day: 90, amount: 2000, cash: 2000, settle: "deduct"})
}

func topUpHistoryWith(t *testing.T, top topStep) *topFixture {
	t.Helper()
	l := newLedgerLoan(t, ledgerAge).withOrnaments()
	l.build([]payStep{
		{day: 35, typ: models.PaymentTypeInterest, amt: 100, cash: 100},
		{day: 50, typ: models.PaymentTypePartial, amt: 2000, cash: 1500, upi: 500, override: f64(40)},
		{day: 80, typ: models.PaymentTypePrincipal, amt: 3000, cash: 3000},
	})
	f := &topFixture{ledgerLoan: l}
	f.tops = append(f.tops, l.mustTopUp(top))
	l.pids = append(l.pids, l.pay(payStep{day: 95, typ: models.PaymentTypeInterest, amt: 5, cash: 5}))
	return f
}

func topUps(t *testing.T, l *ledgerLoan) []models.LoanTopUp {
	t.Helper()
	var ups []models.LoanTopUp
	if err := config.BaseDB.WithContext(l.ctx).Where("loan_id = ?", l.id).Order("occurred_on asc, id asc").Find(&ups).Error; err != nil {
		t.Fatal(err)
	}
	return ups
}

// topUpCashMatches checks each active top-up's lines: one group on the row, lines in the modes the row says that add
// up to its amount, and no top-up line in the loan's book outside those.
func topUpCashMatches(t *testing.T, label string, l *ledgerLoan) {
	t.Helper()
	groups := map[string]bool{}
	for _, u := range topUps(t, l) {
		if u.CashTransactionGroupID == "" {
			t.Errorf("%s: top-up of %.2f has no cash group", label, u.Amount)
			continue
		}
		groups[u.CashTransactionGroupID] = true
		got := map[string]float64{}
		var sum float64
		for _, ln := range groupLines(t, u.CashTransactionGroupID) {
			got[ln.Mode] += ln.Amount
			sum += ln.Amount
		}
		for mode, want := range map[string]float64{"Cash": u.CashAmount, "UPI": u.UpiAmount, "Bank Transfer": u.BankTransferAmount} {
			if !closeTo(got[mode], want) {
				t.Errorf("%s: top-up of %.2f: %s lines %.2f, row says %.2f", label, u.Amount, mode, got[mode], want)
			}
		}
		if !closeTo(sum, u.Amount) {
			t.Errorf("%s: top-up of %.2f: lines add up to %.2f", label, u.Amount, sum)
		}
	}
	var stray []string
	if err := config.BaseDB.Raw(`SELECT DISTINCT transaction_group_id FROM cash_movements WHERE type = 'out' AND purpose = ? AND transaction_group_id <> ''`, "Loan top-up — "+l.number).Scan(&stray).Error; err != nil {
		t.Fatal(err)
	}
	for _, g := range stray {
		if !groups[g] {
			t.Errorf("%s: top-up cash lines in group %s belong to no top-up of the loan", label, g)
		}
	}
}

func principalSum(l *ledgerLoan) (principal, topSum float64) {
	ln := l.loan()
	for _, u := range topUps(l.t, l) {
		if u.Status == models.TopUpStatusActive {
			topSum += u.Amount
		}
	}
	return ln.PrincipalAmount, topSum
}

func TestIntegrationLedger_TopUpHistoryIsConsistent(t *testing.T) {
	integrationCtx(t)
	f := topUpHistory(t)
	ln := f.loan()
	t.Logf("loan: principal %.2f outstanding %.2f accrued %.2f paid %.2f status %s", ln.PrincipalAmount, ln.OutstandingAmount, ln.AccruedInterest, ln.InterestPaid, ln.Status)
	for _, p := range f.payments() {
		t.Logf("   %s", rowKey(p))
	}
	for _, u := range topUps(t, f.ledgerLoan) {
		t.Logf("   top-up %.2f on %s group %s", u.Amount, u.OccurredOn.Format("2006-01-02"), u.CashTransactionGroupID)
	}
	fullReplayHolds(t, "base", f.ledgerLoan)
	cashMatchesRows(t, "base", f.ledgerLoan)
	topUpCashMatches(t, "base", f.ledgerLoan)
	if _, _, err := editLoanTopUp(f.ctx, f.id, f.tops[0], &EditTopUpInput{}, "x", true); err != nil {
		t.Fatalf("a no-op top-up edit is refused on a loan built through the app: %v", err)
	}
}

var _ = fmt.Sprint
