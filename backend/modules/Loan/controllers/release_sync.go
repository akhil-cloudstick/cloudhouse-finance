package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"errors"

	"gorm.io/gorm"
)

// releasePaymentDescription is what a payment recorded from a release request is saved with.
const releasePaymentDescription = "Release payment"

// syncReleaseRecorded keeps a release request's "recorded" figures in step with the ledger. The request stores what
// was paid when the payment was recorded; correcting or deleting that payment in the ledger would otherwise leave the
// Review Release screen showing the old amounts. It runs inside the edit's transaction.
func syncReleaseRecorded(ctx context.Context, tx *gorm.DB, loanID uint) error {
	var req models.LoanRequest
	err := tx.WithContext(ctx).
		Where("loan_id = ? AND type = ? AND payment_recorded = ?", loanID, models.RequestTypeRelease, true).
		Order("id desc").First(&req).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	var payments []models.LoanPayment
	if err := tx.WithContext(ctx).
		Where("loan_id = ? AND description = ? AND type <> ?", loanID, releasePaymentDescription, models.PaymentTypeDiscount).
		Find(&payments).Error; err != nil {
		return err
	}
	var paid, discount float64
	ids := make([]uint, 0, len(payments))
	for _, p := range payments {
		paid += p.Amount
		ids = append(ids, p.ID)
	}
	if len(ids) > 0 {
		var linked []models.LoanPayment
		if err := tx.WithContext(ctx).
			Where("loan_id = ? AND type = ? AND linked_payment_id IN ?", loanID, models.PaymentTypeDiscount, ids).
			Find(&linked).Error; err != nil {
			return err
		}
		for _, d := range linked {
			discount += d.Amount
		}
	} else {
		// no release payment left: keep a discount that was recorded on its own
		return nil
	}
	paid, discount = common.RoundMoney(paid), common.RoundMoney(discount)
	if paid == req.RecordedPayment && discount == req.RecordedDiscount {
		return nil
	}
	return tx.WithContext(ctx).Model(&models.LoanRequest{}).Where("id = ?", req.ID).
		Updates(map[string]any{"recorded_payment": paid, "recorded_discount": discount}).Error
}
