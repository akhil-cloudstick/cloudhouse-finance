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

// editGoldSale edits a gold sale from the ledger: the sale and its one cash line are updated in place. A sale
// from before the cost stopped being booked as a cash-out has a second cash line and is left alone.
func editGoldSale(ctx context.Context, m models.CashMovement, req updateEntryRequest, occurred time.Time, branchID *uint, receipt, remarks string) (uint, error) {
	var gs models.GoldSale
	if err := config.DB.WithContext(ctx).Where("cash_movement_id = ?", m.ID).First(&gs).Error; err != nil {
		return 0, common.NewNotFound("gold sale not found")
	}
	if gs.CostCashMovementID != nil {
		return 0, common.NewConflict("this older gold sale can't be edited")
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
	branch := gs.BranchID
	if branchID != nil {
		branch = *branchID
	}
	sold, cost := common.RoundMoney(req.Amount), common.RoundMoney(req.CostAmount)
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.GoldSale{}).Where("id = ?", gs.ID).Updates(map[string]any{
			"ornament_type": ornament, "sold_amount": sold, "cost_amount": cost, "profit": sold - cost, "sold_on": occurred,
			"branch_id": branch, "mode": mode, "bank_id": bankID, "remarks": remarks, "receipt_image": receipt,
		}).Error; err != nil {
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
