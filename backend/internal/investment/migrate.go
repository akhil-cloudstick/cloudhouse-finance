package investment

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// payoutSplitColumns are InvestmentPayout's new NOT NULL DEFAULT 0
// split-mode columns, added after investment_payouts had already shipped —
// same AutoMigrate limitation as loan.paymentSplitColumns/
// cash.BackfillGoldSaleColumns: GORM's bare `ADD COLUMN ... NOT NULL` fails
// on a table with existing rows, so each ADD here carries its own DEFAULT.
//
// Unlike LoanPayment/PersonalLoanPayment there is no pre-existing free-text
// Method/Mode column on InvestmentPayout to derive a value from — every
// payout that predates this feature simply had no recorded mode, so 0 across
// all four columns is the only correct value for them, not a guess.
var payoutSplitColumns = []string{"cash_amount", "upi_amount", "bank_transfer_amount", "cheque_amount"}

// BackfillPayoutSplitColumns adds InvestmentPayout's CashAmount/UpiAmount/
// BankTransferAmount/ChequeAmount columns ahead of AutoMigrate. Idempotent
// and a no-op on a fresh install, where AutoMigrate creates the whole table
// correctly itself. Must run BEFORE AutoMigrate.
func BackfillPayoutSplitColumns(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable(&InvestmentPayout{}) {
		return nil // fresh install — AutoMigrate creates the whole table
	}
	for _, col := range payoutSplitColumns {
		if m.HasColumn(&InvestmentPayout{}, col) {
			continue
		}
		if err := db.Exec(fmt.Sprintf(`ALTER TABLE investment_payouts ADD COLUMN %s numeric(16,2) NOT NULL DEFAULT 0`, col)).Error; err != nil {
			return err
		}
		log.Printf("added investment_payouts.%s with a default for pre-existing rows", col)
	}
	return nil
}
