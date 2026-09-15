package personalloan

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// BackfillRenewedLoanInstallments is a one-time, idempotent step for
// personal loans that were renewed before RenewLoan started marking the old
// loan's remaining installments Paid (see Service.markAllInstallmentsPaid).
// Any personal_loans row already sitting at Status=Renewed had its
// OutstandingAmount zeroed and a rollover ledger entry recorded at the
// time, but its schedule rows were left at whatever Pending/PartiallyPaid
// status they happened to be in — reading as a loan still owed money it
// had, in fact, already settled via the renewal. Safe to re-run: once every
// Renewed loan's installments are Paid, the UPDATE matches nothing.
func BackfillRenewedLoanInstallments(db *gorm.DB) error {
	if !db.Migrator().HasTable(&PersonalLoan{}) {
		return nil // fresh install — no legacy rows to fix
	}
	res := db.Exec(`
		UPDATE personal_loan_installments
		SET status = ?, paid_amount = amount
		WHERE status <> ?
		AND personal_loan_id IN (SELECT id FROM personal_loans WHERE status = ?)`,
		InstallmentStatusPaid, InstallmentStatusPaid, StatusRenewed)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("backfilled %d installment(s) to Paid across already-renewed personal loans", res.RowsAffected)
	}
	return nil
}

// paymentSplitColumns are PersonalLoanPayment's new NOT NULL DEFAULT 0
// split-mode columns — see loan.paymentSplitColumns for the identical
// rationale.
var paymentSplitColumns = []string{"cash_amount", "upi_amount", "bank_transfer_amount", "cheque_amount"}

// BackfillPaymentSplitColumns is personal_loan_payments' counterpart to
// loan.BackfillPaymentSplitColumns — same column-add-with-DEFAULT mechanics,
// same exact-mapping-only Method backfill, same "never overwrite an
// already-split row" guard. The one difference: PaymentMethodRenewalRollover
// ("Renewal Rollover") is a legitimate, recognized value that moves no real
// cash — RenewLoan's synthetic rollover entry — so it is excluded from the
// NeedsModeReview flag rather than being (incorrectly) treated as an
// unrecognized mode. Must run BEFORE AutoMigrate.
func BackfillPaymentSplitColumns(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable(&PersonalLoanPayment{}) {
		return nil // fresh install — AutoMigrate creates the whole table
	}
	for _, col := range paymentSplitColumns {
		if m.HasColumn(&PersonalLoanPayment{}, col) {
			continue
		}
		if err := db.Exec(fmt.Sprintf(`ALTER TABLE personal_loan_payments ADD COLUMN %s numeric(16,2) NOT NULL DEFAULT 0`, col)).Error; err != nil {
			return err
		}
		log.Printf("added personal_loan_payments.%s with a default for pre-existing rows", col)
	}
	if !m.HasColumn(&PersonalLoanPayment{}, "needs_mode_review") {
		if err := db.Exec(`ALTER TABLE personal_loan_payments ADD COLUMN needs_mode_review boolean NOT NULL DEFAULT false`).Error; err != nil {
			return err
		}
		log.Printf("added personal_loan_payments.needs_mode_review with a default for pre-existing rows")
	}

	const unsplit = `cash_amount = 0 AND upi_amount = 0 AND bank_transfer_amount = 0 AND cheque_amount = 0`
	mapping := []struct{ method, column string }{
		{"cash", "cash_amount"},
		{"upi", "upi_amount"},
		{"bank transfer", "bank_transfer_amount"},
		{"cheque", "cheque_amount"},
	}
	var mapped int64
	for _, mp := range mapping {
		res := db.Exec(fmt.Sprintf(`UPDATE personal_loan_payments SET %s = amount WHERE %s AND LOWER(TRIM(method)) = ?`, mp.column, unsplit), mp.method)
		if res.Error != nil {
			return res.Error
		}
		mapped += res.RowsAffected
	}
	if mapped > 0 {
		log.Printf("backfilled %d personal_loan_payments row(s) from Method into a split column", mapped)
	}

	res := db.Exec(fmt.Sprintf(`
		UPDATE personal_loan_payments SET needs_mode_review = true
		WHERE %s AND amount <> 0
		AND LOWER(TRIM(method)) NOT IN ('cash', 'upi', 'bank transfer', 'cheque', 'renewal rollover')`, unsplit))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("flagged %d personal_loan_payments row(s) with an unrecognized Method for manual mode review", res.RowsAffected)
	}
	return nil
}

// BackfillFullDisbursementColumn adds PersonalLoan.FullDisbursement's
// full_disbursement column ahead of AutoMigrate. GORM's AutoMigrate issues a
// bare `ALTER TABLE ... ADD full_disbursement boolean NOT NULL`, which
// Postgres rejects outright on a table that already has rows ("column
// contains null values") — same failure mode as cash.BackfillGoldSaleColumns,
// same fix: give the ADD its own DEFAULT so existing rows satisfy the NOT
// NULL immediately, since the failing statement is the ADD itself, not a
// later UPDATE. Every pre-existing loan predates this feature, so `false`
// (today's default, unchecked, behavior) is the only correct value for them
// — not a guess. Idempotent and a no-op on a fresh install, where AutoMigrate
// creates the whole table correctly itself.
func BackfillFullDisbursementColumn(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable(&PersonalLoan{}) {
		return nil // fresh install — AutoMigrate creates the whole table
	}
	if m.HasColumn(&PersonalLoan{}, "full_disbursement") {
		return nil
	}
	if err := db.Exec(`ALTER TABLE personal_loans ADD COLUMN full_disbursement boolean NOT NULL DEFAULT false`).Error; err != nil {
		return err
	}
	log.Printf("added personal_loans.full_disbursement with a default for pre-existing rows")
	return nil
}

// BackfillRenewedLoanStatus is a one-time, idempotent step for personal
// loans that were renewed before RenewLoan started closing the old loan
// outright (Status=Closed) instead of leaving it at the old, separate
// Status=Renewed — a renewed loan is genuinely finished (fully settled via
// the rollover ledger entry, its gold/repayment obligation moved to the new
// loan), and RenewedToLoanID already records that it was closed BY a
// renewal specifically, so a "closed loans" list/filter should include it.
// Safe to re-run: once every Renewed row is Closed, the UPDATE matches
// nothing.
func BackfillRenewedLoanStatus(db *gorm.DB) error {
	if !db.Migrator().HasTable(&PersonalLoan{}) {
		return nil // fresh install — no legacy rows to fix
	}
	res := db.Exec(`UPDATE personal_loans SET status = ? WHERE status = ?`, StatusClosed, StatusRenewed)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("backfilled %d personal loan(s) from Renewed to Closed", res.RowsAffected)
	}
	return nil
}
