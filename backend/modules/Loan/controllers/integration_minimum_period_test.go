package controllers

// Runs the minimum-period and pay-to-date rules against a real database: the
// loans are created in a scratch copy of the app's database, paid through
// SaveLoanPayment, and read back through the same functions the pages use.
//
//	DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations go test ./modules/Loan/controllers/ -run Integration -v
//
// It refuses to run on any database not named ambikagold_scratch.

import (
	"context"
	"fmt"
	"math"
	"os"
	"sync"
	"testing"
	"time"

	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"

	"gorm.io/gorm"
)

const (
	scratchTenant   = uint(5)
	scratchTemplate = uint(221) // an Active loan of tenant 5 whose customer, branch, scheme and ornaments the clones reuse
	multipleTiers   = `[{"days":30,"rate":12},{"days":60,"rate":24},{"days":0,"rate":36}]`
)

var (
	integrationReady bool
	cloneSeq         int
)

func integrationCtx(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("DB_NAME") != "ambikagold_scratch" {
		t.Skip("integration test: set DB_NAME=ambikagold_scratch")
	}
	if !integrationReady {
		config.InitDB()
		integrationReady = true
	}
	return config.WithTenant(context.Background(), scratchTenant)
}

// cloneLoan inserts a ₹1,000 loan opened `age` days ago on the given scheme settings.
func cloneLoan(t *testing.T, method string, minimum, age int) uint {
	t.Helper()
	cloneSeq++
	y, m, d := time.Now().In(time.Local).Date()
	opened := time.Date(y, m, d-age, 0, 0, 0, 0, time.UTC)
	tiers := ""
	if method == "Multiple interest" {
		tiers = multipleTiers
	}
	number := fmt.Sprintf("TST-%d-%d", time.Now().UnixNano()%1_000_000, cloneSeq)
	var id uint
	err := config.BaseDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`CREATE TEMP TABLE tmp_loan ON COMMIT DROP AS SELECT * FROM loans WHERE id = ?`, scratchTemplate).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE tmp_loan SET id = nextval(pg_get_serial_sequence('loans','id')), loan_number = ?, status = 'Active',
			opened_date = ?, last_accrual_date = ?, due_date = ?, principal_amount = 1000, outstanding_amount = 1000,
			sanctioned_amount = 1000, disbursed_amount = 1000, accrued_interest = 0, accrued_penal_interest = 0, interest_paid = 0,
			penal_interest_paid = 0, outstanding_processing_fee = 0, service_charge_amount = 0, scheme_interest_method = ?, scheme_interest_rate = 12,
			scheme_penal_rate = 0, scheme_minimum_days = ?, scheme_rate_tiers = NULLIF(?, ''), rate_tier_level = 0, arrears_since = NULL,
			created_at = now(), updated_at = now()`,
			number, opened, opened, opened.AddDate(0, 3, 0), method, minimum, tiers).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO loans SELECT * FROM tmp_loan`).Error; err != nil {
			return err
		}
		return tx.Raw(`SELECT id FROM loans WHERE loan_number = ? AND tenant_id = ?`, number, scratchTenant).Scan(&id).Error
	})
	if err != nil || id == 0 {
		t.Fatalf("could not create the test loan: %v", err)
	}
	return id
}

func payInterest(ctx context.Context, id uint, amount float64, paidOn time.Time) error {
	_, err := SaveLoanPayment(ctx, id, PaymentInput{
		Amount: amount, Type: models.PaymentTypeInterest, PaidOn: paidOn, Method: "Cash", CashAmount: amount,
	})
	return err
}

func accrualTotals(t *testing.T, id uint) (rows int, sum float64) {
	t.Helper()
	if err := config.BaseDB.Raw(`SELECT count(*), COALESCE(sum(interest),0) FROM loan_accruals WHERE loan_id = ?`, id).Row().Scan(&rows, &sum); err != nil {
		t.Fatal(err)
	}
	return
}

func ledgerRows(t *testing.T, ctx context.Context, id uint) []LoanLedgerEntry {
	t.Helper()
	page, err := getLoanLedger(ctx, id, nil, LoanLedgerQuery{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	return page.Items
}

func near(a, b float64) bool { return math.Abs(a-b) < 0.011 }

// ₹1,000 at 12% on a monthly simple scheme, paid on day 20, 45 and 75 with a 30 and a 60 day minimum.
func TestIntegration_NormalLoanPaidOnDate(t *testing.T) {
	ctx := integrationCtx(t)
	cases := []struct {
		minimum, day int
		want         float64
	}{
		{30, 20, 10.00}, {30, 45, 14.67}, {30, 75, 24.33},
		{60, 20, 20.00}, {60, 45, 20.00}, {60, 75, 25.00},
	}
	for _, c := range cases {
		id := cloneLoan(t, "Monthly simple interest", c.minimum, c.day)
		loan, _ := findLoanByID(ctx, id)
		c.want = math.Round(normalOwed(loan.OpenedDate, sameClockAsOpened(loan, time.Now()), c.minimum)*100) / 100
		if err := payInterest(ctx, id, c.want, time.Now()); err != nil {
			t.Errorf("min %d day %d: payment failed: %v", c.minimum, c.day, err)
			continue
		}
		l, _ := findLoanByID(ctx, id)
		_, sum := accrualTotals(t, id)
		if !near(l.AccruedInterest, c.want) || !near(sum, c.want) || !near(l.InterestPaid, c.want) {
			t.Errorf("min %d day %d: accrued %.2f, ledger rows %.2f, paid %.2f, want %.2f", c.minimum, c.day, l.AccruedInterest, sum, l.InterestPaid, c.want)
		}
		t.Logf("min %d, paid day %d: owed %.2f", c.minimum, c.day, l.AccruedInterest)
		if c.minimum == 30 && c.day == 45 {
			for _, e := range ledgerRows(t, ctx, id) {
				t.Logf("   ledger  %-10s %s  %-9s %9.2f  balance %v", e.Date, e.Key, e.Kind, e.Amount, deref(e.Balance))
			}
		}
	}
}

func deref(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

// The Multiple-interest ladder, 30 days at 12%, 60 at 24%, then 36%.
func TestIntegration_MultipleLoanPaidOnDate(t *testing.T) {
	ctx := integrationCtx(t)
	want := map[int]map[int]float64{
		30: {20: 9.86, 45: 29.59, 75: 49.32, 100: 98.63},
		60: {20: 39.45, 45: 39.45, 75: 49.32, 100: 98.63},
		90: {20: 59.18, 45: 59.18, 75: 59.18, 100: 98.63},
	}
	for _, minimum := range []int{30, 60, 90} {
		for _, day := range []int{20, 45, 75, 100} {
			id := cloneLoan(t, "Multiple interest", minimum, day)
			w := want[minimum][day]
			if err := payInterest(ctx, id, w, time.Now()); err != nil {
				t.Errorf("min %d day %d: payment failed: %v", minimum, day, err)
				continue
			}
			l, _ := findLoanByID(ctx, id)
			_, sum := accrualTotals(t, id)
			if !near(l.AccruedInterest, w) || !near(sum, w) {
				t.Errorf("min %d day %d: accrued %.2f, ledger rows %.2f, want %.2f", minimum, day, l.AccruedInterest, sum, w)
			}
			t.Logf("multiple, min %d, paid day %d: owed %.2f (tier level after payment %d)", minimum, day, l.AccruedInterest, l.RateTierLevel)
		}
	}
}

// A payment that is rejected leaves no interest behind.
func TestIntegration_RejectedPaymentLeavesNothingBehind(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 45)
	if err := payInterest(ctx, id, 5000, time.Now()); err == nil {
		t.Fatal("a payment far above what is owed should be rejected")
	}
	l, _ := findLoanByID(ctx, id)
	rows, _ := accrualTotals(t, id)
	var payments int
	_ = config.BaseDB.Raw(`SELECT count(*) FROM loan_payments WHERE loan_id = ?`, id).Row().Scan(&payments)
	if l.AccruedInterest != 0 || rows != 0 || payments != 0 || !l.LastAccrualDate.Equal(l.OpenedDate) {
		t.Fatalf("rejected payment left accrued %.2f, %d ledger rows, %d payments, charge date %s", l.AccruedInterest, rows, payments, l.LastAccrualDate)
	}
	t.Log("rejected payment: nothing saved")
}

// Opening the loan page, however often, saves nothing; what is owed on a day does not depend on views.
func TestIntegration_PageViewsSaveNothingAndChangeNothing(t *testing.T) {
	ctx := integrationCtx(t)
	for _, age := range []int{20, 45} {
		viewed := cloneLoan(t, "Monthly simple interest", 30, age)
		untouched := cloneLoan(t, "Monthly simple interest", 30, age)
		var shown []float64
		for i := 0; i < 3; i++ {
			l, err := GetLoan(ctx, viewed, nil)
			if err != nil {
				t.Fatal(err)
			}
			shown = append(shown, l.OutstandingInterest)
		}
		rows, _ := accrualTotals(t, viewed)
		saved, _ := findLoanByID(ctx, viewed)
		if age < 30 && (rows != 0 || saved.AccruedInterest != 0) {
			t.Errorf("age %d: viewing saved %d ledger rows / %.2f interest", age, rows, saved.AccruedInterest)
		}
		if shown[0] != shown[1] || shown[1] != shown[2] {
			t.Errorf("age %d: refreshing changed the figure: %v", age, shown)
		}
		_ = payInterest(ctx, viewed, shown[0], time.Now())
		if err := payInterest(ctx, untouched, shown[0], time.Now()); err != nil {
			t.Errorf("age %d: payment on the untouched loan failed: %v", age, err)
		}
		a, _ := findLoanByID(ctx, viewed)
		b, _ := findLoanByID(ctx, untouched)
		if !near(a.AccruedInterest, b.AccruedInterest) || !near(a.AccruedInterest, shown[0]) {
			t.Errorf("age %d: viewed loan owes %.2f, untouched %.2f, page showed %.2f", age, a.AccruedInterest, b.AccruedInterest, shown[0])
		}
		t.Logf("age %d days: page showed %.2f on 3 refreshes; paid → viewed loan %.2f, never-viewed loan %.2f", age, shown[0], a.AccruedInterest, b.AccruedInterest)
	}
}

// Two payments arriving together charge the days once.
func TestIntegration_ConcurrentPaymentsChargeOnce(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 45)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = payInterest(ctx, id, 7, time.Now())
		}(i)
	}
	wg.Wait()
	l, _ := findLoanByID(ctx, id)
	rows, sum := accrualTotals(t, id)
	t.Logf("concurrent: errors %v, accrued %.2f, %d ledger rows totalling %.2f, interest paid %.2f", errs, l.AccruedInterest, rows, sum, l.InterestPaid)
	if !near(l.AccruedInterest, 14.67) || !near(sum, 14.67) {
		t.Errorf("two simultaneous payments charged %.2f / %.2f, want 14.67 once", l.AccruedInterest, sum)
	}
	if errs[0] != nil || errs[1] != nil {
		t.Errorf("both payments fit within what is owed, got %v", errs)
	}
}

// The migration: every scheme and loan that existed when it ran carries at least 30 minimum days (later ones may choose less).
func TestIntegration_MigrationSetMinimumDays(t *testing.T) {
	integrationCtx(t)
	var s, l, longest int
	_ = config.BaseDB.Raw(`SELECT count(*) FROM schemes WHERE minimum_days < 30 AND created_at < (SELECT applied_at FROM gorp_migrations WHERE id LIKE '0046%')`).Row().Scan(&s)
	_ = config.BaseDB.Raw(`SELECT count(*) FROM loans WHERE scheme_minimum_days < 30 AND created_at < (SELECT applied_at FROM gorp_migrations WHERE id LIKE '0046%')`).Row().Scan(&l)
	_ = config.BaseDB.Raw(`SELECT COALESCE(max(scheme_minimum_days),0) FROM loans`).Row().Scan(&longest)
	if s != 0 || l != 0 {
		t.Errorf("%d schemes and %d loans still below 30 days", s, l)
	}
	t.Logf("schemes below 30: %d, loans below 30: %d, longest minimum kept: %d", s, l, longest)
}

// Every loan already in the database loads, shows a sensible figure, and loading it again saves nothing more.
func TestIntegration_ExistingLoansLoadAndAreStable(t *testing.T) {
	integrationCtx(t)
	type row struct {
		ID     uint
		Tenant uint
	}
	var loans []row
	if err := config.BaseDB.Raw(`SELECT id, tenant_id AS tenant FROM loans WHERE loan_number NOT LIKE 'TST-%' ORDER BY tenant_id, id`).Scan(&loans).Error; err != nil {
		t.Fatal(err)
	}
	for _, r := range loans {
		ctx := config.WithTenant(context.Background(), r.Tenant)
		first, err := GetLoan(ctx, r.ID, nil)
		if err != nil {
			t.Errorf("loan %d: %v", r.ID, err)
			continue
		}
		rowsBefore, _ := accrualTotals(t, r.ID)
		second, _ := GetLoan(ctx, r.ID, nil)
		rowsAfter, _ := accrualTotals(t, r.ID)
		if rowsAfter != rowsBefore || !near(first.OutstandingInterest, second.OutstandingInterest) || first.OutstandingInterest < 0 {
			t.Errorf("loan %s: second load changed things: rows %d→%d, interest %.2f→%.2f", first.LoanNumber, rowsBefore, rowsAfter, first.OutstandingInterest, second.OutstandingInterest)
		}
		t.Logf("tenant %d %-9s %-23s %-16s min %2d  posted %9.2f  owed to date %9.2f", r.Tenant, first.LoanNumber, first.SchemeInterestMethod, first.Status, first.SchemeMinimumDays, first.AccruedInterest, first.OutstandingInterest+first.InterestPaid)
	}
	t.Logf("%d existing loans checked", len(loans))
}

// normalOwed is what a monthly simple loan of ₹1,000 at 12% owes on `today`: the first period (a month, or the minimum if
// that is longer) in full, whole months after it, then a part month by days; inside the first period, the days so far but
// never less than the minimum. Worked out from the dates, so it holds whatever day the test runs on.
func normalOwed(opened, today time.Time, minimum int) float64 {
	const monthly = 10.0
	days := func(a, b time.Time) float64 { return math.Round(b.Sub(a).Hours() / 24) }
	monthEnd := addMonths(opened, 1)
	minEnd := opened.AddDate(0, 0, minimum)
	first, owed := monthEnd, monthly
	if minEnd.After(monthEnd) {
		first, owed = minEnd, float64(minimum)/30*monthly
	}
	if today.Before(first) {
		return math.Max(days(opened, today), float64(minimum)) / 30 * monthly
	}
	from := first
	for !addMonths(from, 1).After(today) {
		owed += monthly
		from = addMonths(from, 1)
	}
	return owed + days(from, today)/30*monthly
}

// A rate step restates the rows already saved. ₹10,000, 30 days at 12%, 60 at 24%, then 36%, unpaid for 105 days:
// the page is opened twice (days 30, then 60 and 90 are saved), then the loan is paid.
func TestIntegration_RateStepRestatesSavedRows(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Multiple interest", 30, 105)
	if err := config.BaseDB.Exec(`UPDATE loans SET principal_amount = 10000, outstanding_amount = 10000, sanctioned_amount = 10000, disbursed_amount = 10000 WHERE id = ?`, id).Error; err != nil {
		t.Fatal(err)
	}
	readRows := func() []float64 {
		var out []float64
		if err := config.BaseDB.Raw(`SELECT interest FROM loan_accruals WHERE loan_id = ? ORDER BY accrued_on, id`, id).Scan(&out).Error; err != nil {
			t.Fatal(err)
		}
		return out
	}
	if _, err := GetLoan(ctx, id, nil); err != nil {
		t.Fatal(err)
	}
	if rows := readRows(); len(rows) != 1 || !near(rows[0], 98.63) {
		t.Fatalf("after the first view: %v, want one row of 98.63 (30 days at 12%%)", rows)
	}
	if _, err := GetLoan(ctx, id, nil); err != nil {
		t.Fatal(err)
	}
	rows := readRows()
	t.Logf("after the second view (loan on the 24%% step): %v", rows)
	if len(rows) != 3 || !near(rows[0], 197.26) || !near(rows[1], 197.26) || !near(rows[2], 197.26) {
		t.Fatalf("the first row should have been restated to 24%%: got %v, want three rows of 197.26", rows)
	}
	if err := payInterest(ctx, id, 1035.62, time.Now()); err != nil {
		t.Fatalf("payment failed: %v", err)
	}
	rows = readRows()
	t.Logf("after paying on day 105 (loan on the 36%% step): %v", rows)
	if len(rows) != 4 || !near(rows[0], 295.89) || !near(rows[1], 295.89) || !near(rows[2], 295.89) || !near(rows[3], 147.95) {
		t.Fatalf("got %v, want 295.89, 295.89, 295.89, 147.95", rows)
	}
	l, _ := findLoanByID(ctx, id)
	var sum float64
	for _, r := range rows {
		sum += r
	}
	if !near(sum, l.AccruedInterest) || !near(l.AccruedInterest, 1035.62) || !near(l.InterestPaid, 1035.62) {
		t.Errorf("rows add to %.2f, loan accrued %.2f, paid %.2f, want 1035.62 (105 days at 36%%)", sum, l.AccruedInterest, l.InterestPaid)
	}
	for _, e := range ledgerRows(t, ctx, id) {
		t.Logf("   ledger  %-10s %-12s %-9s %9.2f  balance %v", e.Date, e.Key, e.Kind, e.Amount, deref(e.Balance))
	}
}

// Rows saved together all carry the business: a batch insert used to stamp only its first row.
func TestIntegration_BatchInsertStampsEveryRow(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 5)
	opened := time.Now()
	rows := []models.LoanAccrual{
		{LoanID: id, AccruedOn: opened, Interest: 1},
		{LoanID: id, AccruedOn: opened, Interest: 2},
		{LoanID: id, AccruedOn: opened, Interest: 3},
	}
	if err := config.DB.WithContext(ctx).Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	var wrong int
	_ = config.BaseDB.Raw(`SELECT count(*) FROM loan_accruals WHERE loan_id = ? AND tenant_id <> ?`, id, scratchTenant).Row().Scan(&wrong)
	if wrong != 0 {
		t.Fatalf("%d of 3 batch rows were saved without the business", wrong)
	}
}

// A loan opened today on a scheme with a 15 day minimum shows, and takes, the minimum period's interest today.
func TestIntegration_LoanOpenedTodayShowsAndTakesTheMinimum(t *testing.T) {
	ctx := integrationCtx(t)
	for _, method := range []string{"Multiple interest", "Monthly simple interest"} {
		id := cloneLoan(t, method, 15, 0)
		if err := config.BaseDB.Exec(`UPDATE loans SET principal_amount = 10000, outstanding_amount = 10000, sanctioned_amount = 10000, disbursed_amount = 10000, scheme_rate_tiers = CASE WHEN scheme_interest_method = 'Multiple interest' THEN '[{"days":30,"rate":12},{"days":0,"rate":60}]' ELSE NULL END WHERE id = ?`, id).Error; err != nil {
			t.Fatal(err)
		}
		want := 49.32 // 15 days at 12% on 10,000
		if method != "Multiple interest" {
			want = 50.00 // 15 of 30 days of a month at 1%
		}
		l, err := GetLoan(ctx, id, nil)
		if err != nil {
			t.Fatal(err)
		}
		if !near(l.OutstandingInterest, want) || !near(l.TotalOutstandingBalance, 10000+want) {
			t.Errorf("%s: page shows interest %.2f / settlement %.2f, want %.2f / %.2f", method, l.OutstandingInterest, l.TotalOutstandingBalance, want, 10000+want)
		}
		if rows, _ := accrualTotals(t, id); rows != 0 {
			t.Errorf("%s: opening the page saved %d ledger rows", method, rows)
		}
		if err := payInterest(ctx, id, want, time.Now()); err != nil {
			t.Errorf("%s: payment failed: %v", method, err)
			continue
		}
		rows, sum := accrualTotals(t, id)
		t.Logf("%s opened today: page showed %.2f; after paying, %d ledger row(s) totalling %.2f", method, l.OutstandingInterest, rows, sum)
		if rows != 1 || !near(sum, want) {
			t.Errorf("%s: payment saved %d rows totalling %.2f, want one row of %.2f", method, rows, sum, want)
		}
	}
}

func accruingRows(rows []LoanLedgerEntry) (n int, sum float64) {
	for _, e := range rows {
		if e.Accruing && e.Kind == "interest" {
			n++
			sum += e.Amount
		}
	}
	return
}

// The ledger runs up to the day it is opened with interest that is not saved, recalculated on each visit.
func TestIntegration_LedgerShowsInterestToDateWithoutSavingIt(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Multiple interest", 15, 20)
	_ = config.BaseDB.Exec(`UPDATE loans SET principal_amount = 10000, outstanding_amount = 10000, sanctioned_amount = 10000, disbursed_amount = 10000, scheme_rate_tiers = '[{"days":30,"rate":12},{"days":0,"rate":60}]' WHERE id = ?`, id).Error
	saved := func() (int, float64) {
		var rows int
		var accrued float64
		_ = config.BaseDB.Raw(`SELECT (SELECT count(*) FROM loan_accruals WHERE loan_id = ?), accrued_interest FROM loans WHERE id = ?`, id, id).Row().Scan(&rows, &accrued)
		return rows, accrued
	}

	// day 20: 20 days at 12% on ₹10,000
	rows := ledgerRows(t, ctx, id)
	n, sum := accruingRows(rows)
	if n != 1 || !near(sum, 65.75) {
		t.Fatalf("day 20: %d accruing row(s) totalling %.2f, want one of 65.75", n, sum)
	}
	if r, a := saved(); r != 0 || a != 0 {
		t.Fatalf("opening the ledger saved %d rows / %.2f interest", r, a)
	}
	last := rows[len(rows)-1]
	if !last.Accruing || !near(deref(last.Balance), 10065.75) {
		t.Errorf("last ledger row: accruing %v balance %.2f, want an accruing row at 10065.75", last.Accruing, deref(last.Balance))
	}
	if again := ledgerRows(t, ctx, id); len(again) != len(rows) {
		t.Errorf("opening it again changed the rows: %d → %d", len(rows), len(again))
	}
	t.Logf("day 20: ledger ends with Interest %.2f (accruing), balance %.2f; saved rows 0", last.Amount, deref(last.Balance))

	// the same loan five days later: opened 25 days ago
	_ = config.BaseDB.Exec(`UPDATE loans SET opened_date = opened_date - interval '5 days', last_accrual_date = last_accrual_date - interval '5 days', due_date = due_date - interval '5 days' WHERE id = ?`, id).Error
	n, sum = accruingRows(ledgerRows(t, ctx, id))
	if n != 1 || !near(sum, 82.19) {
		t.Fatalf("day 25: %d accruing row(s) totalling %.2f, want one of 82.19", n, sum)
	}
	if r, _ := saved(); r != 0 {
		t.Fatalf("day 25: opening the ledger saved %d rows", r)
	}
	t.Logf("day 25: Interest %.2f (recalculated from that day), saved rows still 0", sum)

	// paying saves it as a real row and the accruing row is gone
	if err := payInterest(ctx, id, 82.19, time.Now()); err != nil {
		t.Fatalf("payment failed: %v", err)
	}
	after := ledgerRows(t, ctx, id)
	n, _ = accruingRows(after)
	if r, _ := saved(); n != 0 || r != 1 {
		t.Errorf("after payment: %d accruing rows, %d saved rows, want 0 and 1", n, r)
	}
}

// A normal loan: the first charge and the part month after it, both unsaved, end at the settlement figure.
func TestIntegration_LedgerEndsAtTheSettlementAmount(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 45)
	rows := ledgerRows(t, ctx, id)
	n, sum := accruingRows(rows)
	last := rows[len(rows)-1]
	l, err := GetLoan(ctx, id, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("normal loan, 45 days: %d accruing row(s) totalling %.2f, last balance %.2f; page settlement %.2f", n, sum, deref(last.Balance), l.TotalOutstandingBalance)
	if !near(deref(last.Balance), l.TotalOutstandingBalance) || !near(sum, l.OutstandingInterest) {
		t.Errorf("ledger ends at %.2f with %.2f interest, the page shows settlement %.2f and interest %.2f", deref(last.Balance), sum, l.TotalOutstandingBalance, l.OutstandingInterest)
	}
}
