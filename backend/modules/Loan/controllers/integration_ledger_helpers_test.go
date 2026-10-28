package controllers

// Shared helpers for the ledger-edit integration tests (payment, top-up, sanction and auction edits). They run only
// against the scratch database (see integration_minimum_period_test.go) and remove every row they create.
//
//	cd backend && DB_NAME=ambikagold_scratch MIGRATIONS_DIR="$(pwd)/migrations" JWT_SECRET=x WHATSAPP_ORIGIN=http://127.0.0.1:1 \
//	  WHATSAPP_API_KEY=off go test ./modules/Loan/controllers/ -run IntegrationLedger -v

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"testing"
	"time"

	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"

	"gorm.io/gorm"
)

const adminRoleID = uint(19) // the scratch tenant's system Administrator role

// ledgerLoan is a Normal-scheme loan opened ledgerAge days ago, paid through SaveLoanPayment.
type ledgerLoan struct {
	t      *testing.T
	ctx    context.Context
	id     uint
	number string
	opened time.Time // midnight UTC of the opening day
	bank   uint
	pids   []uint // payment ids, aligned to the specs it was built from
	live   bool   // the loan is entered in real time (dated today): nothing to settle after each entry
}

const ledgerAge = 100

// payStep is one repayment of a fixture, `day` days after the loan opened.
type payStep struct {
	day      int
	typ      string
	amt      float64
	cash     float64
	upi      float64
	bank     float64
	override *float64
	discount float64 // a same-day discount saved just before the payment
}

func (l *ledgerLoan) dateOf(day int) string { return l.opened.AddDate(0, 0, day).Format("2006-01-02") }

func (l *ledgerLoan) when(day int) time.Time {
	d, err := parsePaidOn(l.dateOf(day))
	if err != nil {
		l.t.Fatal(err)
	}
	return d
}

func exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if err := config.BaseDB.Exec(sql, args...).Error; err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func scalarString(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var s string
	if err := config.BaseDB.Raw(sql, args...).Row().Scan(&s); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return s
}

func scalarFloat(t *testing.T, sql string, args ...any) float64 {
	t.Helper()
	var f float64
	if err := config.BaseDB.Raw(sql, args...).Row().Scan(&f); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return f
}

func scalarInt(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := config.BaseDB.Raw(sql, args...).Row().Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// testBank creates a bank of the scratch tenant (removed afterwards) so a UPI / Bank Transfer split has one to name.
func testBank(t *testing.T) uint {
	t.Helper()
	var id uint
	if err := config.BaseDB.Raw(`INSERT INTO banks (name, tenant_id, branch_id, created_at, updated_at) VALUES (?, ?, 6, now(), now()) RETURNING id`,
		fmt.Sprintf("TST bank %d", time.Now().UnixNano()%1_000_000), scratchTenant).Row().Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		config.BaseDB.Exec(`DELETE FROM cash_movements WHERE bank_id = ? OR to_bank_id = ? OR counter_bank_id = ?`, id, id, id)
		config.BaseDB.Exec(`DELETE FROM expenses WHERE from_bank_id = ?`, id)
		config.BaseDB.Exec(`DELETE FROM banks WHERE id = ?`, id)
	})
	return id
}

// removeLoan deletes a loan and everything the tests attached to it, cash lines included.
func removeLoan(id uint) {
	var number string
	config.BaseDB.Raw(`SELECT loan_number FROM loans WHERE id = ?`, id).Row().Scan(&number)
	q := func(sql string, args ...any) { config.BaseDB.Exec(sql, args...) }
	q(`DELETE FROM cash_movements WHERE transaction_group_id IN (SELECT cash_transaction_group_id FROM loan_payments WHERE loan_id = ? AND cash_transaction_group_id <> '')`, id)
	q(`DELETE FROM cash_movements WHERE transaction_group_id IN (SELECT cash_transaction_group_id FROM loan_top_ups WHERE loan_id = ? AND cash_transaction_group_id <> '')`, id)
	if number != "" {
		q(`DELETE FROM cash_movements WHERE purpose LIKE '%' || ? || '%' OR remarks LIKE '%' || ? || '%'`, number, number)
		q(`DELETE FROM expenses WHERE payee LIKE '%' || ? OR remarks LIKE '%' || ? || '%'`, number, number)
	}
	q(`DELETE FROM cash_movements WHERE source_id = ? AND source_type LIKE 'loan%'`, id)
	q(`DELETE FROM auction_events WHERE auction_record_id IN (SELECT id FROM auction_records WHERE loan_id = ?)`, id)
	q(`DELETE FROM auction_notices WHERE auction_record_id IN (SELECT id FROM auction_records WHERE loan_id = ?)`, id)
	q(`DELETE FROM auction_decision_requests WHERE loan_id = ?`, id)
	q(`DELETE FROM auction_records WHERE loan_id = ?`, id)
	q(`DELETE FROM packet_movements WHERE packet_id IN (SELECT id FROM packets WHERE loan_id = ?)`, id)
	q(`DELETE FROM packets WHERE loan_id = ?`, id)
	q(`DELETE FROM loan_accruals WHERE loan_id = ?`, id)
	q(`DELETE FROM loan_payments WHERE loan_id = ?`, id)
	q(`DELETE FROM loan_top_ups WHERE loan_id = ?`, id)
	q(`DELETE FROM loan_approvals WHERE loan_id = ?`, id)
	q(`DELETE FROM ornaments WHERE loan_id = ?`, id)
	q(`DELETE FROM reminders WHERE loan_id = ?`, id)
	q(`DELETE FROM loans WHERE id = ?`, id)
}

// newLedgerLoan opens a ₹10,000 Normal-scheme loan `age` days ago (30 day minimum, 12%) with a bank beside it, with
// its disbursement date set to the opening day like a real sanctioned loan.
func newLedgerLoan(t *testing.T, age int) *ledgerLoan {
	t.Helper()
	ctx := integrationCtx(t)
	bank := testBank(t)
	id := cloneLoan(t, "Monthly simple interest", 30, age)
	t.Cleanup(func() { removeLoan(id) })
	exec(t, `UPDATE loans SET principal_amount = 10000, outstanding_amount = 10000, sanctioned_amount = 10000, disbursed_amount = 10000, disbursement_date = opened_date WHERE id = ?`, id)
	l, err := findLoanByID(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return &ledgerLoan{t: t, ctx: ctx, id: id, number: l.LoanNumber, opened: l.OpenedDate.UTC(), bank: bank}
}

// settleAsOf puts the loan back to how it stood when a payment dated `day` was saved: the loan page that
// SaveLoanPayment opens afterwards saves the interest rows of every period completed up to TODAY, and a history is
// entered on the days it is dated, so rows after the payment's date did not exist then. Rows dated after it are
// removed, the loan's interest totals and charge date are those of the remaining rows, and the servicing status is
// the one the recalculation gives.
func (l *ledgerLoan) settleAsOf(day int, moveAnchor bool) {
	l.t.Helper()
	cut := l.opened.AddDate(0, 0, day)
	exec(l.t, `DELETE FROM loan_accruals WHERE loan_id = ? AND accrued_on > ?`, l.id, cut)
	anchor := "last_accrual_date"
	if moveAnchor {
		anchor = "?::timestamptz"
	} else { // a top-up charges no interest to its own date: the charge date stays where the last payment left it
		anchor = "LEAST(last_accrual_date, ?::timestamptz)"
	}
	exec(l.t, `UPDATE loans SET accrued_interest = COALESCE((SELECT sum(interest) FROM loan_accruals WHERE loan_id = loans.id), 0),
		accrued_penal_interest = COALESCE((SELECT sum(penal_interest) FROM loan_accruals WHERE loan_id = loans.id), 0), last_accrual_date = `+anchor+` WHERE id = ?`, cut, l.id)
	loan, err := findLoanByID(l.ctx, l.id)
	if err != nil {
		l.t.Fatal(err)
	}
	switch loan.Status {
	case models.StatusActive, models.StatusDueSoon, models.StatusOverdue:
		loan.Status = models.StatusActive
		refreshServicingStatus(loan, time.Now())
		exec(l.t, `UPDATE loans SET status = ? WHERE id = ?`, loan.Status, l.id)
	}
}

// pay saves one step through SaveLoanPayment, the way the Record Payment screen does (a date before today is
// back-dated), and returns the payment's id.
func (l *ledgerLoan) pay(s payStep) uint {
	l.t.Helper()
	in := PaymentInput{
		Amount: s.amt, Type: s.typ, PaidOn: l.when(s.day), CashAmount: s.cash, UpiAmount: s.upi, BankTransferAmount: s.bank,
		InterestOverride: s.override, CheckDateWindow: true,
	}
	if s.upi+s.bank > 0 {
		b := l.bank
		in.BankID = &b
	}
	if s.discount > 0 {
		in.Discount, in.DiscountReason, in.DiscountMode = s.discount, "test discount", "Cash"
	}
	if _, err := SaveLoanPayment(l.ctx, l.id, in); err != nil {
		l.t.Fatalf("pay %+v: %v", s, err)
	}
	var id uint
	if err := config.BaseDB.Raw(`SELECT id FROM loan_payments WHERE loan_id = ? AND type <> 'Discount' AND type <> 'Disbursement' ORDER BY id DESC LIMIT 1`, l.id).Row().Scan(&id); err != nil {
		l.t.Fatal(err)
	}
	if s.day < ledgerAge && !l.live {
		l.settleAsOf(s.day, true)
	}
	return id
}

// build enters the steps in date order, each as it stood on its day.
func (l *ledgerLoan) build(steps []payStep) *ledgerLoan {
	for _, s := range steps {
		l.pids = append(l.pids, l.pay(s))
	}
	return l
}

// payments returns the loan's repayment rows in replay order.
func (l *ledgerLoan) payments() []models.LoanPayment {
	l.t.Helper()
	var rows []models.LoanPayment
	if err := config.BaseDB.WithContext(l.ctx).Where("loan_id = ?", l.id).Order("paid_on asc, id asc").Find(&rows).Error; err != nil {
		l.t.Fatal(err)
	}
	return rows
}

func (l *ledgerLoan) loan() *models.Loan {
	l.t.Helper()
	var loan models.Loan
	if err := config.BaseDB.WithContext(l.ctx).First(&loan, l.id).Error; err != nil {
		l.t.Fatal(err)
	}
	return &loan
}

type accrualRow struct {
	AccruedOn time.Time
	Interest  float64
	Penal     float64
}

func (l *ledgerLoan) accruals() []accrualRow {
	l.t.Helper()
	var rows []models.LoanAccrual
	if err := config.BaseDB.WithContext(l.ctx).Where("loan_id = ?", l.id).Order("accrued_on asc, id asc").Find(&rows).Error; err != nil {
		l.t.Fatal(err)
	}
	out := make([]accrualRow, len(rows))
	for i, r := range rows {
		out[i] = accrualRow{r.AccruedOn, r.Interest, r.PenalInterest}
	}
	return out
}

// snapshotLoan is every saved fact about a loan in one string: the loan row, its payments, interest rows, top-ups,
// auction rows, packet rows and the cash lines and expenses that carry its number or one of its groups.
func snapshotLoan(t *testing.T, id uint) string {
	t.Helper()
	number := scalarString(t, `SELECT loan_number FROM loans WHERE id = ?`, id)
	parts := []string{
		`SELECT COALESCE((SELECT row_to_json(x)::text FROM loans x WHERE id = ?), '')`,
		`SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM loan_payments x WHERE loan_id = ?), '')`,
		`SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM loan_accruals x WHERE loan_id = ?), '')`,
		`SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM loan_top_ups x WHERE loan_id = ?), '')`,
		`SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM auction_records x WHERE loan_id = ?), '')`,
		`SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM auction_decision_requests x WHERE loan_id = ?), '')`,
		`SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM packets x WHERE loan_id = ?), '')`,
		`SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM packet_movements x WHERE packet_id IN (SELECT id FROM packets WHERE loan_id = ?)), '')`,
	}
	var sb strings.Builder
	for _, p := range parts {
		sb.WriteString(scalarString(t, p, id))
		sb.WriteString("\n")
	}
	sb.WriteString(scalarString(t, `SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM cash_movements x WHERE purpose LIKE '%' || ? || '%' OR remarks LIKE '%' || ? || '%' OR (source_id = ? AND source_type LIKE 'loan%')
		OR transaction_group_id IN (SELECT cash_transaction_group_id FROM loan_payments WHERE loan_id = ?) OR transaction_group_id IN (SELECT cash_transaction_group_id FROM loan_top_ups WHERE loan_id = ?)), '')`, number, number, id, id, id))
	sb.WriteString("\n")
	sb.WriteString(scalarString(t, `SELECT COALESCE((SELECT json_agg(x ORDER BY id)::text FROM expenses x WHERE payee LIKE '%' || ? OR remarks LIKE '%' || ? || '%'), '')`, number, number))
	return sb.String()
}

// codeOf is the HTTP status an error would be answered with, or 0 when there was none.
func codeOf(err error) int {
	var se common.StatusedError
	if errors.As(err, &se) {
		return se.Status()
	}
	if err != nil {
		return 500
	}
	return 0
}

func (l *ledgerLoan) wantRefused(err error, code int, contains string, before string) {
	l.t.Helper()
	if err == nil {
		l.t.Fatalf("expected a %d refusal containing %q, the call succeeded", code, contains)
	}
	if codeOf(err) != code || !strings.Contains(err.Error(), contains) {
		l.t.Fatalf("expected %d containing %q, got %d: %v", code, contains, codeOf(err), err)
	}
	if after := snapshotLoan(l.t, l.id); after != before {
		l.t.Fatalf("a refused call changed the database:\n--- before\n%s\n--- after\n%s", before, after)
	}
}

func rowKey(p models.LoanPayment) string {
	ov := "-"
	if p.InterestOverride != nil {
		ov = fmt.Sprintf("%.2f", *p.InterestOverride)
	}
	return fmt.Sprintf("%s %.2f %s fee %.2f pen %.2f int %.2f prin %.2f rb %.2f | cash %.2f upi %.2f bank %.2f %s ovr %s", p.Type, p.Amount,
		p.PaidOn.UTC().Format("2006-01-02"), p.ProcessingFeeApplied, p.PenalInterestApplied, p.InterestApplied, p.PrincipalApplied, p.RunningBalance,
		p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.Method, ov)
}

func closeTo(a, b float64) bool { return math.Abs(a-b) <= 0.005 }

// sameLedger compares two loans built differently (an edited loan and a twin saved from scratch), row by row.
func sameLedger(t *testing.T, label string, a, b *ledgerLoan) {
	t.Helper()
	ra, rb := a.payments(), b.payments()
	if len(ra) != len(rb) {
		t.Errorf("%s: %d rows vs %d", label, len(ra), len(rb))
		return
	}
	topUps := scalarInt(t, `SELECT count(*) FROM loan_top_ups WHERE loan_id = ?`, a.id)
	for i := range ra {
		if topUps > 0 && ra[i].Description == topUpSettlementDescription {
			ra[i].RunningBalance, rb[i].RunningBalance = 0, 0 // stale on the live row, recalculated on an edited one
		}
		if rowKey(ra[i]) != rowKey(rb[i]) {
			t.Errorf("%s: row %d differs\n   edited: %s\n   twin  : %s", label, i, rowKey(ra[i]), rowKey(rb[i]))
		}
	}
	la, lb := a.loan(), b.loan()
	for _, c := range []struct {
		n    string
		x, y float64
	}{
		{"outstanding", la.OutstandingAmount, lb.OutstandingAmount}, {"accrued", la.AccruedInterest, lb.AccruedInterest},
		{"interest paid", la.InterestPaid, lb.InterestPaid}, {"penal", la.AccruedPenalInterest, lb.AccruedPenalInterest},
		{"penal paid", la.PenalInterestPaid, lb.PenalInterestPaid}, {"fee", la.OutstandingProcessingFee, lb.OutstandingProcessingFee},
		{"principal", la.PrincipalAmount, lb.PrincipalAmount},
	} {
		if !closeTo(c.x, c.y) {
			t.Errorf("%s: loan %s %.2f vs twin %.2f", label, c.n, c.x, c.y)
		}
	}
	if la.Status != lb.Status {
		t.Errorf("%s: status %s vs twin %s", label, la.Status, lb.Status)
	}
	xa, xb := a.accruals(), b.accruals()
	var sa, sb float64
	for _, r := range xa {
		sa += r.Interest
	}
	for _, r := range xb {
		sb += r.Interest
	}
	if !closeTo(sa, sb) || (topUps == 0 && len(xa) != len(xb)) {
		t.Errorf("%s: interest rows %d totalling %.2f vs twin %d totalling %.2f", label, len(xa), sa, len(xb), sb)
		return
	}
	if topUps > 0 {
		return // a recalculation splits the period after a top-up's interest settlement into two rows: only the total is compared
	}
	for i := range xa {
		if !xa[i].AccruedOn.Equal(xb[i].AccruedOn) || !closeTo(xa[i].Interest, xb[i].Interest) {
			t.Errorf("%s: interest row %d: %s %.2f vs twin %s %.2f", label, i, xa[i].AccruedOn.Format("2006-01-02"), xa[i].Interest, xb[i].AccruedOn.Format("2006-01-02"), xb[i].Interest)
		}
	}
}

// fullReplayHolds recalculates the loan from day 0 inside a transaction it rolls back, and checks that doing so
// reproduces what is saved: every row's allocation and running balance, the loan totals, status and interest rows.
func fullReplayHolds(t *testing.T, label string, l *ledgerLoan) {
	t.Helper()
	savedAcc := l.accruals()
	savedLoan := l.loan()
	savedRows := l.payments()
	topUpCount := scalarInt(t, `SELECT count(*) FROM loan_top_ups WHERE loan_id = ?`, l.id)
	err := config.DB.WithContext(l.ctx).Transaction(func(tx *gorm.DB) error {
		loan, err := lockByID(l.ctx, tx, l.id)
		if err != nil {
			return err
		}
		_, rows, err := loadReplayRows(l.ctx, tx, l.id)
		if err != nil {
			return err
		}
		if err := replayLoanFrom(l.ctx, tx, loan, rows, savedLoan.Status, 0); err != nil {
			t.Errorf("%s: full recalculation refused the saved history: %v", label, err)
			return errDryRun
		}
		if len(rows) != len(savedRows) {
			// auction / discount rows are replayed too; savedRows is every row, so compare only the replayed ones
		}
		byID := map[uint]models.LoanPayment{}
		for _, r := range rows {
			byID[r.ID] = r
		}
		for _, s := range savedRows {
			r, ok := byID[s.ID]
			if !ok {
				continue
			}
			if !closeTo(r.InterestApplied, s.InterestApplied) || !closeTo(r.PrincipalApplied, s.PrincipalApplied) || !closeTo(r.PenalInterestApplied, s.PenalInterestApplied) ||
				!closeTo(r.ProcessingFeeApplied, s.ProcessingFeeApplied) || (!closeTo(r.RunningBalance, s.RunningBalance) && s.Description != topUpSettlementDescription) {
				t.Errorf("%s: full recalculation gives a different row\n   saved     : %s\n   recalculated: %s", label, rowKey(s), rowKey(r))
			}
		}
		for _, c := range []struct {
			n    string
			x, y float64
		}{
			{"outstanding", savedLoan.OutstandingAmount, loan.OutstandingAmount}, {"accrued", savedLoan.AccruedInterest, loan.AccruedInterest},
			{"interest paid", savedLoan.InterestPaid, loan.InterestPaid}, {"penal", savedLoan.AccruedPenalInterest, loan.AccruedPenalInterest},
			{"penal paid", savedLoan.PenalInterestPaid, loan.PenalInterestPaid}, {"fee", savedLoan.OutstandingProcessingFee, loan.OutstandingProcessingFee},
		} {
			if !closeTo(c.x, c.y) {
				t.Errorf("%s: saved loan %s %.2f, full recalculation %.2f", label, c.n, c.x, c.y)
			}
		}
		if savedLoan.Status != loan.Status {
			t.Errorf("%s: saved status %s, full recalculation %s", label, savedLoan.Status, loan.Status)
		}
		var re []models.LoanAccrual
		if err := tx.Where("loan_id = ?", l.id).Order("accrued_on asc, id asc").Find(&re).Error; err != nil {
			return err
		}
		sort.SliceStable(re, func(i, j int) bool { return re[i].AccruedOn.Before(re[j].AccruedOn) })
		var sumRe, sumSaved float64
		for _, r := range re {
			sumRe += r.Interest
		}
		for _, r := range savedAcc {
			sumSaved += r.Interest
		}
		if !closeTo(sumRe, sumSaved) {
			t.Errorf("%s: saved interest rows add to %.2f, full recalculation %.2f", label, sumSaved, sumRe)
		}
		if topUpCount > 0 {
			// a top-up deducting interest from its payout splits the next period into two rows on a recalculation; the total is what matters
		} else if len(re) != len(savedAcc) {
			t.Errorf("%s: %d saved interest rows, full recalculation %d", label, len(savedAcc), len(re))
		} else {
			for i := range re {
				if !re[i].AccruedOn.Equal(savedAcc[i].AccruedOn) || !closeTo(re[i].Interest, savedAcc[i].Interest) {
					t.Errorf("%s: interest row %d saved %s %.2f, recalculated %s %.2f", label, i, savedAcc[i].AccruedOn.Format("2006-01-02"), savedAcc[i].Interest, re[i].AccruedOn.Format("2006-01-02"), re[i].Interest)
				}
			}
		}
		return errDryRun
	})
	if err != nil && !errors.Is(err, errDryRun) {
		t.Errorf("%s: full recalculation failed: %v", label, err)
	}
}

type cashLine struct {
	Mode   string
	BankID *uint
	Amount float64
	Group  string
}

func groupLines(t *testing.T, group string) []cashLine {
	t.Helper()
	var out []cashLine
	if group == "" {
		return nil
	}
	if err := config.BaseDB.Raw(`SELECT mode, bank_id, amount, transaction_group_id AS "group" FROM cash_movements WHERE transaction_group_id = ?`, group).Scan(&out).Error; err != nil {
		t.Fatal(err)
	}
	return out
}

// cashMatchesRows checks the loan's cash book against its payment rows: every cash payment's group holds lines in
// the modes (and bank) the row says that add up to the amount, and the loan has no collection line outside those.
func cashMatchesRows(t *testing.T, label string, l *ledgerLoan) {
	t.Helper()
	groups := map[string]bool{}
	for _, p := range l.payments() {
		if !isCashPaymentType(p.Type) {
			continue
		}
		if p.CashTransactionGroupID == "" {
			t.Errorf("%s: %s of %.2f on %s has no cash group", label, p.Type, p.Amount, p.PaidOn.Format("2006-01-02"))
			continue
		}
		groups[p.CashTransactionGroupID] = true
		got := map[string]float64{}
		var sum float64
		for _, ln := range groupLines(t, p.CashTransactionGroupID) {
			got[ln.Mode] += ln.Amount
			sum += ln.Amount
			if ln.Mode != "Cash" && (ln.BankID == nil || (p.BankID != nil && *ln.BankID != *p.BankID)) {
				t.Errorf("%s: %s line on the wrong bank", label, ln.Mode)
			}
		}
		for mode, want := range map[string]float64{"Cash": p.CashAmount, "UPI": p.UpiAmount, "Bank Transfer": p.BankTransferAmount} {
			if !closeTo(got[mode], want) {
				t.Errorf("%s: %s of %.2f on %s: %s lines %.2f, row says %.2f", label, p.Type, p.Amount, p.PaidOn.Format("2006-01-02"), mode, got[mode], want)
			}
		}
		if !closeTo(sum, p.Amount) {
			t.Errorf("%s: %s of %.2f: cash lines add up to %.2f", label, p.Type, p.Amount, sum)
		}
	}
	var stray []string
	if err := config.BaseDB.Raw(`SELECT DISTINCT transaction_group_id FROM cash_movements WHERE source = 'Collection' AND purpose LIKE '% — ' || ? AND transaction_group_id <> ''`, l.number).Scan(&stray).Error; err != nil {
		t.Fatal(err)
	}
	topGroups := map[string]bool{}
	var tg []string
	config.BaseDB.Raw(`SELECT cash_transaction_group_id FROM loan_top_ups WHERE loan_id = ?`, l.id).Scan(&tg)
	for _, g := range tg {
		topGroups[g] = true
	}
	for _, g := range stray {
		if !groups[g] && !topGroups[g] {
			t.Errorf("%s: collection lines in group %s belong to no payment of the loan", label, g)
		}
	}
	if n := scalarInt(t, `SELECT count(*) FROM cash_movements WHERE source = 'Collection' AND purpose LIKE '% — ' || ? AND (transaction_group_id IS NULL OR transaction_group_id = '')`, l.number); n != 0 {
		t.Errorf("%s: %d collection lines with no group", label, n)
	}
}

// editPay runs an edit through the same function the endpoint uses.
func (l *ledgerLoan) editPay(id uint, in *EditPaymentInput, dry bool) (*EditPaymentResult, error) {
	res, _, err := editLoanPayment(l.ctx, l.id, id, in, "integration test", dry)
	return res, err
}

func dayTime(l *ledgerLoan, day int) *time.Time { d := l.when(day); return &d }
