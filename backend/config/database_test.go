package config

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func pinTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("MT_TEST_DB") == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run connection-pinning tests")
	}
	t.Setenv("DB_NAME", os.Getenv("MT_TEST_DB"))
	t.Setenv("MIGRATIONS_DIR", "../migrations")
	InitDB()
	BaseDB.Logger = logger.Discard
	return BaseDB
}

func TestPinConnDoesNotMutateTheSharedHandle(t *testing.T) {
	base := pinTestDB(t)
	before := base.Statement.ConnPool
	ctx, release, err := PinConn(context.Background(), base, 1)
	if err != nil {
		t.Fatalf("PinConn: %v", err)
	}
	if base.Statement.ConnPool != before {
		t.Fatal("PinConn replaced the SHARED handle's ConnPool — every query in the " +
			"process is now bound to one request's connection, and will fail once it is released")
	}
	pinned, ok := pinnedFromContext(ctx)
	if !ok {
		t.Fatal("PinConn returned a context with no pinned handle")
	}
	if pinned.Statement.ConnPool == before {
		t.Fatal("the pinned handle is still on the shared pool — nothing was pinned")
	}
	release()
	// The shared pool must still be usable after the pin is released.
	var n int
	if err := base.Raw("SELECT 1").Scan(&n).Error; err != nil {
		t.Fatalf("shared handle is broken after releasing a pinned connection: %v", err)
	}
	if n != 1 {
		t.Fatalf("SELECT 1 returned %d", n)
	}
}

func TestPinConnSetsAndClearsTheBusiness(t *testing.T) {
	base := pinTestDB(t)
	ctx, release, err := PinConn(context.Background(), base, 42)
	if err != nil {
		t.Fatalf("PinConn: %v", err)
	}
	pinned, _ := pinnedFromContext(ctx)
	var got string
	if err := pinned.Raw("SELECT current_setting('app.tenant_id', true)").Scan(&got).Error; err != nil {
		t.Fatalf("reading app.tenant_id: %v", err)
	}
	if got != "42" {
		t.Errorf("app.tenant_id on the pinned connection = %q, want \"42\"", got)
	}
	release()
	for i := 0; i < 10; i++ {
		var leaked string
		if err := base.Raw("SELECT current_setting('app.tenant_id', true)").Scan(&leaked).Error; err != nil {
			t.Fatalf("reading app.tenant_id from the pool: %v", err)
		}
		if leaked == "42" {
			t.Fatal("a released connection still reports the previous request's business — " +
				"the next request to receive it would run under the wrong tenant")
		}
	}
}

func TestPinConnRefusesWithoutABusiness(t *testing.T) {
	base := pinTestDB(t)
	if _, _, err := PinConn(context.Background(), base, 0); err == nil {
		t.Fatal("PinConn accepted tenant 0; it must refuse")
	}
}

func TestPrimaryTableAndAlias(t *testing.T) {
	cases := []struct {
		in        string
		wantName  string
		wantAlias string
	}{
		{"loans", "loans", "loans"},
		{"loans l", "loans", "l"},
		{"loans AS l", "loans", "l"},
		{"loans as l", "loans", "l"},
		{"  packets p  ", "packets", "p"},
		{"bank_pledge_records r", "bank_pledge_records", "r"},
		{"", "", ""},
	}
	for _, c := range cases {
		name, alias := primaryTableAndAlias(c.in)
		if name != c.wantName || alias != c.wantAlias {
			t.Errorf("primaryTableAndAlias(%q) = (%q, %q), want (%q, %q)",
				c.in, name, alias, c.wantName, c.wantAlias)
		}
	}
}

func TestTenantFromContextRejectsZero(t *testing.T) {
	if _, ok := TenantFromContext(context.Background()); ok {
		t.Error("empty context reported a tenant")
	}
	if _, ok := TenantFromContext(WithTenant(context.Background(), 0)); ok {
		t.Error("tenant 0 reported as present")
	}
	id, ok := TenantFromContext(WithTenant(context.Background(), 7))
	if !ok || id != 7 {
		t.Errorf("got (%d, %v), want (7, true)", id, ok)
	}
}

func TestCrossTenantIsOptIn(t *testing.T) {
	if IsCrossTenantAllowed(context.Background()) {
		t.Error("plain context reported cross-tenant access as allowed")
	}
	if !IsCrossTenantAllowed(AllowCrossTenant(context.Background())) {
		t.Error("AllowCrossTenant did not take effect")
	}
}

func TestScopedTableSetIsNotEmptyAndHasNoGlobals(t *testing.T) {
	if len(tenantScopedTables) != 61 {
		t.Errorf("expected 61 tenant-scoped tables, got %d — update this test "+
			"deliberately when adding a model, so a new table cannot slip in "+
			"unfiltered", len(tenantScopedTables))
	}
	for _, global := range []string{"permissions", "api_key_settings", "tenants", "tiers", "sequences", "usage_counters"} {
		if tenantScopedTables[global] {
			t.Errorf("%q must not be tenant-filtered", global)
		}
	}
}

func openScopedTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run tenant-scope SQL tests")
	}
	t.Setenv("DB_NAME", name)
	t.Setenv("MIGRATIONS_DIR", "../migrations")
	InitDB()
	return BaseDB
}

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
	exempt := map[string]bool{"sequences": true, "superadmin_audit_logs": true, "usage_counters": true, "subscription_payments": true}
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
