package migrate

import (
	"reflect"
	"sync"
	"testing"

	"gorm.io/gorm/schema"

	"cloudhouse/backend/internal/platform"
)

// TestEveryTenantScopedModelIsRegistered is the guard that stops the
// isolation boundary from drifting.
//
// Before it, the set of tenant-owned tables was written down twice — a map in
// platform/tenant_gorm.go driving the runtime filter, and a slice in this
// package driving the tenant_id backfill and the NOT NULL pass — and nothing
// compared them. They drifted. gold_sales, investments, investment_plans,
// investment_payouts and audit_log_entries were added to the filter and never
// to the migration, so those tables were scoped on every query while the
// database never made tenant_id mandatory on them. A gold_sales row with
// tenant_id = 0 was the result.
//
// The two lists are now one. This test covers the remaining half of the
// problem: a NEW model that embeds platform.TenantScoped but is never added
// to that one list. Such a model is the dangerous case, because it looks
// tenant-owned in Go — it has the column, the field, the JSON key — while
// every query against it runs with no filter and no error at all.
//
// Deliberately requires no database, unlike the column-driven check in
// platform/tenant_scope_db_test.go, so it runs on every `go test ./...` and
// in CI rather than only when MT_TEST_DB is set.
func TestEveryTenantScopedModelIsRegistered(t *testing.T) {
	scoped := map[string]bool{}
	for _, name := range platform.TenantScopedTableNames() {
		scoped[name] = true
	}

	marker := reflect.TypeOf(platform.TenantScoped{})

	for _, model := range allModels {
		typ := reflect.TypeOf(model)
		for typ.Kind() == reflect.Ptr {
			typ = typ.Elem()
		}
		if typ.Kind() != reflect.Struct {
			continue
		}
		if !embedsMarker(typ, marker) {
			continue
		}

		table := tableNameOf(t, model)
		if !scoped[table] {
			t.Errorf("model %s embeds platform.TenantScoped (so its rows carry a tenant_id) "+
				"but table %q is NOT in platform.TenantScopedTableNames — every query against "+
				"it runs unfiltered, returning every business's rows with no error. Add it to "+
				"tenantScopedTables in internal/platform/tenant_gorm.go.",
				typ.Name(), table)
		}
	}
}

// embedsMarker reports whether typ embeds the marker struct anonymously, at
// any depth — models embed platform.TenantScoped directly today, but a model
// embedding a shared base struct that carries it must count too.
func embedsMarker(typ, marker reflect.Type) bool {
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		if !f.Anonymous {
			continue
		}
		ft := f.Type
		for ft.Kind() == reflect.Ptr {
			ft = ft.Elem()
		}
		if ft == marker {
			return true
		}
		if ft.Kind() == reflect.Struct && embedsMarker(ft, marker) {
			return true
		}
	}
	return false
}

// tableNameOf resolves the table a model maps to the same way GORM does, so
// an explicit TableName() method and the default pluralised naming strategy
// are both honoured — several models here rely on the former.
func tableNameOf(t *testing.T, model any) string {
	t.Helper()
	s, err := schema.Parse(model, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatalf("parsing schema for %T: %v", model, err)
	}
	return s.Table
}
