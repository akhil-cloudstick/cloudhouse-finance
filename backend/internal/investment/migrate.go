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

// engineTables/liveNumericColumns are the columns the Live-accrual engine
// (Engine, OutstandingPrincipal, AccruedInterest, InterestWithdrawn) needs
// on tables that may already have rows — same "AutoMigrate can't add
// NOT NULL to a populated table" reason BackfillPayoutSplitColumns
// documents. Every pre-existing plan/investment backfills to
// Engine='Schedule' and the three balance columns to 0, which is exactly
// what an EngineSchedule row should have — see model_plan.go/
// model_investment.go's Engine* doc comments. LastAccrualDate needs no
// backfill: it has no gorm NOT NULL tag (bare time.Time, same as
// loan.Loan.LastAccrualDate), so AutoMigrate adds it nullable on its own.
var engineTables = []string{"investment_plans", "investments"}
var liveNumericColumns = []string{"outstanding_principal", "accrued_interest", "interest_withdrawn"}

// BackfillEngineColumn adds the Engine column to investment_plans/
// investments, and the Live-engine balance columns to investments, ahead of
// AutoMigrate. Idempotent and a no-op on a fresh install. Must run BEFORE
// AutoMigrate.
func BackfillEngineColumn(db *gorm.DB) error {
	m := db.Migrator()
	for _, tbl := range engineTables {
		if !m.HasTable(tbl) {
			continue // fresh install — AutoMigrate creates the whole table
		}
		if !m.HasColumn(tbl, "engine") {
			if err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN engine varchar(10) NOT NULL DEFAULT 'Schedule'`, tbl)).Error; err != nil {
				return err
			}
			log.Printf("added %s.engine defaulted to Schedule for pre-existing rows", tbl)
		}
	}
	if m.HasTable("investments") {
		for _, col := range liveNumericColumns {
			if m.HasColumn("investments", col) {
				continue
			}
			if err := db.Exec(fmt.Sprintf(`ALTER TABLE investments ADD COLUMN %s numeric(16,2) NOT NULL DEFAULT 0`, col)).Error; err != nil {
				return err
			}
			log.Printf("added investments.%s defaulted to 0 for pre-existing rows", col)
		}
	}
	return nil
}
