package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"fmt"
)

// Loan-entry kinds the info popup can offer to edit / delete from the record that booked the cash line.
const (
	loanEntryPersonalPayment      = "personal_payment"
	loanEntryPersonalDisbursement = "personal_disbursement"
	loanEntryInvestment           = "investment_entry"
	loanEntryServiceCharge        = "service_charge"
	loanEntryDisbursementReversal = "disbursement_reversal"
)

// investmentEntryID names the investment ledger entry (the id its editor takes: tx-N, payout-N or open-<investment>)
// a deposit / payout cash line was booked for. txID / payoutID are the transaction / payout whose cash line is in
// the same group as the movement (0 when none). A deposit line that belongs to no transaction is the opening
// deposit; a payout line that belongs to no payout or transaction cannot be identified (empty).
func investmentEntryID(sourceType string, investmentID, txID, payoutID uint) string {
	switch {
	case txID != 0:
		return fmt.Sprintf("tx-%d", txID)
	case payoutID != 0:
		return fmt.Sprintf("payout-%d", payoutID)
	case sourceType == "investment_deposit" && investmentID != 0:
		return fmt.Sprintf("open-%d", investmentID)
	}
	return ""
}

// attachOtherEntry links a system cash line to the personal-loan payment / disbursement, the investment entry, or
// the derived gold-loan charge it was booked for. It reports whether the line was recognised (even if it could not
// be matched to a record, in which case nothing is attached and the popup stays read-only).
func attachOtherEntry(ctx context.Context, m *models.CashMovement, info *entryInfo) bool {
	db := config.DB.WithContext(ctx)
	switch {
	case m.SourceType == SourceLoanServiceCharge && m.SourceID != nil:
		info.LoanEntry, info.LoanID = loanEntryServiceCharge, *m.SourceID
		return true
	case m.SourceType == SourceLoanDisbursementReversed && m.SourceID != nil:
		info.LoanEntry, info.LoanID = loanEntryDisbursementReversal, *m.SourceID
		return true
	case (m.SourceType == "investment_deposit" || m.SourceType == "investment_payout") && m.SourceID != nil:
		ids := []uint{m.ID}
		if m.TransactionGroupID != "" {
			_ = db.Model(&models.CashMovement{}).Where("transaction_group_id = ? AND source_type = ? AND source_id = ?", m.TransactionGroupID, m.SourceType, *m.SourceID).Pluck("id", &ids).Error
		}
		var tx, payout struct{ ID uint }
		_ = db.Table("investment_transactions").Select("id").Where("investment_id = ? AND cash_movement_id IN ?", *m.SourceID, ids).Order("id").Limit(1).Scan(&tx).Error
		if tx.ID == 0 {
			_ = db.Table("investment_payouts").Select("id").Where("investment_id = ? AND cash_movement_id IN ?", *m.SourceID, ids).Order("id").Limit(1).Scan(&payout).Error
		}
		if id := investmentEntryID(m.SourceType, *m.SourceID, tx.ID, payout.ID); id != "" {
			info.LoanEntry, info.LoanID, info.InvestmentEntryID = loanEntryInvestment, *m.SourceID, id
		}
		return true
	case m.TransactionGroupID != "":
		var pay struct {
			ID             uint
			PersonalLoanID uint
		}
		if err := db.Table("personal_loan_payments").Select("id, personal_loan_id").Where("cash_transaction_group_id = ?", m.TransactionGroupID).Order("id").Limit(1).Scan(&pay).Error; err == nil && pay.ID != 0 {
			info.LoanEntry, info.LoanID, info.LoanPaymentID = loanEntryPersonalPayment, pay.PersonalLoanID, pay.ID
			return true
		}
		var pl struct{ ID uint }
		if err := db.Table("personal_loans").Select("id").Where("disbursement_cash_group_id = ?", m.TransactionGroupID).Limit(1).Scan(&pl).Error; err == nil && pl.ID != 0 {
			info.LoanEntry, info.LoanID = loanEntryPersonalDisbursement, pl.ID
			return true
		}
	}
	return false
}
