package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"strings"
	"time"

	"gorm.io/gorm"
)

// editGoldSale edits a gold sale from the ledger: the sale, its cash-in line and its cost's cash-out line are
// updated in place (the cost line is added, or removed, as the cost appears or goes to zero).
// syncGoldSaleCost brings the sale's cost cash-out in line with the edited cost: updated when it exists, created when
// the sale gains a cost, removed when the cost goes to zero.
func syncGoldSaleCost(tx *gorm.DB, gs *models.GoldSale, ornament string, cost float64, branch uint, occurred time.Time, mode string, bankID *uint) error {
	if cost <= 0 {
		if gs.CostCashMovementID == nil {
			return nil
		}
		if err := tx.Model(&models.GoldSale{}).Where("id = ?", gs.ID).Update("cost_cash_movement_id", nil).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", *gs.CostCashMovementID).Delete(&models.CashMovement{}).Error
	}
	rec := goldSaleCostMovement(ornament, cost, branch, occurred, mode, bankID)
	if gs.CostCashMovementID != nil {
		var bank any
		if bankID != nil {
			bank = *bankID
		}
		return tx.Model(&models.CashMovement{}).Where("id = ?", *gs.CostCashMovementID).Updates(map[string]any{
			"purpose": rec.Purpose, "amount": cost, "occurred_on": rec.OccurredOn, "mode": mode, "bank_id": bank, "branch_id": branch,
		}).Error
	}
	if err := tx.Create(&rec).Error; err != nil {
		return err
	}
	return tx.Model(&models.GoldSale{}).Where("id = ?", gs.ID).Update("cost_cash_movement_id", rec.ID).Error
}

func editGoldSale(ctx context.Context, m models.CashMovement, req updateEntryRequest, occurred time.Time, branchID *uint, receipt, remarks string) (uint, error) {
	var gs models.GoldSale
	if err := config.DB.WithContext(ctx).Where("cash_movement_id = ?", m.ID).First(&gs).Error; err != nil {
		return 0, common.NewNotFound("gold sale not found")
	}
	ornament := strings.TrimSpace(req.OrnamentType)
	if ornament == "" {
		return 0, common.NewBadRequest("ornament type is required")
	}
	if req.Amount <= 0 {
		return 0, common.NewBadRequest("sold amount must be greater than zero")
	}
	if req.CostAmount < 0 {
		return 0, common.NewBadRequest("cost amount must be zero or greater")
	}
	mode := req.Mode
	if mode == "" {
		mode = models.CashModeCash
	}
	if !modeVocabulary[mode] {
		return 0, common.NewBadRequest("mode must be Cash, UPI or Bank Transfer")
	}
	var bankID any
	if mode != models.CashModeCash {
		if req.BankID == nil || *req.BankID == 0 {
			return 0, common.NewBadRequest("bank is required when mode is UPI or Bank Transfer")
		}
		bankID = *req.BankID
	}
	costMode, costBankID, err := costPayment(req.CostAmount, req.CostMode, req.CostBankID)
	if err != nil {
		return 0, err
	}
	var costBank any
	if costBankID != nil {
		costBank = *costBankID
	}
	branch := gs.BranchID
	if branchID != nil {
		branch = *branchID
	}
	sold, cost := common.RoundMoney(req.Amount), common.RoundMoney(req.CostAmount)
	err = config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.GoldSale{}).Where("id = ?", gs.ID).Updates(map[string]any{
			"ornament_type": ornament, "sold_amount": sold, "cost_amount": cost, "profit": sold - cost, "sold_on": occurred,
			"branch_id": branch, "mode": mode, "bank_id": bankID, "remarks": remarks, "receipt_image": receipt,
			"cost_mode": costMode, "cost_bank_id": costBank,
		}).Error; err != nil {
			return err
		}
		if err := syncGoldSaleCost(tx, &gs, ornament, cost, branch, occurred, costMode, costBankID); err != nil {
			return err
		}
		return tx.Model(&models.CashMovement{}).Where("id = ?", m.ID).Updates(map[string]any{
			"purpose": "Gold sale — " + ornament, "amount": sold, "occurred_on": occurred, "mode": mode, "bank_id": bankID,
			"branch_id": branch, "remarks": remarks, "receipt_image": receipt,
		}).Error
	})
	if err != nil {
		return 0, err
	}
	return m.ID, nil
}
