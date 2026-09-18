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

// MigrateRetiredSanctionStage moves loans still parked on the retired
// AuthorizedManagement sanction stage onto FinalSanction (see
// SanctionStageAuthorizedManagement). One-time and idempotent — once no row
// holds the old value the UPDATE matches nothing. Without it those loans
// would sit at a stage the 3-step chain no longer contains, so nothing in
// the UI could clear them.
func MigrateRetiredSanctionStage(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Loan{}) {
		return nil // fresh install — no legacy rows to move
	}
	res := db.Exec(`UPDATE loans SET approval_stage = ? WHERE approval_stage = ?`,
		SanctionStageFinalSanction, SanctionStageAuthorizedManagement)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("moved %d loan(s) from the retired AuthorizedManagement stage to FinalSanction", res.RowsAffected)
	}
	return nil
}

// paymentSplitColumns are LoanPayment's new NOT NULL DEFAULT 0 split-mode
// columns, added after loan_payments had already shipped — same AutoMigrate
// limitation as loans' moneyColumns above and cash.BackfillGoldSaleColumns:
// GORM's bare `ADD COLUMN ... NOT NULL` fails on a table with existing rows,
// so each ADD here carries its own DEFAULT.
var paymentSplitColumns = []string{"cash_amount", "upi_amount", "bank_transfer_amount", "cheque_amount"}

// BackfillPaymentSplitColumns adds LoanPayment's CashAmount/UpiAmount/
// BankTransferAmount/ChequeAmount/NeedsModeReview columns ahead of
// AutoMigrate, then maps every pre-existing row's free-text Method into
// exactly one split column using an EXACT, case-insensitive match only
// ("Cash"/"UPI"/"Bank Transfer"/"Cheque") — anything else (blank, a typo, an
// unrecognized string) is left with every split column at 0 and flagged via
// NeedsModeReview for manual reconciliation, never silently defaulted to
// Cash. Guarded so a row already carrying a real split (written by the new
// split-aware RecordPayment/Approve, not this migration) is never
// overwritten — idempotent and safe to run on every boot. Must run BEFORE
// AutoMigrate.
func BackfillPaymentSplitColumns(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable(&LoanPayment{}) {
		return nil // fresh install — AutoMigrate creates the whole table
	}
	for _, col := range paymentSplitColumns {
		if m.HasColumn(&LoanPayment{}, col) {
			continue
		}
		if err := db.Exec(fmt.Sprintf(`ALTER TABLE loan_payments ADD COLUMN %s numeric(16,2) NOT NULL DEFAULT 0`, col)).Error; err != nil {
			return err
		}
		log.Printf("added loan_payments.%s with a default for pre-existing rows", col)
	}
	if !m.HasColumn(&LoanPayment{}, "needs_mode_review") {
		if err := db.Exec(`ALTER TABLE loan_payments ADD COLUMN needs_mode_review boolean NOT NULL DEFAULT false`).Error; err != nil {
			return err
		}
		log.Printf("added loan_payments.needs_mode_review with a default for pre-existing rows")
	}

	// Only rows still at an all-zero split are eligible — never overwrites a
	// real split already recorded by the new code.
	const unsplit = `cash_amount = 0 AND upi_amount = 0 AND bank_transfer_amount = 0 AND cheque_amount = 0`
	mapping := []struct{ method, column string }{
		{"cash", "cash_amount"},
		{"upi", "upi_amount"},
		{"bank transfer", "bank_transfer_amount"},
		{"cheque", "cheque_amount"},
	}
	var mapped int64
	for _, mp := range mapping {
		res := db.Exec(fmt.Sprintf(`UPDATE loan_payments SET %s = amount WHERE %s AND LOWER(TRIM(method)) = ?`, mp.column, unsplit), mp.method)
		if res.Error != nil {
			return res.Error
		}
		mapped += res.RowsAffected
	}
	if mapped > 0 {
		log.Printf("backfilled %d loan_payments row(s) from Method into a split column", mapped)
	}

	res := db.Exec(fmt.Sprintf(`
		UPDATE loan_payments SET needs_mode_review = true
		WHERE %s AND amount <> 0
		AND LOWER(TRIM(method)) NOT IN ('cash', 'upi', 'bank transfer', 'cheque')`, unsplit))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("flagged %d loan_payments row(s) with an unrecognized Method for manual mode review", res.RowsAffected)
	}
	return nil
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

// BackfillSchemeSnapshot is a one-time, idempotent step for the new
// loans.scheme_code/scheme_interest_rate/scheme_duration_months/
// scheme_ltv_percent/scheme_interest_method/scheme_penal_rate columns —
// added so every loan freezes the calculation terms of the scheme it was
// opened under, rather than reading the (editable, soft-deletable) scheme
// row live forever. See Loan.applySchemeSnapshot's doc comment.
//
// Must run AFTER AutoMigrate, since these are the columns AutoMigrate itself
// creates (plain nullable/zero-default additions — no NOT NULL, so unlike
// BackfillNullMoney's siblings there is no ordering requirement forcing this
// before AutoMigrate). Only rows still at the zero value are touched, so a
// loan created after this code shipped (already snapshotted at Create /
// UpdateLoan time) is never overwritten.
//
// Joins to schemes with Unscoped semantics (no `deleted_at IS NULL` filter)
// so a loan whose scheme was later soft-deleted still gets backfilled from
// its last known terms, instead of being silently left at zero. A loan
// whose scheme_id matches no row at all (should not occur — schemes are
// only ever soft-deleted, never hard-deleted) is left at zero and is not
// treated as fatal.
func BackfillSchemeSnapshot(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Loan{}) {
		return nil // fresh install — AutoMigrate will create the columns with defaults
	}
	for _, col := range []string{
		"scheme_code", "scheme_interest_rate", "scheme_duration_months",
		"scheme_ltv_percent", "scheme_interest_method", "scheme_penal_rate",
	} {
		if !db.Migrator().HasColumn(&Loan{}, col) {
			return nil // AutoMigrate has not run yet this boot
		}
	}
	res := db.Exec(`
		UPDATE loans l
		SET scheme_code = s.code,
		    scheme_interest_rate = s.interest_rate,
		    scheme_duration_months = s.duration_months,
		    scheme_ltv_percent = s.ltv_percent,
		    scheme_interest_method = s.interest_method,
		    scheme_penal_rate = s.penal_rate
		FROM schemes s
		WHERE s.id = l.scheme_id
		  AND l.scheme_code = ''
		  AND l.scheme_interest_rate = 0
		  AND l.scheme_ltv_percent = 0`)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("backfilled %d loan(s) with a frozen snapshot of their scheme's terms", res.RowsAffected)
	}
	return nil
}
