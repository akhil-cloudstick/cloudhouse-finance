package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"fmt"
	"math"
)

// Helpers the loan module's auction edit uses to remove and re-book the cash lines an auction wrote. They write
// through the transaction carried by WithTx, so the lines change together with the auction record.

// DeleteLinesByGroup removes every cash line saved under one transaction group, whatever its source.
func DeleteLinesByGroup(ctx context.Context, groupID string) error {
	if groupID == "" {
		return nil
	}
	return cashDB(ctx).Where("transaction_group_id = ?", groupID).Delete(&models.CashMovement{}).Error
}

// GetMovement returns one cash line.
func GetMovement(ctx context.Context, id uint) (*models.CashMovement, error) {
	var m models.CashMovement
	if err := cashDB(ctx).First(&m, id).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

// DeleteMovementLine removes one cash line.
func DeleteMovementLine(ctx context.Context, id uint) error {
	return cashDB(ctx).Where("id = ?", id).Delete(&models.CashMovement{}).Error
}

// DeleteAuctionExpense removes the expense register entry (and its cash-out line) an auction's sale booked for a
// loan. It is found by its payee and category, and only removed when exactly one entry of that amount exists, so
// an expense it cannot identify is never touched.
func DeleteAuctionExpense(ctx context.Context, loanNumber string, amount float64) error {
	var found []models.Expense
	if err := cashDB(ctx).Where("category = ? AND payee = ? AND status = ?", auctionExpenseCategory, "Auction — "+loanNumber, "Approved").Find(&found).Error; err != nil {
		return err
	}
	var match []models.Expense
	for _, e := range found {
		if math.Abs(e.Amount-amount) <= 0.01 {
			match = append(match, e)
		}
	}
	if len(match) != 1 {
		return common.NewConflict(fmt.Sprintf("the auction's expense entry of ₹%.2f cannot be identified exactly (%d found), so it cannot be edited safely", amount, len(match)))
	}
	if err := cashDB(ctx).Where("expense_id = ?", match[0].ID).Delete(&models.CashMovement{}).Error; err != nil {
		return err
	}
	return cashDB(ctx).Where("id = ?", match[0].ID).Delete(&models.Expense{}).Error
}
