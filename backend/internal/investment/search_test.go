package investment

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

// recordSQL runs fn against a Postgres-dialect DryRun *gorm.DB that never
// connects (the same no-database construction internal/app's isolation
// test uses) and returns every statement GORM built, vars inlined.
func recordSQL(t *testing.T, fn func(db *gorm.DB)) string {
	t.Helper()
	sqlDB, err := sql.Open("pgx", "postgres://harness@127.0.0.1:1/unused")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true, Logger: logger.Discard})
	if err != nil {
		t.Fatalf("gorm.Open: %v", err)
	}
	var out []string
	capture := func(d *gorm.DB) {
		out = append(out, d.Dialector.Explain(d.Statement.SQL.String(), d.Statement.Vars...))
	}
	_ = db.Callback().Query().After("gorm:query").Register("test:capture", capture)
	_ = db.Callback().Row().After("gorm:row").Register("test:capture_row", capture)
	fn(db)
	return strings.Join(out, "\n")
}

func assertSQLContains(t *testing.T, got string, wants ...string) {
	t.Helper()
	for _, w := range wants {
		if !strings.Contains(got, w) {
			t.Errorf("SQL missing %q:\n%s", w, got)
		}
	}
}

func TestFindAllSearchMatchesCustomerCodeAndQualifiesBranch(t *testing.T) {
	branch := uint(2)
	got := recordSQL(t, func(db *gorm.DB) {
		_, _, _ = NewRepository(db).FindAll(context.Background(), ListFilter{Query: "C-9", BranchID: &branch, Limit: 10})
	})
	assertSQLContains(t, got, "customers.code ILIKE '%C-9%'", "investments.branch_id = 2")
}

func TestFindAllPlansSearchAndPaging(t *testing.T) {
	got := recordSQL(t, func(db *gorm.DB) {
		_, _, _ = NewRepository(db).FindAllPlans(context.Background(), true, "gold", 5, 10)
	})
	assertSQLContains(t, got, "name ILIKE '%gold%'", "is_active = true", "LIMIT 5", "OFFSET 10", "count(*)")
}
