package migrate

import (
	"os"
	"testing"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// TestCheckSchemaVersionRefusesAnUnmigratedDatabase is Step 12's proof: the
// server-facing check must fail — not silently pass — against a database
// that has never been migrated (no schema_migrations row at all), and
// against one migrated to a DIFFERENT version than this binary expects.
func TestCheckSchemaVersionRefusesAnUnmigratedDatabase(t *testing.T) {
	db := openScratchDB(t)

	// Force the "never migrated" state regardless of what earlier test runs
	// against this same long-lived scratch database left behind — the table
	// may or may not exist yet, so DROP rather than DELETE.
	if err := db.Exec(`DROP TABLE IF EXISTS schema_migrations`).Error; err != nil {
		t.Fatalf("dropping schema_migrations to force the unmigrated state: %v", err)
	}
	if err := CheckSchemaVersion(db); err == nil {
		t.Fatal("CheckSchemaVersion passed against a database with no schema_migrations row at all")
	}

	// Migrate.Run for real, then stamp a DIFFERENT version by hand —
	// simulates a server binary newer/older than what actually ran.
	if err := Run(db, platform.LoadConfig()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if err := db.Exec(`UPDATE schema_migrations SET version = ? WHERE id = 1`, "some-other-version").Error; err != nil {
		t.Fatalf("forcing a version mismatch: %v", err)
	}
	if err := CheckSchemaVersion(db); err == nil {
		t.Fatal("CheckSchemaVersion passed against a database stamped with a DIFFERENT version than this binary expects")
	}

	// Run stamps CurrentSchemaVersion itself — the positive control. Without
	// this passing, the two failures above would be trivially true (nothing
	// ever passes) and would prove nothing.
	if err := Run(db, platform.LoadConfig()); err != nil {
		t.Fatalf("Run (restamping): %v", err)
	}
	if err := CheckSchemaVersion(db); err != nil {
		t.Errorf("CheckSchemaVersion failed right after Run stamped the current version: %v", err)
	}
}

func openScratchDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run this test")
	}
	t.Setenv("DB_NAME", name)
	db, err := platform.NewDatabase(platform.LoadConfig())
	if err != nil {
		t.Skipf("cannot reach test database %q: %v", name, err)
	}
	return db
}
