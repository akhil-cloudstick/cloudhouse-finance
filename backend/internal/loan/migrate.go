package loan

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// moneyColumns lists the loans-table rupee columns that must never be NULL.
// A NULL here is not "unknown money" — it means the column was added to an
// existing table after those rows were written, so the correct value is zero.
var moneyColumns = []string{
	"accrued_interest",
	"interest_paid",
	"accrued_penal_interest",
	"penal_interest_paid",
	"outstanding_processing_fee",
	"total_gold_value",
	"eligible_loan_amount",
}

// BackfillNullMoney is a one-time, idempotent step that replaces NULLs in the
// loans table's rupee columns with 0. Safe to re-run: once every row is
// populated the UPDATE matches nothing.
//
// NULL money is worse than merely untidy, because SQL arithmetic propagates
// it rather than ignoring it. A report computing outstanding interest as
// `accrued_interest - interest_paid` yields NULL for such a row — not 0 —
// so the loan silently vanishes from the figure instead of contributing
// zero to it. (Aggregates like SUM skip NULLs, which hides the problem
// further: the total looks plausible while quietly omitting rows.)
//
// This complements the `default:0` on those columns, which only governs
// rows inserted from now on and does not touch existing NULLs.
func BackfillNullMoney(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Loan{}) {
		return nil // fresh install — AutoMigrate will create the columns with defaults
	}
	var total int64
	for _, col := range moneyColumns {
		if !db.Migrator().HasColumn(&Loan{}, col) {
			continue
		}
		res := db.Exec(fmt.Sprintf(`UPDATE loans SET %s = 0 WHERE %s IS NULL`, col, col))
		if res.Error != nil {
			return res.Error
		}
		total += res.RowsAffected
	}
	if total > 0 {
		log.Printf("backfilled %d NULL money value(s) to 0 across loans", total)
	}
	return nil
}
