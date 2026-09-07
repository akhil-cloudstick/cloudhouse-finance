package migrate

import (
	"fmt"

	"gorm.io/gorm"
)

// CurrentSchemaVersion identifies the schema Run() produces as of this
// build. Bump it whenever Run changes what it applies — AutoMigrate table
// list, a new backfill, a new seed step — so a server binary can tell
// whether the database it just connected to has actually been migrated to
// match ITS OWN expectations, not just "migrated at some point."
//
// There is deliberately no scheme beyond "a string that changes" (no
// semver, no ordering guarantees) — Run's own steps are already ordered and
// idempotent; this version exists only to answer one yes/no question at
// boot, not to drive a migration framework.
const CurrentSchemaVersion = "2026-08-29-billing"

// schemaVersionRow is a single-row table (id is always 1) recording the
// last schema version Run() successfully completed.
type schemaVersionRow struct {
	ID      uint   `gorm:"primaryKey"`
	Version string `gorm:"not null;size:120"`
}

func (schemaVersionRow) TableName() string { return "schema_migrations" }

// stampSchemaVersion records that Run() completed successfully at
// CurrentSchemaVersion. Called once, at the very end of Run — see its call
// site for why "last thing that happens" matters here the same way it
// mattered for the tenancy backfill: if a step above this one starts
// failing, the version must NOT be stamped, so CheckSchemaVersion below
// keeps refusing to start the server against a half-migrated database.
func stampSchemaVersion(db *gorm.DB) error {
	if err := db.AutoMigrate(&schemaVersionRow{}); err != nil {
		return err
	}
	return db.Save(&schemaVersionRow{ID: 1, Version: CurrentSchemaVersion}).Error
}

// ErrSchemaNotMigrated is returned by CheckSchemaVersion when the database's
// stamped version doesn't match CurrentSchemaVersion — including "doesn't
// exist yet," which covers exactly the same case as an outright mismatch:
// this binary's expectations have not been applied to this database.
var ErrSchemaNotMigrated = fmt.Errorf("database schema is not migrated to this server's expected version")

// CheckSchemaVersion is what the API server calls at boot INSTEAD OF
// Run — multi-tenancy plan, Step 12. Before this, migrate.Run executed on
// every server boot and could alter schema, meaning every restart ran
// migrations unattended against live data. Migrating is now an explicit,
// deliberate act (`go run ./cmd/migrate`); the server's only job is to
// verify it already happened and refuse to start otherwise, with a message
// that says exactly what to run instead of starting anyway and hoping.
func CheckSchemaVersion(db *gorm.DB) error {
	var row schemaVersionRow
	if err := db.First(&row, 1).Error; err != nil {
		return fmt.Errorf("%w: no schema_migrations row found — run `go run ./cmd/migrate` first", ErrSchemaNotMigrated)
	}
	if row.Version != CurrentSchemaVersion {
		return fmt.Errorf("%w: database is stamped %q, this server expects %q — run `go run ./cmd/migrate`",
			ErrSchemaNotMigrated, row.Version, CurrentSchemaVersion)
	}
	return nil
}
