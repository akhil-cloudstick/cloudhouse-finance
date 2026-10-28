package controllers

// Investment ledger edits and deletes against the scratch database. Investments are built with SaveInvestment,
// addCash, withdrawInvestment, SavePayoutPayment and SaveInterestPayments and removed afterwards:
//
//	DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations go test ./modules/Investment/controllers/ -run Integration -v
//
// Refuses to run on any database not named ambikagold_scratch.

import (
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/labstack/echo/v4"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	cashModels "cloudhouse/backend/modules/Cash/models"
	"cloudhouse/backend/modules/Investment/models"
)

const (
	itTenant   = uint(5)
	itBranch   = uint(6)
	itCustomer = uint(190)
)

var itOnce sync.Once

func itCtx(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("DB_NAME") != "ambikagold_scratch" {
		t.Skip("integration test: set DB_NAME=ambikagold_scratch")
	}
	itOnce.Do(func() { config.InitDB() })
	return config.WithTenant(context.Background(), itTenant)
}

func statusOf(err error) int {
	var se common.StatusedError
	if errors.As(err, &se) {
		return se.Status()
	}
	return 0
}

func expectStatus(t *testing.T, what string, err error, want int) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected HTTP %d, got no error", what, want)
	}
	if got := statusOf(err); got != want {
		t.Fatalf("%s: expected HTTP %d, got %d (%v)", what, want, got, err)
	}
}

func f(v float64) *float64 { return &v }

// at is n days ago at noon, so entries built by the app and by an edit land on identical instants.
func at(n int) time.Time {
	y, m, d := time.Now().Date()
	return time.Date(y, m, d-n, 12, 0, 0, 0, time.Local)
}

func itBank(t *testing.T) uint {
	t.Helper()
	var id uint
	if err := config.BaseDB.Raw(`INSERT INTO banks (name, tenant_id, branch_id, created_at, updated_at) VALUES ('IT Bank', ?, ?, now(), now()) RETURNING id`, itTenant, itBranch).Row().Scan(&id); err != nil {
		t.Fatal(err)
	}
	config.BaseDB.Exec(`INSERT INTO cash_movements (type, source, purpose, mode, amount, status, occurred_on, created_at, branch_id, tenant_id, bank_id, is_manual) VALUES ('in', 'Other', 'IT seed', 'Bank Transfer', 1000000, 'Approved', now() - interval '300 days', now(), ?, ?, ?, false)`, itBranch, itTenant, id)
	t.Cleanup(func() {
		config.BaseDB.Exec(`DELETE FROM cash_movements WHERE bank_id = ?`, id)
		config.BaseDB.Exec(`DELETE FROM banks WHERE id = ?`, id)
	})
	return id
}

func itPlan(t *testing.T, ctx context.Context, engine, freq string, tenure int) *models.InvestmentPlan {
	t.Helper()
	p, err := SaveInvestmentPlan(ctx, PlanInput{Name: "IT " + engine, InterestRateType: models.InterestRateTypeSimple, InterestRatePercent: 12,
		PayoutFrequency: freq, TenureMonths: tenure, MinPrincipal: 1, IsActive: true, Engine: engine})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	t.Cleanup(func() { config.BaseDB.Exec(`DELETE FROM investment_plans WHERE id = ?`, p.ID) })
	return p
}

func itPurge(id uint, number string) {
	config.BaseDB.Exec(`DELETE FROM cash_movements WHERE source_id = ? AND source_type LIKE 'investment%'`, id)
	config.BaseDB.Exec(`DELETE FROM cash_movements WHERE purpose LIKE ?`, "%"+number)
	config.BaseDB.Exec(`DELETE FROM investment_transactions WHERE investment_id = ?`, id)
	config.BaseDB.Exec(`DELETE FROM investment_payouts WHERE investment_id = ?`, id)
	config.BaseDB.Exec(`DELETE FROM audit_log_entries WHERE entity_type = 'investment' AND entity_id = ?`, id)
	config.BaseDB.Exec(`DELETE FROM investments WHERE id = ?`, id)
}

func itNew(t *testing.T, ctx context.Context, plan *models.InvestmentPlan, amount float64, start time.Time, bank *uint, upi float64) *models.Investment {
	t.Helper()
	in := CreateInput{BranchID: itBranch, CustomerID: itCustomer, PlanID: plan.ID, PrincipalAmount: amount, StartDate: start, CashAmount: amount - upi, UpiAmount: upi, BankID: bank}
	inv, err := SaveInvestment(ctx, in)
	if err != nil {
		t.Fatalf("create investment: %v", err)
	}
	t.Cleanup(func() { itPurge(inv.ID, inv.InvestmentNumber) })
	return inv
}

func itInv(t *testing.T, ctx context.Context, id uint) *models.Investment {
	t.Helper()
	inv, err := findInvestmentByID(ctx, id, nil)
	if err != nil {
		t.Fatal(err)
	}
	return inv
}

func itTxs(t *testing.T, ctx context.Context, id uint) []models.InvestmentTransaction {
	t.Helper()
	txs, err := loadTransactions(ctx, config.BaseDB, id)
	if err != nil {
		t.Fatal(err)
	}
	return txs
}

func itPayouts(t *testing.T, ctx context.Context, id uint) []models.InvestmentPayout {
	t.Helper()
	var ps []models.InvestmentPayout
	if err := config.BaseDB.WithContext(ctx).Where("investment_id = ?", id).Order("sequence_no asc").Find(&ps).Error; err != nil {
		t.Fatal(err)
	}
	return ps
}

// itCashNet is the signed net (in positive) and count of the investment's cash lines.
func itCashNet(id uint) (n int, net float64) {
	config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(CASE WHEN type='in' THEN amount ELSE -amount END),0) FROM cash_movements WHERE source_id = ? AND source_type LIKE 'investment%'`, id).Row().Scan(&n, &net)
	return
}

func itFingerprint(t *testing.T, ctx context.Context, id uint) string {
	t.Helper()
	inv := itInv(t, ctx, id)
	s := fmt.Sprintf("inv[%v %v %v %v %v %s %s %s %v] ", inv.PrincipalAmount, inv.OutstandingPrincipal, inv.AccruedInterest, inv.InterestWithdrawn, inv.TotalInterestPaid, inv.Status, inv.StartDate.Format(time.RFC3339), inv.MaturityDate.Format("2006-01-02"), inv.LastAccrualDate.Format("2006-01-02"))
	for _, x := range itTxs(t, ctx, id) {
		s += fmt.Sprintf("tx[%d %s %v %v %v %v %v %v %v %v %v %s %v] ", x.ID, x.Type, x.Amount, x.PrincipalAmount, x.InterestAmount, x.PrincipalBefore, x.PrincipalAfter, x.InterestBefore, x.InterestAfter, x.CashAmount, x.UpiAmount, x.OccurredOn.Format(time.RFC3339), ptr(x.CashMovementID))
	}
	for _, p := range itPayouts(t, ctx, id) {
		s += fmt.Sprintf("po[%d %d %v %s %v %v %v %v] ", p.ID, p.SequenceNo, p.Amount, p.Status, p.CashAmount, p.UpiAmount, ptr(p.CashMovementID), p.DueDate.Format("2006-01-02"))
	}
	var rows []cashModels.CashMovement
	config.BaseDB.Raw(`SELECT * FROM cash_movements WHERE source_id = ? AND source_type LIKE 'investment%' ORDER BY id`, id).Scan(&rows)
	for _, r := range rows {
		s += fmt.Sprintf("cm[%d %s %v %s %s %v] ", r.ID, r.Type, r.Amount, r.TransactionGroupID, r.Mode, r.OccurredOn.Format(time.RFC3339))
	}
	return s
}

func itSame(t *testing.T, ctx context.Context, id uint, before string) {
	t.Helper()
	if after := itFingerprint(t, ctx, id); after != before {
		t.Fatalf("a refused edit changed data:\n%s\n%s", before, after)
	}
}

func near(a, b float64) bool { return math.Abs(a-b) <= 0.02 }

// liveStep is one add-cash / withdrawal made through the real functions.
type liveStep struct {
	deposit   bool
	amount    float64 // deposit amount, or principal part of a withdrawal
	interest  float64 // withdrawal interest part
	daysAgo   int
	upi       float64
	bankID    *uint
	reference string
}

func itLive(t *testing.T, ctx context.Context, plan *models.InvestmentPlan, opening float64, startDaysAgo int, steps []liveStep) *models.Investment {
	return itLiveSplit(t, ctx, plan, opening, startDaysAgo, nil, 0, steps)
}

func itLiveSplit(t *testing.T, ctx context.Context, plan *models.InvestmentPlan, opening float64, startDaysAgo int, bank *uint, upi float64, steps []liveStep) *models.Investment {
	t.Helper()
	inv := itNew(t, ctx, plan, opening, at(startDaysAgo), bank, upi)
	for i, s := range steps {
		var err error
		if s.deposit {
			_, err = addCash(ctx, inv.ID, nil, AddCashInput{Amount: s.amount, OccurredOn: at(s.daysAgo), CashAmount: s.amount - s.upi, UpiAmount: s.upi, BankID: s.bankID, Reference: s.reference})
		} else {
			total := s.amount + s.interest
			_, err = withdrawInvestment(ctx, inv.ID, nil, WithdrawInput{PrincipalAmount: s.amount, InterestAmount: s.interest, OccurredOn: at(s.daysAgo), CashAmount: total - s.upi, UpiAmount: s.upi, BankID: s.bankID, Reference: s.reference})
		}
		if err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
		// The real flows end by opening the investment as of today (which moves the accrual anchor to today and
		// would block the next back-dated entry); put the anchor back to where the entry itself left it.
		if txs := itTxs(t, ctx, inv.ID); len(txs) > 0 {
			last := txs[len(txs)-1]
			config.BaseDB.Exec(`UPDATE investments SET accrued_interest = ? + interest_withdrawn, last_accrual_date = ? WHERE id = ?`, last.InterestAfter, last.OccurredOn, inv.ID)
		}
	}
	return inv
}

// compareLive asserts two live investments hold identical figures, row by row.
func compareLive(t *testing.T, ctx context.Context, got, want uint) {
	t.Helper()
	g, w := itInv(t, ctx, got), itInv(t, ctx, want)
	// open both as of today, as viewing does
	for _, inv := range []*models.Investment{g, w} {
		if err := settleAndSave(ctx, config.BaseDB, inv, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	chk := func(name string, a, b float64) {
		if !near(a, b) {
			t.Fatalf("%s: edited %v, rebuilt-from-scratch %v", name, a, b)
		}
	}
	chk("invested", g.PrincipalAmount, w.PrincipalAmount)
	chk("outstanding principal", g.OutstandingPrincipal, w.OutstandingPrincipal)
	chk("accrued interest", g.AccruedInterest, w.AccruedInterest)
	chk("interest withdrawn", g.InterestWithdrawn, w.InterestWithdrawn)
	if g.StartDate.Format("2006-01-02") != w.StartDate.Format("2006-01-02") || g.MaturityDate.Format("2006-01-02") != w.MaturityDate.Format("2006-01-02") {
		t.Fatalf("dates: %v/%v vs %v/%v", g.StartDate, g.MaturityDate, w.StartDate, w.MaturityDate)
	}
	gt, wt := itTxs(t, ctx, got), itTxs(t, ctx, want)
	if len(gt) != len(wt) {
		t.Fatalf("transaction count %d vs %d", len(gt), len(wt))
	}
	for i := range gt {
		a, b := gt[i], wt[i]
		if a.Type != b.Type || !sameDay(a.OccurredOn, b.OccurredOn) {
			t.Fatalf("row %d: %s %v vs %s %v", i, a.Type, a.OccurredOn, b.Type, b.OccurredOn)
		}
		for name, p := range map[string][2]float64{"amount": {a.Amount, b.Amount}, "principal": {a.PrincipalAmount, b.PrincipalAmount}, "interest": {a.InterestAmount, b.InterestAmount},
			"p-before": {a.PrincipalBefore, b.PrincipalBefore}, "p-after": {a.PrincipalAfter, b.PrincipalAfter}, "i-before": {a.InterestBefore, b.InterestBefore}, "i-after": {a.InterestAfter, b.InterestAfter},
			"cash": {a.CashAmount, b.CashAmount}, "upi": {a.UpiAmount, b.UpiAmount}} {
			if !near(p[0], p[1]) {
				t.Fatalf("row %d (%s) %s: edited %v, rebuilt %v", i, a.Type, name, p[0], p[1])
			}
		}
	}
	gn, gnet := itCashNet(got)
	wn, wnet := itCashNet(want)
	if gn != wn || !near(gnet, wnet) {
		t.Fatalf("cash lines: edited %d lines net %v, rebuilt %d lines net %v", gn, gnet, wn, wnet)
	}
}

// liveConsistent asserts the investment's own saved chain and cash lines agree with each other.
func liveConsistent(t *testing.T, ctx context.Context, id uint) {
	t.Helper()
	inv := itInv(t, ctx, id)
	txs := itTxs(t, ctx, id)
	opening := inv.PrincipalAmount
	if len(txs) > 0 {
		opening = txs[0].PrincipalBefore
	}
	if d := checkPrincipalChain(opening, txs, inv); d != "" {
		t.Fatalf("principal chain broken: %s", d)
	}
	for _, x := range txs {
		if x.CashMovementID == nil {
			t.Fatalf("tx %d has no cash movement id", x.ID)
		}
		var m cashModels.CashMovement
		if err := config.BaseDB.WithContext(ctx).First(&m, *x.CashMovementID).Error; err != nil {
			t.Fatalf("tx %d points at missing cash line %d", x.ID, *x.CashMovementID)
		}
		if m.SourceID == nil || *m.SourceID != id {
			t.Fatalf("tx %d cash line not of this investment", x.ID)
		}
		var sum float64
		config.BaseDB.Raw(`SELECT COALESCE(sum(amount),0) FROM cash_movements WHERE transaction_group_id = ? AND source_id = ?`, m.TransactionGroupID, id).Row().Scan(&sum)
		if !near(sum, x.Amount) {
			t.Fatalf("tx %d (%s) cash group sums %v, entry is %v", x.ID, x.Type, sum, x.Amount)
		}
	}
	// every cash line of the investment: opening + deposits in, withdrawals out
	want := opening
	for _, x := range txs {
		if x.Type == "Deposit" {
			want += x.Amount
		} else {
			want -= x.Amount
		}
	}
	if _, net := itCashNet(id); !near(net, want) {
		t.Fatalf("cash net %v, ledger says %v (stray or missing lines)", net, want)
	}
}

func itPlanLive(t *testing.T, ctx context.Context) *models.InvestmentPlan {
	return itPlan(t, ctx, models.EngineLive, models.PayoutFrequencyMonthly, 12)
}

// baseSteps: opening 10000 at -100d; +5000 at -60; +2000 at -40; withdraw 3000 principal + 100 interest at -20; +1000 at -5.
func baseSteps() []liveStep {
	return []liveStep{
		{deposit: true, amount: 5000, daysAgo: 60},
		{deposit: true, amount: 2000, daysAgo: 40},
		{amount: 3000, interest: 100, daysAgo: 20},
		{deposit: true, amount: 1000, daysAgo: 5},
	}
}

func TestIntegration_Inv_LiveEditEntries(t *testing.T) {
	ctx := itCtx(t)
	plan := itPlanLive(t, ctx)
	bank := itBank(t)
	inv := itLive(t, ctx, plan, 10000, 100, baseSteps())
	liveConsistent(t, ctx, inv.ID)
	txs := itTxs(t, ctx, inv.ID)
	if len(txs) != 4 {
		t.Fatalf("setup: %d txs", len(txs))
	}
	d1, d2, w, d3 := txs[0].ID, txs[1].ID, txs[2].ID, txs[3].ID
	entry := func(id uint) string { return fmt.Sprintf("tx-%d", id) }

	// middle deposit: amount, date and split changed
	d38 := at(38)
	out, err := editLedgerEntry(ctx, inv.ID, nil, entry(d2), &EditEntryInput{Amount: f(2500), OccurredOn: &d38, CashAmount: f(1500), UpiAmount: f(1000), BankID: &bank, Reference: nil}, "", false)
	if err != nil {
		t.Fatalf("edit middle deposit: %v", err)
	}
	if out.Result.After.Invested != out.Result.Before.Invested+500 {
		t.Fatalf("summary: %+v", out.Result)
	}
	liveConsistent(t, ctx, inv.ID)
	ref := itLive(t, ctx, plan, 10000, 100, []liveStep{
		{deposit: true, amount: 5000, daysAgo: 60}, {deposit: true, amount: 2500, daysAgo: 38, upi: 1000, bankID: &bank},
		{amount: 3000, interest: 100, daysAgo: 20}, {deposit: true, amount: 1000, daysAgo: 5}})
	compareLive(t, ctx, inv.ID, ref.ID)
	var bankLines int
	config.BaseDB.Raw(`SELECT count(*) FROM cash_movements WHERE source_id = ? AND source_type = 'investment_deposit' AND bank_id = ?`, inv.ID, bank).Row().Scan(&bankLines)
	if bankLines != 1 {
		t.Fatalf("expected one bank line, got %d", bankLines)
	}

	// first deposit: amount and date
	d62 := at(62)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, entry(d1), &EditEntryInput{Amount: f(4000), CashAmount: f(4000), OccurredOn: &d62}, "", false); err != nil {
		t.Fatalf("edit first deposit: %v", err)
	}
	liveConsistent(t, ctx, inv.ID)
	ref2 := itLive(t, ctx, plan, 10000, 100, []liveStep{
		{deposit: true, amount: 4000, daysAgo: 62}, {deposit: true, amount: 2500, daysAgo: 38, upi: 1000, bankID: &bank},
		{amount: 3000, interest: 100, daysAgo: 20}, {deposit: true, amount: 1000, daysAgo: 5}})
	compareLive(t, ctx, inv.ID, ref2.ID)

	// withdrawal in the middle: principal and interest parts
	if _, err := editLedgerEntry(ctx, inv.ID, nil, entry(w), &EditEntryInput{PrincipalAmount: f(2000), InterestAmount: f(150), CashAmount: f(2150)}, "", false); err != nil {
		t.Fatalf("edit withdrawal: %v", err)
	}
	liveConsistent(t, ctx, inv.ID)
	ref3 := itLive(t, ctx, plan, 10000, 100, []liveStep{
		{deposit: true, amount: 4000, daysAgo: 62}, {deposit: true, amount: 2500, daysAgo: 38, upi: 1000, bankID: &bank},
		{amount: 2000, interest: 150, daysAgo: 20}, {deposit: true, amount: 1000, daysAgo: 5}})
	compareLive(t, ctx, inv.ID, ref3.ID)

	// last deposit
	if _, err := editLedgerEntry(ctx, inv.ID, nil, entry(d3), &EditEntryInput{Amount: f(1500), CashAmount: f(1500)}, "", false); err != nil {
		t.Fatalf("edit last deposit: %v", err)
	}
	liveConsistent(t, ctx, inv.ID)
	ref4 := itLive(t, ctx, plan, 10000, 100, []liveStep{
		{deposit: true, amount: 4000, daysAgo: 62}, {deposit: true, amount: 2500, daysAgo: 38, upi: 1000, bankID: &bank},
		{amount: 2000, interest: 150, daysAgo: 20}, {deposit: true, amount: 1500, daysAgo: 5}})
	compareLive(t, ctx, inv.ID, ref4.ID)

	// opening deposit: amount, date, split
	d105 := at(105)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("open-%d", inv.ID), &EditEntryInput{Amount: f(12000), OccurredOn: &d105, CashAmount: f(9000), UpiAmount: f(3000), BankID: &bank}, "", false); err != nil {
		t.Fatalf("edit opening: %v", err)
	}
	liveConsistent(t, ctx, inv.ID)
	ref5 := itLiveSplit(t, ctx, plan, 12000, 105, &bank, 3000, []liveStep{
		{deposit: true, amount: 4000, daysAgo: 62}, {deposit: true, amount: 2500, daysAgo: 38, upi: 1000, bankID: &bank},
		{amount: 2000, interest: 150, daysAgo: 20}, {deposit: true, amount: 1500, daysAgo: 5}})
	compareLive(t, ctx, inv.ID, ref5.ID)
	// the opening cash lines carry the new split and date
	var upiOpen float64
	config.BaseDB.Raw(`SELECT COALESCE(sum(amount),0) FROM cash_movements WHERE source_id = ? AND purpose = ? AND mode <> 'Cash' AND occurred_on::date = ?::date`, inv.ID, "Investment deposit — "+inv.InvestmentNumber, d105).Row().Scan(&upiOpen)
	if upiOpen != 3000 {
		t.Fatalf("opening non-cash lines on the new date: %v", upiOpen)
	}
}

func TestIntegration_Inv_LiveDeleteEntries(t *testing.T) {
	ctx := itCtx(t)
	plan := itPlanLive(t, ctx)
	inv := itLive(t, ctx, plan, 10000, 100, baseSteps())
	liveConsistent(t, ctx, inv.ID)
	txs := itTxs(t, ctx, inv.ID)
	entry := func(id uint) string { return fmt.Sprintf("tx-%d", id) }

	// delete the first deposit
	if _, err := editLedgerEntry(ctx, inv.ID, nil, entry(txs[0].ID), nil, "r", false); err != nil {
		t.Fatalf("delete first: %v", err)
	}
	liveConsistent(t, ctx, inv.ID)
	ref := itLive(t, ctx, plan, 10000, 100, []liveStep{{deposit: true, amount: 2000, daysAgo: 40}, {amount: 3000, interest: 100, daysAgo: 20}, {deposit: true, amount: 1000, daysAgo: 5}})
	compareLive(t, ctx, inv.ID, ref.ID)
	// delete the withdrawal (middle)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, entry(txs[2].ID), nil, "", false); err != nil {
		t.Fatalf("delete middle withdrawal: %v", err)
	}
	liveConsistent(t, ctx, inv.ID)
	ref2 := itLive(t, ctx, plan, 10000, 100, []liveStep{{deposit: true, amount: 2000, daysAgo: 40}, {deposit: true, amount: 1000, daysAgo: 5}})
	compareLive(t, ctx, inv.ID, ref2.ID)
	// delete the last
	if _, err := editLedgerEntry(ctx, inv.ID, nil, entry(txs[3].ID), nil, "", false); err != nil {
		t.Fatalf("delete last: %v", err)
	}
	liveConsistent(t, ctx, inv.ID)
	ref3 := itLive(t, ctx, plan, 10000, 100, []liveStep{{deposit: true, amount: 2000, daysAgo: 40}})
	compareLive(t, ctx, inv.ID, ref3.ID)
	// and the only remaining one
	if _, err := editLedgerEntry(ctx, inv.ID, nil, entry(txs[1].ID), nil, "", false); err != nil {
		t.Fatalf("delete only: %v", err)
	}
	liveConsistent(t, ctx, inv.ID)
	ref4 := itLive(t, ctx, plan, 10000, 100, nil)
	compareLive(t, ctx, inv.ID, ref4.ID)
	if n, net := itCashNet(inv.ID); n != 1 || net != 10000 {
		t.Fatalf("only the opening deposit should remain: %d lines net %v", n, net)
	}
}

func TestIntegration_Inv_DryRunChangesNothing(t *testing.T) {
	ctx := itCtx(t)
	plan := itPlanLive(t, ctx)
	inv := itLive(t, ctx, plan, 10000, 100, baseSteps())
	txs := itTxs(t, ctx, inv.ID)
	before := itFingerprint(t, ctx, inv.ID)
	out, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("tx-%d", txs[1].ID), &EditEntryInput{Amount: f(2500), CashAmount: f(2500)}, "", true)
	if err != nil || !out.Result.DryRun || out.Result.After.Invested != out.Result.Before.Invested+500 {
		t.Fatalf("dry edit: %v %+v", err, out)
	}
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("tx-%d", txs[0].ID), nil, "", true); err != nil {
		t.Fatalf("dry delete: %v", err)
	}
	d := at(105)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("open-%d", inv.ID), &EditEntryInput{Amount: f(11000), CashAmount: f(11000), OccurredOn: &d}, "", true); err != nil {
		t.Fatalf("dry opening: %v", err)
	}
	if after := itFingerprint(t, ctx, inv.ID); after != before {
		t.Fatalf("dry run changed data:\n%s\n%s", before, after)
	}

	// scheduled engine too
	sp := itPlan(t, ctx, models.EngineSchedule, models.PayoutFrequencyMonthly, 6)
	s := itNew(t, ctx, sp, 12000, at(75), nil, 0)
	ps := itPayouts(t, ctx, s.ID)
	if _, err := SavePayoutPayment(ctx, s.ID, ps[0].ID, nil, 0, MarkPayoutPaidInput{CashAmount: ps[0].Amount}); err != nil {
		t.Fatal(err)
	}
	before = itFingerprint(t, ctx, s.ID)
	if _, err := editLedgerEntry(ctx, s.ID, nil, fmt.Sprintf("payout-%d", ps[0].ID), nil, "", true); err != nil {
		t.Fatalf("dry payout delete: %v", err)
	}
	d2 := at(2)
	if _, err := editLedgerEntry(ctx, s.ID, nil, fmt.Sprintf("payout-%d", ps[0].ID), &EditEntryInput{OccurredOn: &d2}, "", true); err != nil {
		t.Fatalf("dry payout edit: %v", err)
	}
	if after := itFingerprint(t, ctx, s.ID); after != before {
		t.Fatalf("scheduled dry run changed data:\n%s\n%s", before, after)
	}
}

func TestIntegration_Inv_LiveRefusals(t *testing.T) {
	ctx := itCtx(t)
	plan := itPlanLive(t, ctx)
	inv := itLive(t, ctx, plan, 10000, 100, baseSteps())
	txs := itTxs(t, ctx, inv.ID)
	ent := func(i int) string { return fmt.Sprintf("tx-%d", txs[i].ID) }
	open := fmt.Sprintf("open-%d", inv.ID)
	before := itFingerprint(t, ctx, inv.ID)
	refuse := func(name string, id string, in *EditEntryInput, want int) {
		t.Helper()
		_, err := editLedgerEntry(ctx, inv.ID, nil, id, in, "", false)
		expectStatus(t, name, err, want)
		if after := itFingerprint(t, ctx, inv.ID); after != before {
			t.Fatalf("%s: refused edit changed data:\n%s\n%s", name, before, after)
		}
	}
	fut := time.Now().AddDate(0, 0, 3)
	refuse("future date", ent(1), &EditEntryInput{OccurredOn: &fut}, http.StatusBadRequest)
	pre := at(200)
	refuse("before start", ent(1), &EditEntryInput{OccurredOn: &pre}, http.StatusBadRequest)
	refuse("zero deposit", ent(1), &EditEntryInput{Amount: f(0)}, http.StatusBadRequest)
	refuse("bad split", ent(1), &EditEntryInput{Amount: f(2000), CashAmount: f(100)}, http.StatusBadRequest)
	refuse("upi without bank", ent(1), &EditEntryInput{Amount: f(2000), CashAmount: f(0), UpiAmount: f(2000)}, http.StatusBadRequest)
	refuse("withdraw more principal than outstanding", ent(2), &EditEntryInput{PrincipalAmount: f(999999), InterestAmount: f(0), CashAmount: f(999999)}, http.StatusBadRequest)
	refuse("withdraw more interest than accrued", ent(2), &EditEntryInput{PrincipalAmount: f(3000), InterestAmount: f(999999), CashAmount: f(1002999)}, http.StatusBadRequest)
	refuse("negative withdrawal part", ent(2), &EditEntryInput{PrincipalAmount: f(-1)}, http.StatusBadRequest)
	// shrinking the opening below the later withdrawal
	refuse("opening delete", open, nil, http.StatusConflict)
	refuse("unknown tx", "tx-99999999", nil, http.StatusNotFound)
	refuse("bad id", "garbage", nil, http.StatusBadRequest)
	refuse("other investment's opening", "open-99999999", &EditEntryInput{Amount: f(1)}, http.StatusNotFound)
	// deleting the first deposit when the withdrawal then no longer fits is refused: make it so
	big := itLive(t, ctx, plan, 1000, 100, []liveStep{{deposit: true, amount: 5000, daysAgo: 60}, {amount: 4000, daysAgo: 20}})
	bt := itTxs(t, ctx, big.ID)
	bBefore := itFingerprint(t, ctx, big.ID)
	_, err := editLedgerEntry(ctx, big.ID, nil, fmt.Sprintf("tx-%d", bt[0].ID), nil, "", false)
	expectStatus(t, "delete deposit a later withdrawal needs", err, http.StatusBadRequest)
	if itFingerprint(t, ctx, big.ID) != bBefore {
		t.Fatal("refused delete changed data")
	}
	small := itLive(t, ctx, plan, 1000, 100, []liveStep{{amount: 800, daysAgo: 80}, {deposit: true, amount: 5000, daysAgo: 60}})
	sBefore := itFingerprint(t, ctx, small.ID)
	_, err = editLedgerEntry(ctx, small.ID, nil, fmt.Sprintf("open-%d", small.ID), &EditEntryInput{Amount: f(500), CashAmount: f(500)}, "", false)
	expectStatus(t, "opening too small for a later withdrawal", err, http.StatusBadRequest)
	itSame(t, ctx, small.ID, sBefore)
	_, err = editLedgerEntry(ctx, 99999999, nil, ent(0), nil, "", false)
	expectStatus(t, "unknown investment", err, http.StatusNotFound)
	other := uint(999)
	_, err = editLedgerEntry(ctx, inv.ID, &other, ent(0), nil, "", false)
	expectStatus(t, "branch scope", err, http.StatusNotFound)

	// status / structure guards, each restored afterwards
	for _, tc := range []struct{ name, set string }{
		{"closed", `status = 'Closed'`},
		{"renewed to", `renewed_to_investment_id = 1`},
		{"renewed from", `renewed_from_investment_id = 1`},
	} {
		config.BaseDB.Exec(`UPDATE investments SET `+tc.set+` WHERE id = ?`, inv.ID)
		before = itFingerprint(t, ctx, inv.ID)
		refuse(tc.name+" edit", ent(1), &EditEntryInput{Amount: f(2100)}, http.StatusConflict)
		refuse(tc.name+" delete", ent(1), nil, http.StatusConflict)
		refuse(tc.name+" opening", open, &EditEntryInput{Amount: f(11000)}, http.StatusConflict)
		config.BaseDB.Exec(`UPDATE investments SET status = 'Active', renewed_to_investment_id = NULL, renewed_from_investment_id = NULL WHERE id = ?`, inv.ID)
	}
	// payouts from a close block live edits
	config.BaseDB.Exec(`INSERT INTO investment_payouts (tenant_id, investment_id, sequence_no, due_date, amount, status, is_principal_return, created_at, updated_at) VALUES (?, ?, 1, now(), 100, 'Pending', false, now(), now())`, itTenant, inv.ID)
	before = itFingerprint(t, ctx, inv.ID)
	refuse("live with payouts edit", ent(1), &EditEntryInput{Amount: f(2100)}, http.StatusConflict)
	refuse("live with payouts opening", open, &EditEntryInput{Amount: f(11000)}, http.StatusConflict)
	config.BaseDB.Exec(`DELETE FROM investment_payouts WHERE investment_id = ?`, inv.ID)

	// tampered saved figures are refused rather than rewritten
	config.BaseDB.Exec(`UPDATE investment_transactions SET principal_after = principal_after + 7 WHERE id = ?`, txs[1].ID)
	before = itFingerprint(t, ctx, inv.ID)
	refuse("unreproducible chain", ent(0), nil, http.StatusConflict)
}

func TestIntegration_Inv_ScheduledOpeningAndPayouts(t *testing.T) {
	ctx := itCtx(t)
	plan := itPlan(t, ctx, models.EngineSchedule, models.PayoutFrequencyMonthly, 6)
	bank := itBank(t)
	inv := itNew(t, ctx, plan, 12000, at(75), nil, 0)
	ps := itPayouts(t, ctx, inv.ID)
	if len(ps) != 6 || ps[0].Amount != 120 {
		t.Fatalf("schedule: %d payouts, first %v", len(ps), ps[0].Amount)
	}
	if _, err := SavePayoutPayment(ctx, inv.ID, ps[0].ID, nil, 0, MarkPayoutPaidInput{CashAmount: 120}); err != nil {
		t.Fatal(err)
	}
	if _, err := SavePayoutPayment(ctx, inv.ID, ps[1].ID, nil, 0, MarkPayoutPaidInput{CashAmount: 20, UpiAmount: 100, BankID: &bank}); err != nil {
		t.Fatal(err)
	}
	if got := itInv(t, ctx, inv.ID); got.TotalInterestPaid != 240 {
		t.Fatalf("total interest paid %v", got.TotalInterestPaid)
	}
	open := fmt.Sprintf("open-%d", inv.ID)

	// opening edit is refused while payouts are paid, and nothing changes
	before := itFingerprint(t, ctx, inv.ID)
	_, err := editLedgerEntry(ctx, inv.ID, nil, open, &EditEntryInput{Amount: f(15000)}, "", false)
	expectStatus(t, "opening with paid payouts", err, http.StatusConflict)
	itSame(t, ctx, inv.ID, before)
	// payout amount is fixed
	_, err = editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", ps[0].ID), &EditEntryInput{Amount: f(999)}, "", false)
	expectStatus(t, "payout amount change", err, http.StatusConflict)
	// a pending payout is not a ledger entry
	_, err = editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", ps[3].ID), &EditEntryInput{CashAmount: f(120)}, "", false)
	expectStatus(t, "pending payout", err, http.StatusConflict)
	// another investment's payout
	other := itNew(t, ctx, plan, 5000, at(10), nil, 0)
	op := itPayouts(t, ctx, other.ID)
	_, err = editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", op[0].ID), nil, "", false)
	expectStatus(t, "foreign payout", err, http.StatusNotFound)
	// live-only ids do not apply
	_, err = editLedgerEntry(ctx, inv.ID, nil, "tx-1", nil, "", false)
	if err == nil {
		t.Fatal("tx entry on a scheduled investment must be refused")
	}
	itSame(t, ctx, inv.ID, before)

	// payout edit: date and split (UPI via bank)
	d3 := at(3)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", ps[0].ID), &EditEntryInput{OccurredOn: &d3, CashAmount: f(20), UpiAmount: f(100), BankID: &bank}, "", false); err != nil {
		t.Fatalf("edit payout: %v", err)
	}
	p0 := itPayouts(t, ctx, inv.ID)[0]
	if p0.Status != "Paid" || p0.PaidAt == nil || !sameDay(*p0.PaidAt, d3) || p0.UpiAmount != 100 || p0.CashAmount != 20 || p0.CashMovementID == nil {
		t.Fatalf("payout not updated: %+v", p0)
	}
	var m cashModels.CashMovement
	if err := config.BaseDB.WithContext(ctx).First(&m, *p0.CashMovementID).Error; err != nil || m.SourceID == nil || *m.SourceID != inv.ID || !sameDay(m.OccurredOn, d3) {
		t.Fatalf("payout cash line wrong: %v %+v", err, m)
	}
	var lines int
	var sum float64
	config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(amount),0) FROM cash_movements WHERE transaction_group_id = ?`, m.TransactionGroupID).Row().Scan(&lines, &sum)
	if lines != 2 || sum != 120 {
		t.Fatalf("payout cash group: %d lines sum %v", lines, sum)
	}
	if got := itInv(t, ctx, inv.ID); got.TotalInterestPaid != 240 {
		t.Fatalf("interest paid changed by a date edit: %v", got.TotalInterestPaid)
	}
	// exactly one set of payout lines per paid payout, no strays
	if n, net := itCashNet(inv.ID); n != 1+2+2 || net != 12000-240 {
		// opening (1 cash line) + payout1 (2 lines) + payout2 (2 lines)
		t.Fatalf("cash lines: %d net %v", n, net)
	}

	// delete the second paid payout: back to Pending, lines removed, interest paid reduced
	oldCM := *itPayouts(t, ctx, inv.ID)[1].CashMovementID
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", ps[1].ID), nil, "r", false); err != nil {
		t.Fatalf("delete payout: %v", err)
	}
	p1 := itPayouts(t, ctx, inv.ID)[1]
	if p1.Status != "Pending" || p1.PaidAt != nil || p1.CashMovementID != nil || p1.CashAmount != 0 || p1.UpiAmount != 0 {
		t.Fatalf("payout not reset: %+v", p1)
	}
	var left int
	config.BaseDB.Raw(`SELECT count(*) FROM cash_movements WHERE id = ?`, oldCM).Row().Scan(&left)
	if left != 0 {
		t.Fatal("deleted payout's cash line left")
	}
	if got := itInv(t, ctx, inv.ID); got.TotalInterestPaid != 120 {
		t.Fatalf("total interest paid %v want 120", got.TotalInterestPaid)
	}
	if n, net := itCashNet(inv.ID); n != 1+2 || net != 12000-120 {
		t.Fatalf("cash lines after delete: %d net %v", n, net)
	}
	// the deleted payout can be paid again
	if _, err := SavePayoutPayment(ctx, inv.ID, ps[1].ID, nil, 0, MarkPayoutPaidInput{CashAmount: 120}); err != nil {
		t.Fatalf("re-pay: %v", err)
	}
	// delete the first too, then the opening edit is allowed
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", ps[0].ID), nil, "", false); err != nil {
		t.Fatalf("delete first payout: %v", err)
	}
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", ps[1].ID), nil, "", false); err != nil {
		t.Fatalf("delete second payout: %v", err)
	}
	if got := itInv(t, ctx, inv.ID); got.TotalInterestPaid != 0 {
		t.Fatalf("total interest paid %v want 0", got.TotalInterestPaid)
	}

	// opening edit: amount, date, split; the schedule is regenerated
	d80 := at(80)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, open, &EditEntryInput{Amount: f(15000), OccurredOn: &d80, CashAmount: f(10000), UpiAmount: f(5000), BankID: &bank}, "", false); err != nil {
		t.Fatalf("edit opening: %v", err)
	}
	got := itInv(t, ctx, inv.ID)
	if got.PrincipalAmount != 15000 || !sameDay(got.StartDate, d80) || got.MaturityDate.Format("2006-01-02") != d80.AddDate(0, 6, 0).Format("2006-01-02") {
		t.Fatalf("investment not updated: %+v", got)
	}
	np := itPayouts(t, ctx, inv.ID)
	if len(np) != 6 {
		t.Fatalf("schedule has %d payouts", len(np))
	}
	for i, p := range np {
		if p.Amount != 150 || p.Status != "Pending" || p.DueDate.Format("2006-01-02") != d80.AddDate(0, i+1, 0).Format("2006-01-02") || p.SequenceNo != i+1 {
			t.Fatalf("payout %d not regenerated: %+v", i, p)
		}
	}
	// reference investment built the normal way
	ref := itNew(t, ctx, plan, 15000, d80, &bank, 5000)
	rp := itPayouts(t, ctx, ref.ID)
	for i := range np {
		if np[i].Amount != rp[i].Amount || np[i].DueDate.Format("2006-01-02") != rp[i].DueDate.Format("2006-01-02") {
			t.Fatalf("schedule differs from a fresh one at %d", i)
		}
	}
	if n, net := itCashNet(inv.ID); n != 2 || net != 15000 {
		t.Fatalf("opening cash lines: %d net %v", n, net)
	}
	rn, rnet := itCashNet(ref.ID)
	if rn != 2 || rnet != 15000 {
		t.Fatalf("reference lines %d %v", rn, rnet)
	}
	// opening below the plan minimum is refused
	config.BaseDB.Exec(`UPDATE investment_plans SET min_principal = 5000 WHERE id = ?`, plan.ID)
	before = itFingerprint(t, ctx, inv.ID)
	_, err = editLedgerEntry(ctx, inv.ID, nil, open, &EditEntryInput{Amount: f(100)}, "", false)
	expectStatus(t, "below plan minimum", err, http.StatusBadRequest)
	itSame(t, ctx, inv.ID, before)
	// the payouts can be paid again with the new amounts, interest tracked
	np = itPayouts(t, ctx, inv.ID)
	if _, err := SavePayoutPayment(ctx, inv.ID, np[0].ID, nil, 0, MarkPayoutPaidInput{CashAmount: 150}); err != nil {
		t.Fatal(err)
	}
	if got := itInv(t, ctx, inv.ID); got.TotalInterestPaid != 150 {
		t.Fatalf("interest paid %v", got.TotalInterestPaid)
	}

	// Closed / Renewed scheduled investment: opening cannot be edited
	config.BaseDB.Exec(`DELETE FROM cash_movements WHERE source_id = ? AND source_type = 'investment_payout'`, inv.ID)
	config.BaseDB.Exec(`UPDATE investment_payouts SET status='Pending', paid_at=NULL, cash_movement_id=NULL WHERE investment_id = ?`, inv.ID)
	config.BaseDB.Exec(`UPDATE investments SET total_interest_paid = 0 WHERE id = ?`, inv.ID)
	for _, set := range []string{`status = 'Closed'`, `renewed_from_investment_id = 1`} {
		config.BaseDB.Exec(`UPDATE investments SET `+set+` WHERE id = ?`, inv.ID)
		before = itFingerprint(t, ctx, inv.ID)
		_, err = editLedgerEntry(ctx, inv.ID, nil, open, &EditEntryInput{Amount: f(16000)}, "", false)
		expectStatus(t, "scheduled opening "+set, err, http.StatusConflict)
		if itFingerprint(t, ctx, inv.ID) != before {
			t.Fatalf("refusal (%s) changed data", set)
		}
		config.BaseDB.Exec(`UPDATE investments SET status = 'Active', renewed_from_investment_id = NULL WHERE id = ?`, inv.ID)
	}
	// opening delete
	_, err = editLedgerEntry(ctx, inv.ID, nil, open, nil, "", false)
	expectStatus(t, "scheduled opening delete", err, http.StatusConflict)
}

func TestIntegration_Inv_PayInterestFlowThenEdit(t *testing.T) {
	ctx := itCtx(t)
	plan := itPlan(t, ctx, models.EngineSchedule, models.PayoutFrequencyMonthly, 6)
	inv := itNew(t, ctx, plan, 12000, at(75), nil, 0)
	paid, err := SaveInterestPayments(ctx, inv.ID, nil, 0, 240, MarkPayoutPaidInput{CashAmount: 240})
	if err != nil || len(paid) != 2 {
		t.Fatalf("pay interest: %v %d", err, len(paid))
	}
	// delete one of the two paid by the bulk flow
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", paid[1].ID), nil, "", false); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := itInv(t, ctx, inv.ID); got.TotalInterestPaid != 120 {
		t.Fatalf("interest paid %v", got.TotalInterestPaid)
	}
	if n, net := itCashNet(inv.ID); n != 2 || net != 12000-120 {
		t.Fatalf("cash lines %d net %v", n, net)
	}
	// edit the other (date earlier than payout was made but after start)
	d := at(20)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", paid[0].ID), &EditEntryInput{OccurredOn: &d}, "", false); err != nil {
		t.Fatalf("edit: %v", err)
	}
	p := itPayouts(t, ctx, inv.ID)[0]
	if p.PaidAt == nil || !sameDay(*p.PaidAt, d) {
		t.Fatalf("date not updated: %+v", p)
	}
	// before the start date is refused
	pre := at(200)
	before := itFingerprint(t, ctx, inv.ID)
	_, err = editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", paid[0].ID), &EditEntryInput{OccurredOn: &pre}, "", false)
	expectStatus(t, "payout before start", err, http.StatusBadRequest)
	fut := time.Now().AddDate(0, 0, 4)
	_, err = editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", paid[0].ID), &EditEntryInput{OccurredOn: &fut}, "", false)
	expectStatus(t, "payout in the future", err, http.StatusBadRequest)
	_, err = editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("payout-%d", paid[0].ID), &EditEntryInput{CashAmount: f(50)}, "", false)
	expectStatus(t, "payout bad split", err, http.StatusBadRequest)
	itSame(t, ctx, inv.ID, before)
}

func ptr(p *uint) any {
	if p == nil {
		return nil
	}
	return *p
}

func infoOf(t *testing.T, id uint) map[string]any {
	t.Helper()
	req := httptest.NewRequest("GET", "/", strings.NewReader(""))
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set("tenantId", itTenant)
	c.Set("singleBranchHeadOffice", itBranch)
	c.SetParamNames("id")
	c.SetParamValues(strconv.FormatUint(uint64(id), 10))
	if err := cashbook.GetMovementEntry(c); err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	d, _ := out["data"].(map[string]any)
	if rec.Code != 200 || d == nil {
		t.Fatalf("info %d: HTTP %d %s", id, rec.Code, rec.Body.String())
	}
	return d
}

func lineIDs(where string, args ...any) []uint {
	var ids []uint
	config.BaseDB.Raw(`SELECT id FROM cash_movements WHERE `+where+` ORDER BY id`, args...).Scan(&ids)
	return ids
}

func wantEntry(t *testing.T, what string, ids []uint, invID uint, entry string) {
	t.Helper()
	if len(ids) == 0 {
		t.Fatalf("%s: no cash lines", what)
	}
	for _, id := range ids {
		d := infoOf(t, id)
		if d["loan_entry"] != "investment_entry" || float64(invID) != d["loan_id"].(float64) || d["investment_entry_id"] != entry || d["editable"] != false {
			t.Fatalf("%s: line %d resolves to %v, want investment %d entry %s", what, id, d, invID, entry)
		}
	}
}

func TestIntegration_Inv_CashInfoLookups(t *testing.T) {
	ctx := itCtx(t)
	bank := itBank(t)
	// live: opening, add-cash deposit and a withdrawal, some of them split over two lines
	plan := itPlanLive(t, ctx)
	inv := itLiveSplit(t, ctx, plan, 10000, 100, &bank, 3000, []liveStep{
		{deposit: true, amount: 5000, daysAgo: 60, upi: 2000, bankID: &bank},
		{amount: 3000, interest: 100, daysAgo: 20, upi: 1000, bankID: &bank},
	})
	check := func(stage string) {
		t.Helper()
		txs := itTxs(t, ctx, inv.ID)
		for _, x := range txs {
			g := ""
			config.BaseDB.Raw(`SELECT COALESCE(transaction_group_id,'') FROM cash_movements WHERE id = ?`, *x.CashMovementID).Row().Scan(&g)
			wantEntry(t, stage+" tx "+x.Type, lineIDs(`transaction_group_id = ?`, g), inv.ID, fmt.Sprintf("tx-%d", x.ID))
		}
		var og []string
		config.BaseDB.Raw(`SELECT DISTINCT transaction_group_id FROM cash_movements WHERE source_id = ? AND source_type = 'investment_deposit' AND occurred_on = ?`, inv.ID, itInv(t, ctx, inv.ID).StartDate).Scan(&og)
		if len(og) != 1 {
			t.Fatalf("%s: opening group %v", stage, og)
		}
		wantEntry(t, stage+" opening", lineIDs(`transaction_group_id = ?`, og[0]), inv.ID, fmt.Sprintf("open-%d", inv.ID))
	}
	check("created")
	txs := itTxs(t, ctx, inv.ID)
	d := at(58)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("tx-%d", txs[0].ID), &EditEntryInput{Amount: f(4000), CashAmount: f(2500), UpiAmount: f(1500), BankID: &bank, OccurredOn: &d}, "", false); err != nil {
		t.Fatal(err)
	}
	check("after deposit edit")
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("tx-%d", txs[1].ID), &EditEntryInput{PrincipalAmount: f(2000), InterestAmount: f(100), CashAmount: f(2100)}, "", false); err != nil {
		t.Fatal(err)
	}
	check("after withdrawal edit")
	d2 := at(104)
	if _, err := editLedgerEntry(ctx, inv.ID, nil, fmt.Sprintf("open-%d", inv.ID), &EditEntryInput{Amount: f(9000), CashAmount: f(9000), OccurredOn: &d2}, "", false); err != nil {
		t.Fatal(err)
	}
	check("after opening edit")

	// scheduled: opening and paid payouts (one split in two lines)
	sp := itPlan(t, ctx, models.EngineSchedule, models.PayoutFrequencyMonthly, 6)
	s := itNew(t, ctx, sp, 12000, at(75), &bank, 2000)
	ps := itPayouts(t, ctx, s.ID)
	if _, err := SavePayoutPayment(ctx, s.ID, ps[0].ID, nil, 0, MarkPayoutPaidInput{CashAmount: 120}); err != nil {
		t.Fatal(err)
	}
	if _, err := SavePayoutPayment(ctx, s.ID, ps[1].ID, nil, 0, MarkPayoutPaidInput{CashAmount: 20, UpiAmount: 100, BankID: &bank}); err != nil {
		t.Fatal(err)
	}
	scheduled := func(stage string) {
		t.Helper()
		for _, p := range itPayouts(t, ctx, s.ID) {
			if p.Status != "Paid" {
				continue
			}
			g := ""
			config.BaseDB.Raw(`SELECT COALESCE(transaction_group_id,'') FROM cash_movements WHERE id = ?`, *p.CashMovementID).Row().Scan(&g)
			wantEntry(t, fmt.Sprintf("%s payout %d", stage, p.SequenceNo), lineIDs(`transaction_group_id = ?`, g), s.ID, fmt.Sprintf("payout-%d", p.ID))
		}
		wantEntry(t, stage+" scheduled opening", lineIDs(`source_id = ? AND source_type = 'investment_deposit'`, s.ID), s.ID, fmt.Sprintf("open-%d", s.ID))
	}
	scheduled("created")
	d3 := at(3)
	if _, err := editLedgerEntry(ctx, s.ID, nil, fmt.Sprintf("payout-%d", ps[1].ID), &EditEntryInput{OccurredOn: &d3, CashAmount: f(60), UpiAmount: f(60), BankID: &bank}, "", false); err != nil {
		t.Fatal(err)
	}
	scheduled("after payout edit")
}
