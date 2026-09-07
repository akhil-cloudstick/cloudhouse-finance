package platform

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"gorm.io/gorm"
)

// Regression tests for the automatic tenant filter, run against a real
// database because GORM's statement building needs a live dialector — a
// dry-run session still resolves its connection at Open.
//
// Skipped unless MT_TEST_DB names a scratch database, so `go test ./...`
// stays green on a machine with no Postgres:
//
//	MT_TEST_DB=mt_probe go test ./internal/platform/ -run TenantScopeSQL -v
//
// These assert the generated SQL rather than row counts, so they need the
// schema but no fixture data.
func openScopedTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run tenant-scope SQL tests")
	}
	t.Setenv("DB_NAME", name)

	db, err := NewDatabase(LoadConfig())
	if err != nil {
		t.Skipf("cannot reach test database %q: %v", name, err)
	}
	if err := RegisterTenantScope(db); err != nil {
		t.Fatalf("registering tenant scope: %v", err)
	}
	return db
}

// TestTenantScopeSQLShapes covers every query shape the codebase actually
// produces.
//
// The "aliased" cases are the ones that matter most. db.Table("loans l") is
// how all 16 report queries are built, and GORM parses that alias out and
// sets Statement.Table to "l" — so a filter that reads Statement.Table alone
// looks up a table named "l", finds it is not tenant-owned, and returns
// every business's rows WITH NO FILTER AND NO ERROR. That was a real bug
// here, caught only by inspecting generated SQL. It is silent by nature, so
// it needs a test that reads the SQL.
func TestTenantScopeSQLShapes(t *testing.T) {
	db := openScopedTestDB(t)
	ctx := WithTenant(context.Background(), 7)

	cases := []struct {
		name  string
		build func(tx *gorm.DB) *gorm.DB
		want  string
	}{
		{
			name:  "plain table",
			build: func(tx *gorm.DB) *gorm.DB { var n int64; return tx.Table("loans").Count(&n) },
			want:  `"loans"."tenant_id" = 7`,
		},
		{
			name:  "aliased table",
			build: func(tx *gorm.DB) *gorm.DB { var n int64; return tx.Table("loans l").Count(&n) },
			want:  `"l"."tenant_id" = 7`,
		},
		{
			name: "aliased table with joins (the reports shape)",
			build: func(tx *gorm.DB) *gorm.DB {
				var n int64
				return tx.Table("loans l").
					Joins("JOIN customers c ON c.id = l.customer_id").
					Joins("LEFT JOIN loan_payments p ON p.loan_id = l.id").
					Count(&n)
			},
			want: `"l"."tenant_id" = 7`,
		},
		{
			name: "existing where clause is preserved",
			build: func(tx *gorm.DB) *gorm.DB {
				var n int64
				return tx.Table("loans").Where("status = ?", "Active").Count(&n)
			},
			want: `"loans"."tenant_id" = 7`,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sql := db.WithContext(ctx).ToSQL(c.build)
			if !strings.Contains(sql, c.want) {
				t.Errorf("tenant predicate missing.\n  want substring: %s\n  got SQL: %s", c.want, sql)
			}
		})
	}
}

// A global table must be left alone, or seeding and login break.
func TestTenantScopeSkipsGlobalTables(t *testing.T) {
	db := openScopedTestDB(t)
	sql := db.WithContext(context.Background()).ToSQL(func(tx *gorm.DB) *gorm.DB {
		var n int64
		return tx.Table("permissions").Count(&n)
	})
	if strings.Contains(sql, "tenant_id") {
		t.Errorf("global table was tenant-filtered: %s", sql)
	}
}

// The absence of a tenant must be an error, never an unfiltered query. This
// is the difference between a loud failure in development and a quiet
// cross-business read in production.
func TestTenantScopeRefusesQueryWithoutTenant(t *testing.T) {
	db := openScopedTestDB(t)
	var n int64
	err := db.WithContext(context.Background()).Table("loans").Count(&n).Error
	if err == nil {
		t.Fatal("query on a tenant-owned table succeeded with no tenant in context")
	}
	if !strings.Contains(err.Error(), "no tenant in context") {
		t.Errorf("unexpected error: %v", err)
	}
}

// The opt-out has to work, or migrations and the superadmin console cannot run.
func TestTenantScopeCrossTenantOptOut(t *testing.T) {
	db := openScopedTestDB(t)
	sql := db.WithContext(AllowCrossTenant(context.Background())).ToSQL(func(tx *gorm.DB) *gorm.DB {
		var n int64
		return tx.Table("loans").Count(&n)
	})
	if strings.Contains(sql, "tenant_id") {
		t.Errorf("AllowCrossTenant still filtered: %s", sql)
	}
}

// TestEveryTenantScopedModelIsFiltered compares the filter's table set
// against the database itself.
//
// This is the test that catches the failure the pinned-count test cannot: a
// table that HAS a tenant_id column — so it plainly holds one business's
// data — but is missing from tenantScopedTables, and is therefore served to
// everyone unfiltered, silently and with no error.
//
// That exact bug shipped with `uploaded_files`: the table was created, rows
// carried a tenant, every existing test passed, and one business could read
// another's customer photos and KYC documents. Comparing against the schema
// rather than against a hand-maintained list is what makes it impossible to
// forget.
func TestEveryTenantScopedModelIsFiltered(t *testing.T) {
	db := openScopedTestDB(t)

	var withTenantColumn []string
	err := db.WithContext(AllowCrossTenant(context.Background())).Raw(`
		SELECT table_name FROM information_schema.columns
		WHERE table_schema = 'public' AND column_name = 'tenant_id'
		ORDER BY table_name`).Scan(&withTenantColumn).Error
	if err != nil {
		t.Fatalf("listing tables with a tenant_id column: %v", err)
	}
	if len(withTenantColumn) == 0 {
		t.Skip("test database has no tenant_id columns — run the migration first")
	}

	// `sequences` carries tenant_id as part of its primary key but is
	// allocation bookkeeping, not business data, and is read by the
	// allocator outside any request.
	//
	// `superadmin_audit_logs` carries tenant_id too, but as a REFERENCE — which
	// business an entry is ABOUT — not an ownership marker. The row itself
	// belongs to no business at all: it is the superadmin's own record, written
	// by a superadmin user who is not scoped to any tenant, and the superadmin
	// console's entire purpose is reading across every one of them at once
	// (see internal/superadmin's package doc comment). Scoping it would silently
	// hide every OTHER business's audit entries from the one query that is
	// supposed to show all of them.
	exempt := map[string]bool{"sequences": true, "superadmin_audit_logs": true, "usage_counters": true}

	for _, table := range withTenantColumn {
		if exempt[table] {
			continue
		}
		if !tenantScopedTables[table] {
			t.Errorf("table %q has a tenant_id column but is NOT in tenantScopedTables — "+
				"every query against it is returning every business's rows, "+
				"with no filter and no error", table)
		}
	}
}

// TestTenantScopeCoversEveryExecutionPath asserts the predicate appears no
// matter WHICH of GORM's execution paths a query takes.
//
// This is the test that was missing, and its absence was a cross-business
// leak. GORM does not run every read through one callback chain: .Find() and
// .Count() go through Query, while .Scan(), .Pluck(), .Row() and .Rows() go
// through Row — a different chain entirely. The filter was registered on
// Query, Update, Delete and Create, which reads as exhaustive and is not, so
// every .Scan() ran with NO tenant predicate and NO ErrNoTenantInContext,
// because the callback that raises it never fired.
//
// All 16 report endpoints are built with .Scan(). Every one of them returned
// every business's rows. The SQL-shape tests above could not catch it: they
// assert on .Count(), which is a Query.
//
// Asserting per execution path, rather than per query shape, is what makes
// the coverage checkable instead of assumed.
func TestTenantScopeCoversEveryExecutionPath(t *testing.T) {
	db := openScopedTestDB(t)
	ctx := WithTenant(context.Background(), 7)
	const want = `"l"."tenant_id" = 7`

	type row struct {
		LoanID uint
	}

	cases := []struct {
		path  string
		build func(tx *gorm.DB) *gorm.DB
	}{
		{
			path: "Count (Query chain)",
			build: func(tx *gorm.DB) *gorm.DB {
				var n int64
				return tx.Table("loans l").Count(&n)
			},
		},
		{
			path: "Find (Query chain)",
			build: func(tx *gorm.DB) *gorm.DB {
				var rows []row
				return tx.Table("loans l").Select("l.id as loan_id").Find(&rows)
			},
		},
		{
			// The reports' shape, and the one that leaked.
			path: "Scan (Row chain)",
			build: func(tx *gorm.DB) *gorm.DB {
				var rows []row
				return tx.Table("loans l").Select("l.id as loan_id").Scan(&rows)
			},
		},
		{
			path: "Scan with joins (the exact reports shape)",
			build: func(tx *gorm.DB) *gorm.DB {
				var rows []row
				return tx.Table("loans l").
					Select("l.id as loan_id").
					Joins("LEFT JOIN branches b ON b.id = l.branch_id").
					Joins("LEFT JOIN customers c ON c.id = l.customer_id").
					Where("l.deleted_at IS NULL").
					Scan(&rows)
			},
		},
		{
			path: "Pluck (Row chain)",
			build: func(tx *gorm.DB) *gorm.DB {
				var ids []uint
				return tx.Table("loans l").Pluck("l.id", &ids)
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			sql := db.WithContext(ctx).ToSQL(tc.build)
			if !strings.Contains(sql, want) {
				t.Errorf(`no tenant predicate on the %s path — this query returns EVERY
business's rows, with no filter and no error.

want to contain: %s
generated SQL:   %s`, tc.path, want, sql)
			}
		})
	}
}

// TestUnscopedContextFailsOnEveryExecutionPath is the other half: a query
// with no tenant in context must FAIL rather than run unfiltered, and that
// has to hold on every execution path too.
//
// Without this, a missing registration shows up as silently unfiltered rows
// instead of a loud error — which is exactly how the .Scan() gap survived.
func TestUnscopedContextFailsOnEveryExecutionPath(t *testing.T) {
	db := openScopedTestDB(t)
	ctx := context.Background() // deliberately carries no tenant

	type row struct {
		LoanID uint
	}

	t.Run("Find", func(t *testing.T) {
		var rows []row
		err := db.WithContext(ctx).Table("loans l").Select("l.id as loan_id").Find(&rows).Error
		if !errors.Is(err, ErrNoTenantInContext) {
			t.Errorf("Find with no tenant returned %v, want ErrNoTenantInContext", err)
		}
	})

	t.Run("Scan", func(t *testing.T) {
		var rows []row
		err := db.WithContext(ctx).Table("loans l").Select("l.id as loan_id").Scan(&rows).Error
		if !errors.Is(err, ErrNoTenantInContext) {
			t.Errorf("Scan with no tenant returned %v, want ErrNoTenantInContext — "+
				"an unfiltered Scan is a cross-business read", err)
		}
	})
}
