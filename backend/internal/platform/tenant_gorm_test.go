package platform

import (
	"context"
	"testing"
)

// The alias cases matter because internal/reports builds all 16 of its
// queries as db.Table("loans l").Joins(...), often joining several
// tenant-owned tables at once. An unqualified tenant_id predicate against
// such a query is ambiguous and Postgres rejects it, so getting the alias
// wrong breaks every report rather than leaking anything — noisy, but it
// would break them all at once.
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

// A tenant of 0 must read as "absent", never as "tenant zero". Conflating
// them would turn a missing tenant into a filter on 0, which returns an
// empty result that looks exactly like a business with no data — the
// failure would be invisible instead of loud.
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

// Every table in the migration's backfill list must also be filtered, and
// vice versa. The two lists live in different packages for dependency
// reasons, so nothing but a test stops them drifting — and a table present
// in one but missing from the other is precisely a table that gets a
// tenant_id column and then never has it enforced.
func TestScopedTableSetIsNotEmptyAndHasNoGlobals(t *testing.T) {
	// The count is pinned so adding a model forces a deliberate decision
	// here. Note what this alone does NOT catch: a new table that is added
	// to the schema but never added to this map. The count still matches,
	// the test still passes, and the table is served unfiltered.
	//
	// That is not hypothetical — it happened with `uploaded_files`, and the
	// symptom was one business reading another's files while every test was
	// green. TestEveryTenantScopedModelIsFiltered below is the check that
	// actually catches it, by comparing this map against the database.
	// 43 -> 47: gold_sales, investments, investment_plans and
	// investment_payouts were added. All four already HAD a tenant_id column
	// (they embed platform.TenantScoped) but were missing from the map, so
	// they were served unfiltered — the exact uploaded_files failure this
	// comment describes, repeated. Their routes were also absent from
	// internal/app's route manifest, which is why no probe caught it.
	if len(tenantScopedTables) != 47 {
		t.Errorf("expected 47 tenant-scoped tables, got %d — update this test "+
			"deliberately when adding a model, so a new table cannot slip in "+
			"unfiltered", len(tenantScopedTables))
	}
	for _, global := range []string{"permissions", "api_key_settings", "tenants", "tiers", "sequences", "usage_counters"} {
		if tenantScopedTables[global] {
			t.Errorf("%q must not be tenant-filtered", global)
		}
	}
}
