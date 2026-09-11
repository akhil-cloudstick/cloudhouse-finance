package cash

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// goldSaleAddedColumns are the NOT NULL columns GoldSale grew after the
// gold_sales table had already shipped. GORM's AutoMigrate issues a bare
// `ALTER TABLE ... ADD <col> <type> NOT NULL`, which Postgres rejects
// outright on a table that already has rows ("column X contains null
// values") — so on every clone with existing demo/production data the boot
// migration died before it ever reached the rest of the schema.
//
// Each entry carries the DEFAULT that makes the ADD legal for those
// pre-existing rows. The default is attached to the column itself rather
// than backfilled afterwards, because the failing statement is the ADD, not
// a later UPDATE — there is no window in which to backfill.
var goldSaleAddedColumns = []struct{ name, ddl string }{
	{"sold_amount", "numeric(16,2) NOT NULL DEFAULT 0"},
	{"cost_amount", "numeric(16,2) NOT NULL DEFAULT 0"},
	{"profit", "numeric(16,2) NOT NULL DEFAULT 0"},
	{"ornament_type", "varchar(80) NOT NULL DEFAULT ''"},
	{"sold_on", "timestamptz NOT NULL DEFAULT now()"},
}

// BackfillGoldSaleColumns adds any GoldSale column that AutoMigrate would
// otherwise fail to add, giving it a DEFAULT so existing rows satisfy the
// NOT NULL, and also repairs NULLs left in those columns by an older
// nullable definition. Must run BEFORE AutoMigrate. Idempotent and a no-op
// on a fresh install, where AutoMigrate creates the table correctly itself.
func BackfillGoldSaleColumns(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable(&GoldSale{}) {
		return nil // fresh install — AutoMigrate creates the whole table
	}
	for _, col := range goldSaleAddedColumns {
		if !m.HasColumn(&GoldSale{}, col.name) {
			if err := db.Exec(fmt.Sprintf(`ALTER TABLE gold_sales ADD COLUMN %s %s`, col.name, col.ddl)).Error; err != nil {
				return err
			}
			log.Printf("added gold_sales.%s with a default for pre-existing rows", col.name)
			continue
		}
		// Column exists but may still hold NULLs from an older nullable
		// definition; AutoMigrate's NOT NULL tightening would fail on those.
		res := db.Exec(fmt.Sprintf(`UPDATE gold_sales SET %s = %s WHERE %s IS NULL`, col.name, nullFill(col.name), col.name))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected > 0 {
			log.Printf("backfilled %d NULL gold_sales.%s value(s)", res.RowsAffected, col.name)
		}
	}
	return nil
}

// nullFill is the value an existing NULL in a given column is replaced with.
func nullFill(col string) string {
	switch col {
	case "ornament_type":
		return "''"
	case "sold_on":
		return "now()"
	default:
		return "0"
	}
}
