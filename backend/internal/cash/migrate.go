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
	if err := dropOrphanedGoldSaleCustomerName(db); err != nil {
		return err
	}
	return nil
}

// orphanedGoldSaleColumns are NOT NULL columns another branch's GoldSale
// shape (customer name + net weight) added to gold_sales that this model
// doesn't have — every insert here omits them, so Postgres rejects it.
var orphanedGoldSaleColumns = []string{"customer_name", "net_weight"}

// dropOrphanedGoldSaleCustomerName relaxes the NOT NULL constraint on each
// orphanedGoldSaleColumns column still present. A "Gold Sale" here is the
// business selling its own gold stock (see model.go), and GORM's AutoMigrate
// only ever ADDs columns it knows about, so it can never touch these leftover
// constraints itself. HasColumn/ALTER ... DROP NOT NULL is a no-op if the
// column has already been dropped or never had the constraint, so this is
// safe to run on every boot.
func dropOrphanedGoldSaleCustomerName(db *gorm.DB) error {
	for _, col := range orphanedGoldSaleColumns {
		if !db.Migrator().HasColumn(&GoldSale{}, col) {
			continue
		}
		if err := db.Exec(fmt.Sprintf(`ALTER TABLE gold_sales ALTER COLUMN %s DROP NOT NULL`, col)).Error; err != nil {
			return err
		}
		log.Printf("dropped NOT NULL on orphaned gold_sales.%s", col)
	}
	return nil
}

// PrepareOpeningBalanceMode readies opening_cash_balances for per-mode rows:
// adds the NOT NULL mode column with a 'Cash' default (every existing row
// was a cash-in-hand figure) and drops the old unique (branch_id,
// balance_date) index, which would reject a second mode for the same day.
// Must run BEFORE AutoMigrate. Idempotent; no-op on a fresh install.
func PrepareOpeningBalanceMode(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable(&OpeningCashBalance{}) {
		return nil
	}
	if !m.HasColumn(&OpeningCashBalance{}, "mode") {
		if err := db.Exec(`ALTER TABLE opening_cash_balances ADD COLUMN mode varchar(20) NOT NULL DEFAULT 'Cash'`).Error; err != nil {
			return err
		}
		log.Printf("added opening_cash_balances.mode (existing rows = Cash)")
	}
	return db.Exec(`DROP INDEX IF EXISTS idx_branch_date`).Error
}

// EnsureOpeningBalanceModeIndex creates the one-row-per (branch, date, mode,
// bank) unique index. COALESCE(bank_id, 0) because Postgres treats NULLs as
// distinct — without it two Cash rows (no bank) for the same day would both
// be allowed. Must run AFTER AutoMigrate (needs the bank_id column).
func EnsureOpeningBalanceModeIndex(db *gorm.DB) error {
	return db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_branch_date_mode_bank
		ON opening_cash_balances (branch_id, balance_date, mode, COALESCE(bank_id, 0))`).Error
}

// BackfillInvestmentDepositParty tags investment-deposit cash movements
// written before RecordInvestmentDepositCashIn took a customerID with the
// investor's customer, so they appear on that customer's ledger. Matches on
// the "Investment deposit — INV-xxxxx" Purpose that function always writes.
// Must run AFTER AutoMigrate (needs the investments table). Idempotent: only
// touches rows whose party_customer_id is still NULL.
func BackfillInvestmentDepositParty(db *gorm.DB) error {
	if !db.Migrator().HasTable("investments") {
		return nil
	}
	res := db.Exec(`UPDATE cash_movements m SET party_customer_id = i.customer_id
		FROM investments i
		WHERE m.party_customer_id IS NULL
		  AND m.source = 'Investment'
		  AND m.tenant_id = i.tenant_id
		  AND m.purpose = 'Investment deposit — ' || i.investment_number`)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("tagged %d investment deposit movement(s) with their investor", res.RowsAffected)
	}
	return nil
}

// BackfillGoldPurchaseCostMode gives gold-sale cost cash-outs written before
// RecordGoldSaleCashOut set a Mode the "Cash" mode they were paid in, so they
// show in the Cash ledger. Idempotent: only touches blank-mode rows.
func BackfillGoldPurchaseCostMode(db *gorm.DB) error {
	return db.Exec(`UPDATE cash_movements SET mode = ? WHERE type = 'out' AND (mode IS NULL OR mode = '') AND purpose LIKE ?`,
		CashModeCash, GoldPurchaseCostPrefix+"%").Error
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

// MigrateCategories folds the legacy cash_sources and expense_categories
// tables into the unified categories table. Runs AFTER AutoMigrate (which
// creates categories) and only while categories is still empty, so it is a
// one-time, idempotent copy: cash sources become type cash_in, expense
// categories become type expense, a name present in both (a loan's repayment
// category, or any name staff added twice) becomes one common row, and every
// loan with its details on file is common. The legacy tables are left in
// place, untouched and no longer read.
func MigrateCategories(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable("categories") || (!m.HasTable("cash_sources") && !m.HasTable("expense_categories")) {
		return nil
	}
	var existing int64
	if err := db.Raw(`SELECT COUNT(*) FROM categories`).Scan(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if m.HasTable("cash_sources") {
			if err := tx.Exec(`
				INSERT INTO categories (tenant_id, type, name, is_common, bank_id, loan_number, principal_amount, loan_opened_at, created_at)
				SELECT DISTINCT ON (tenant_id, lower(name))
					tenant_id, 'cash_in', name, (principal_amount IS NOT NULL), bank_id, loan_number, principal_amount, loan_opened_at, created_at
				FROM cash_sources
				ORDER BY tenant_id, lower(name), (principal_amount IS NULL), id`).Error; err != nil {
				return err
			}
		}
		if m.HasTable("expense_categories") {
			// Already a cash-in source → shown on every form.
			if err := tx.Exec(`
				UPDATE categories c SET is_common = true
				FROM expense_categories e
				WHERE c.tenant_id IS NOT DISTINCT FROM e.tenant_id AND lower(c.name) = lower(e.name)`).Error; err != nil {
				return err
			}
			if err := tx.Exec(`
				INSERT INTO categories (tenant_id, type, name, is_common, created_at)
				SELECT DISTINCT ON (e.tenant_id, lower(e.name)) e.tenant_id, 'expense', e.name, false, e.created_at
				FROM expense_categories e
				WHERE NOT EXISTS (
					SELECT 1 FROM categories c
					WHERE c.tenant_id IS NOT DISTINCT FROM e.tenant_id AND lower(c.name) = lower(e.name))
				ORDER BY e.tenant_id, lower(e.name), e.id`).Error; err != nil {
				return err
			}
		}
		// A name is unique per tenant — see findOrCreateCategory.
		return tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_tenant_name ON categories (tenant_id, lower(name))`).Error
	})
}
