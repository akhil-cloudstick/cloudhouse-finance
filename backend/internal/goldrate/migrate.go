package goldrate

import (
	"log"

	"gorm.io/gorm"
)

// MigrateLegacyColumns is a one-time, idempotent step for existing
// databases whose gold_rates table still has the old k22/k18 columns
// (independently staff-entered daily rates, before purity resolution
// moved to a per-ornament karat/fineness% computation off K24 alone — see
// this package's doc comment). It renames them to legacy_k22/legacy_k18
// rather than dropping them, preserving their real historical values
// (which can't be reconstructed from K24 × ratio, since they were entered
// independently) for any future read-only reporting need, and drops their
// NOT NULL constraint — new inserts via the current GoldRate struct (which
// no longer declares K22/K18 fields at all) never populate them, so
// leaving the old constraint in place would reject every new publish with
// "null value in column legacy_k22 violates not-null constraint". Nothing
// in the app reads or writes the renamed columns going forward.
//
// This must run BEFORE AutoMigrate: GoldRate's struct no longer declares
// K22/K18 fields, so AutoMigrate has no reason to touch those columns
// itself — the rename/constraint drop has to happen explicitly, once,
// while they still exist under their old names. Safe to re-run: the
// ALTER COLUMN ... DROP NOT NULL is itself idempotent, and HasColumn is
// false for "k22"/"k18" after the first successful rename so the whole
// block short-circuits on subsequent runs.
func MigrateLegacyColumns(db *gorm.DB) error {
	renames := map[string]string{"k22": "legacy_k22", "k18": "legacy_k18"}
	for from, to := range renames {
		if db.Migrator().HasColumn(&GoldRate{}, from) {
			if err := db.Migrator().RenameColumn(&GoldRate{}, from, to); err != nil {
				return err
			}
			log.Printf("renamed gold_rates.%s -> %s (preserved read-only)", from, to)
		}
		// Independent of whether the rename just happened above or ran on a
		// prior deploy (before this NOT NULL drop existed) — either way the
		// renamed column may still carry its old NOT NULL constraint, which
		// rejects every new publish since the current GoldRate struct never
		// populates it. Re-run-safe: DROP NOT NULL on an already-nullable
		// column is a no-op.
		if db.Migrator().HasColumn(&GoldRate{}, to) {
			if err := db.Exec(`ALTER TABLE gold_rates ALTER COLUMN ` + to + ` DROP NOT NULL`).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
