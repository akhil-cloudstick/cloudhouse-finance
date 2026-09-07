package platform

import (
	"os"
	"testing"
)

// TestCheckAndRecordUsageEnforcesTheCap is Step 13's proof: a business can
// use a shared channel up to its daily cap, and the call that would push it
// over is the one refused — not one that lets it through and refuses the
// next, which would mean the abusive caller already got what they wanted.
func TestCheckAndRecordUsageEnforcesTheCap(t *testing.T) {
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run this test")
	}
	t.Setenv("DB_NAME", name)
	db, err := NewDatabase(LoadConfig())
	if err != nil {
		t.Skipf("cannot reach test database %q: %v", name, err)
	}
	if err := db.AutoMigrate(&UsageCounter{}); err != nil {
		t.Fatalf("migrating UsageCounter: %v", err)
	}

	// A category with a small, known cap — setu_esign is 100 — would take
	// 100 real calls to exhaust; instead this test overrides the map for
	// its own run so it can prove BOTH sides (under and over) quickly. The
	// override is restored so it can't leak into another test.
	original := dailyUsageCaps[UsageSetuEsign]
	dailyUsageCaps[UsageSetuEsign] = 3
	t.Cleanup(func() { dailyUsageCaps[UsageSetuEsign] = original })

	// A tenant id unlikely to collide with fixtures other tests in this
	// package leave behind on the same long-lived scratch database.
	const tenantID = 999999001

	for i := 1; i <= 3; i++ {
		if err := CheckAndRecordUsage(db, tenantID, UsageSetuEsign); err != nil {
			t.Fatalf("call %d: got %v, want success (cap is 3)", i, err)
		}
	}
	// The 4th call is the one that pushes the count to 4, over the cap of 3
	// — it must be the one refused.
	if err := CheckAndRecordUsage(db, tenantID, UsageSetuEsign); err == nil {
		t.Error("the 4th call succeeded — the cap of 3 was not enforced")
	}

	// A DIFFERENT tenant's count is completely separate — the whole point of
	// a PER-BUSINESS cap.
	const otherTenantID = 999999002
	if err := CheckAndRecordUsage(db, otherTenantID, UsageSetuEsign); err != nil {
		t.Errorf("a different tenant was refused by tenant %d's exhausted cap: %v", tenantID, err)
	}

	// A different CATEGORY for the SAME tenant is also separate.
	if err := CheckAndRecordUsage(db, tenantID, UsageWhatsApp); err != nil {
		t.Errorf("a different category was refused by this tenant's exhausted setu_esign cap: %v", err)
	}

	db.Exec(`DELETE FROM usage_counters WHERE tenant_id IN (?, ?)`, tenantID, otherTenantID)
}

// TestCheckAndRecordUsageRequiresATenant guards against ever charging usage
// to "no one" — a background/cross-tenant context has nowhere for the cost
// to land and must resolve a real tenant before calling this.
func TestCheckAndRecordUsageRequiresATenant(t *testing.T) {
	if err := CheckAndRecordUsage(nil, 0, UsageSMS); err == nil {
		t.Error("CheckAndRecordUsage(tenantID=0) succeeded — must refuse a call with no tenant to charge")
	}
}
