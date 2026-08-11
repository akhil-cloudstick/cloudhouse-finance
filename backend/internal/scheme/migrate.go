package scheme

import (
	"log"

	"gorm.io/gorm"
)

// BackfillDurationMonths is a one-time, idempotent step for existing
// databases whose schemes table predates DurationMonths and instead
// described a scheme's tenure as a start_date/end_date validity window.
// It's safe to re-run: once duration_months exists and every row is
// populated, its UPDATE simply matches nothing.
//
// This must run BEFORE AutoMigrate: GORM adding DurationMonths as a NOT
// NULL column on a non-empty schemes table fails immediately (no default,
// existing rows would violate it) — see the "column duration_months...
// contains null values" error this replaces. Running as raw SQL first adds
// a nullable column to compute into, so AutoMigrate can then safely
// tighten it to NOT NULL.
func BackfillDurationMonths(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&Scheme{}, "start_date") {
		return nil // fresh install, or already migrated past the old date-window schema
	}
	if !db.Migrator().HasColumn(&Scheme{}, "duration_months") {
		if err := db.Exec(`ALTER TABLE schemes ADD COLUMN duration_months bigint`).Error; err != nil {
			return err
		}
	}
	// Approximate months from the legacy date window using the average
	// Gregorian month (30.44 days), rounded to the nearest whole month and
	// floored at 1 so no scheme ends up with a zero/negative tenure.
	res := db.Exec(`
		UPDATE schemes
		SET duration_months = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_date - start_date)) / (86400 * 30.44)))
		WHERE duration_months IS NULL
	`)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("backfilled duration_months for %d scheme(s) from legacy start_date/end_date window", res.RowsAffected)
	}
	return nil
}

// DropLegacyDateColumns removes the old start_date/end_date validity-window
// columns once BackfillDurationMonths has copied their span into
// duration_months. Safe to re-run: HasColumn is false after the first
// successful drop.
func DropLegacyDateColumns(db *gorm.DB) error {
	for _, col := range []string{"start_date", "end_date"} {
		if !db.Migrator().HasColumn(&Scheme{}, col) {
			continue
		}
		if err := db.Migrator().DropColumn(&Scheme{}, col); err != nil {
			return err
		}
		log.Printf("dropped legacy schemes.%s column", col)
	}
	return nil
}
