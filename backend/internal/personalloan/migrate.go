package personalloan

import (
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
