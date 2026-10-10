package controllers

import (
	"cloudhouse/backend/config"
	"os"
	"testing"
)

func TestCheckAndRecordUsageEnforcesTheCap(t *testing.T) {
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run this test")
	}
	t.Setenv("DB_NAME", name)
	t.Setenv("MIGRATIONS_DIR", "../../migrations")
	config.InitDB()
	db := config.BaseDB
	original := dailyUsageCaps[UsageSetuEsign]
	dailyUsageCaps[UsageSetuEsign] = 3
	t.Cleanup(func() { dailyUsageCaps[UsageSetuEsign] = original })
	const tenantID = 999999001
	for i := 1; i <= 3; i++ {
		if err := CheckAndRecordUsage(db, tenantID, UsageSetuEsign); err != nil {
			t.Fatalf("call %d: got %v, want success (cap is 3)", i, err)
		}
	}
	// The 4th call is the one that pushes the count to 4, over the cap of 3 — it must be the one refused.
	if err := CheckAndRecordUsage(db, tenantID, UsageSetuEsign); err == nil {
		t.Error("the 4th call succeeded — the cap of 3 was not enforced")
	}
	const otherTenantID = 999999002
	if err := CheckAndRecordUsage(db, otherTenantID, UsageSetuEsign); err != nil {
		t.Errorf("a different tenant was refused by tenant %d's exhausted cap: %v", tenantID, err)
	}
	if err := CheckAndRecordUsage(db, tenantID, "whatsapp"); err != nil {
		t.Errorf("a different category was refused by this tenant's exhausted setu_esign cap: %v", err)
	}
	db.Exec(`DELETE FROM usage_counters WHERE tenant_id IN (?, ?)`, tenantID, otherTenantID)
}

func TestCheckAndRecordUsageRequiresATenant(t *testing.T) {
	if err := CheckAndRecordUsage(nil, 0, "sms"); err == nil {
		t.Error("CheckAndRecordUsage(tenantID=0) succeeded — must refuse a call with no tenant to charge")
	}
}
