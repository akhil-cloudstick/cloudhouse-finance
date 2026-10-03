package loan

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// dryRunDB returns a Postgres-dialect *gorm.DB that never connects — the
// same no-database construction internal/app's isolation test uses to build
// the router — in DryRun mode, so tests can assert on generated SQL.
func dryRunDB(t *testing.T) *gorm.DB {
	t.Helper()
	sqlDB, err := sql.Open("pgx", "postgres://harness@127.0.0.1:1/unused")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db, err := gorm.Open(
		postgres.New(postgres.Config{Conn: sqlDB}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true, Logger: logger.Discard},
	)
	if err != nil {
		t.Fatalf("gorm.Open: %v", err)
	}
	return db
}

func loanFilterSQL(t *testing.T, f LoanFilter) string {
	t.Helper()
	db := dryRunDB(t)
	return db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		var out []Loan
		return applyFilters(tx.Model(&Loan{}), f).Find(&out)
	})
}

func TestApplyFiltersSearchMatchesCustomerCodeAndQualifiesColumns(t *testing.T) {
	scope := uint(7)
	got := loanFilterSQL(t, LoanFilter{Query: "C-0042", BranchScope: &scope, Status: StatusActive})
	for _, want := range []string{
		"JOIN customers ON customers.id = loans.customer_id",
		"customers.code ILIKE",
		"loans.loan_number ILIKE",
		"loans.branch_id = 7",
		"loans.status = 'Active'",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("SQL missing %q:\n%s", want, got)
		}
	}
	// customers also has branch_id — an unqualified reference is ambiguous.
	if strings.Contains(got, "AND branch_id") || strings.Contains(got, "(branch_id") {
		t.Errorf("branch_id must be table-qualified:\n%s", got)
	}
}

func TestApplyFiltersDueTodayAndDefaulted(t *testing.T) {
	got := loanFilterSQL(t, LoanFilter{DueToday: true})
	if !strings.Contains(got, "loans.due_date >=") || !strings.Contains(got, "loans.due_date <") ||
		!strings.Contains(got, "'Active','Due Soon','Overdue'") {
		t.Errorf("DueToday SQL unexpected:\n%s", got)
	}
	got = loanFilterSQL(t, LoanFilter{OnlyDefaulted: true})
	if !strings.Contains(got, "loans.status NOT IN ('Closed','Rejected','Auctioned')") || !strings.Contains(got, "loans.due_date <") {
		t.Errorf("OnlyDefaulted SQL unexpected:\n%s", got)
	}
	got = loanFilterSQL(t, LoanFilter{AllAuctionCases: true})
	if !strings.Contains(got, "loans.status IN ('Auction Eligible','Auctioned - Balance Due')") ||
		!strings.Contains(got, "loans.status NOT IN ('Closed','Rejected','Auctioned') AND loans.due_date <") {
		t.Errorf("AllAuctionCases SQL unexpected:\n%s", got)
	}
}

func TestIsAuctionCase(t *testing.T) {
	for _, l := range []Loan{{Status: StatusAuctionEligible}, {Status: StatusAuctionedBalanceDue}, {Status: StatusOverdue, IsDefaulted: true}} {
		if !isAuctionCase(&l) {
			t.Errorf("%+v should be an auction case", l)
		}
	}
	if isAuctionCase(&Loan{Status: StatusOverdue}) {
		t.Error("plain overdue loan is not an auction case")
	}
}

func TestApplyStatusParamAndAuctionCase(t *testing.T) {
	var f LoanFilter
	applyStatusParam(&f, "due today")
	if !f.DueToday || f.Status != "" {
		t.Fatalf("Due Today not derived: %+v", f)
	}
	f = LoanFilter{}
	applyStatusParam(&f, "Overdue")
	if f.Status != StatusOverdue || f.DueToday {
		t.Fatalf("stored status not passed through: %+v", f)
	}

	cases := map[string]LoanFilter{
		"eligible":              {Status: StatusAuctionEligible},
		"auctioned_balance_due": {Status: StatusAuctionedBalanceDue},
		"defaulted":             {OnlyDefaulted: true},
	}
	for in, want := range cases {
		f := LoanFilter{Status: StatusActive, DueToday: true}
		if !applyAuctionCase(&f, in) {
			t.Fatalf("%s rejected", in)
		}
		if f.Status != want.Status || f.OnlyDefaulted != want.OnlyDefaulted || f.DueToday {
			t.Errorf("%s: got %+v", in, f)
		}
	}
	all := LoanFilter{Status: StatusActive, DueToday: true}
	if !applyAuctionCase(&all, "all") || !all.AllAuctionCases || all.Status != "" || all.DueToday {
		t.Errorf("all: got %+v", all)
	}
	if applyAuctionCase(&LoanFilter{}, "bogus") {
		t.Error("unknown auctionCase accepted")
	}
	if !applyAuctionCase(&LoanFilter{}, "") {
		t.Error("empty auctionCase must be a no-op")
	}
}

func TestPageKept(t *testing.T) {
	loans := []Loan{{ID: 1, IsDefaulted: true}, {ID: 2}, {ID: 3, IsDefaulted: true}, {ID: 4, IsDefaulted: true}}
	page, total := pageKept(append([]Loan(nil), loans...), 2, 1, func(l *Loan) bool { return l.IsDefaulted })
	if total != 3 || len(page) != 2 || page[0].ID != 3 || page[1].ID != 4 {
		t.Fatalf("got total=%d page=%+v", total, page)
	}
	all, total := pageKept(append([]Loan(nil), loans...), 0, 0, func(l *Loan) bool { return l.IsDefaulted })
	if total != 3 || len(all) != 3 {
		t.Fatalf("unpaged: total=%d len=%d", total, len(all))
	}
	empty, total := pageKept(append([]Loan(nil), loans...), 5, 10, func(l *Loan) bool { return l.IsDefaulted })
	if total != 3 || len(empty) != 0 {
		t.Fatalf("past end: total=%d len=%d", total, len(empty))
	}
}

// sqlRecorder is a DryRun DB plus every statement GORM built on it (vars
// inlined), so the real repository methods can be exercised end to end.
type sqlRecorder struct {
	db  *gorm.DB
	sql []string
}

func newSQLRecorder(t *testing.T) *sqlRecorder {
	t.Helper()
	rec := &sqlRecorder{db: dryRunDB(t)}
	capture := func(d *gorm.DB) {
		rec.sql = append(rec.sql, d.Dialector.Explain(d.Statement.SQL.String(), d.Statement.Vars...))
	}
	if err := rec.db.Callback().Query().After("gorm:query").Register("test:capture", capture); err != nil {
		t.Fatal(err)
	}
	if err := rec.db.Callback().Row().After("gorm:row").Register("test:capture_row", capture); err != nil {
		t.Fatal(err)
	}
	return rec
}

func (r *sqlRecorder) all() string { return strings.Join(r.sql, "\n") }

func assertContains(t *testing.T, got string, wants ...string) {
	t.Helper()
	for _, w := range wants {
		if !strings.Contains(got, w) {
			t.Errorf("SQL missing %q:\n%s", w, got)
		}
	}
}

func TestLoanRequestFindAllSearchAndType(t *testing.T) {
	rec := newSQLRecorder(t)
	scope := uint(3)
	_, _, _ = (&LoanRequestRepository{db: rec.db}).FindAll(context.Background(), LoanRequestFilter{
		Query: "LN-1", Type: RequestTypeRelease, BranchID: &scope, Limit: 11,
	})
	assertContains(t, rec.all(),
		"JOIN loans ON loans.id = loan_requests.loan_id",
		"JOIN customers ON customers.id = loans.customer_id",
		"customers.code ILIKE '%LN-1%'",
		"loan_requests.type = 'Release'",
		"loans.branch_id = 3",
	)
	if n := strings.Count(rec.sql[len(rec.sql)-1], "JOIN loans"); n != 1 {
		t.Errorf("loans joined %d times", n)
	}
}

func TestCustomerSubTableSearch(t *testing.T) {
	ctx := context.Background()
	rec := newSQLRecorder(t)
	_, _, _ = (&OrnamentRepository{db: rec.db}).FindByCustomerID(ctx, 9, nil, nil, "ring", 10, 0)
	assertContains(t, rec.all(), "ornaments.name ILIKE '%ring%'", "loans.loan_number ILIKE '%ring%'")

	rec = newSQLRecorder(t)
	_, _, _ = (&PaymentRepository{db: rec.db}).FindByCustomerIDForProfile(ctx, 9, nil, nil, "upi", 10, 0)
	assertContains(t, rec.all(), "loan_payments.type ILIKE '%upi%'", "loan_payments.method ILIKE '%upi%'")

	rec = newSQLRecorder(t)
	_, _, _ = (&BankPledgeRepository{db: rec.db}).FindAllByCustomerID(ctx, 9, nil, nil, "sbi", 10, 0)
	assertContains(t, rec.all(), "bank_pledge_records.bank_name ILIKE '%sbi%'")

	rec = newSQLRecorder(t)
	_, _, _ = (&AuctionRepository{db: rec.db}).FindAllByCustomerID(ctx, 9, nil, nil, "AR-9", 10, 0)
	assertContains(t, rec.all(), "auction_records.auction_reference_number ILIKE '%AR-9%'")
}

func TestHistorySearchesMatchCustomerCode(t *testing.T) {
	ctx := context.Background()
	rec := newSQLRecorder(t)
	_, _, _ = (&BankPledgeRepository{db: rec.db}).FindAllHistory(ctx, nil, "C-7", 10, 0)
	assertContains(t, rec.all(), "customers.code ILIKE '%C-7%'")

	rec = newSQLRecorder(t)
	_, _, _ = (&AuctionRepository{db: rec.db}).FindAllConcluded(ctx, nil, nil, "C-7", 10, 0)
	assertContains(t, rec.all(), "customers.code ILIKE '%C-7%'")
}
