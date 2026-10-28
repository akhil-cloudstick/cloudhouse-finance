package controllers

import (
	"context"
	"time"

	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Cash/models"
)

// Helpers a bank pledge edit/delete (Loan module) uses to find, check and rewrite the cash lines and the
// "Bank Pledge Release" expense a pledge booked. All of them write through the transaction in ctx (see WithTx).

// BankPledgeLines is the group of cash lines a bank pledge (or its release) booked, found by the id of the first line.
type BankPledgeLines struct {
	GroupID         string
	Rows            []models.CashMovement
	Total           float64
	Cash, UPI, Bank float64
	BankID          *uint
}

// FindMovementGroup returns the lines that share the transaction group of cash line movementID. It refuses with
// 409 when the line is gone or has no group, and when the lines do not add up to wantTotal of the wantType
// ("in" or "out") — a record whose lines cannot be identified exactly is never rewritten.
func FindMovementGroup(ctx context.Context, groupID string, movementID *uint, wantType string, wantTotal float64) (*BankPledgeLines, error) {
	db := cashDB(ctx)
	if groupID == "" && movementID != nil {
		var m models.CashMovement
		if err := db.First(&m, *movementID).Error; err == nil {
			groupID = m.TransactionGroupID
		}
	}
	if groupID == "" {
		return nil, common.NewConflict("this entry's cash lines cannot be identified exactly, so it cannot be edited safely")
	}
	var rows []models.CashMovement
	if err := db.Where("transaction_group_id = ?", groupID).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := &BankPledgeLines{GroupID: groupID, Rows: rows}
	for _, r := range rows {
		if r.Type != wantType {
			return nil, common.NewConflict("this entry's cash lines are not what was booked for it, so it cannot be edited safely")
		}
		out.Total += r.Amount
		switch r.Mode {
		case models.CashModeCash:
			out.Cash += r.Amount
		case models.CashModeUPI:
			out.UPI += r.Amount
			out.BankID = r.BankID
		case models.CashModeBankTransfer:
			out.Bank += r.Amount
			out.BankID = r.BankID
		}
	}
	out.Total = common.RoundMoney(out.Total)
	if len(rows) == 0 || out.Total-wantTotal > 0.01 || wantTotal-out.Total > 0.01 {
		return nil, common.NewConflict("this entry's cash lines do not add up to the recorded amount, so it cannot be edited safely")
	}
	return out, nil
}

// MovementGroupOf is the transaction group of one cash line ("" when none).
func MovementGroupOf(ctx context.Context, movementID uint) string {
	var m models.CashMovement
	if err := cashDB(ctx).Select("id, transaction_group_id").First(&m, movementID).Error; err != nil {
		return ""
	}
	return m.TransactionGroupID
}

// DeleteMovementGroup removes every cash line of a transaction group.
func DeleteMovementGroup(ctx context.Context, groupID string) error {
	if groupID == "" {
		return nil
	}
	return cashDB(ctx).Where("transaction_group_id = ?", groupID).Delete(&models.CashMovement{}).Error
}

// FindBankPledgeReleaseExpense loads the system expense a pledge release filed, refusing with 409 when it is not
// the entry that release booked (wrong category or amount).
func FindBankPledgeReleaseExpense(ctx context.Context, id uint, wantAmount float64) (*models.Expense, error) {
	var e models.Expense
	if err := cashDB(ctx).First(&e, id).Error; err != nil {
		return nil, common.NewConflict("this release's expense entry is missing, so it cannot be edited safely")
	}
	d := e.Amount - wantAmount
	if e.Category != bankPledgeReleaseCategory || d > 0.01 || d < -0.01 {
		return nil, common.NewConflict("this release's expense entry was changed after it was booked, so it cannot be edited safely")
	}
	return &e, nil
}

// UpdateBankPledgeReleaseExpense rewrites the "Bank Pledge Release" expense entry of an edited release.
func UpdateBankPledgeReleaseExpense(ctx context.Context, id uint, bankName string, amount float64, occurredOn time.Time) error {
	return cashDB(ctx).Model(&models.Expense{}).Where("id = ?", id).
		Updates(map[string]any{"payee": bankName, "amount": amount, "occurred_on": occurredOn}).Error
}

// DeleteBankPledgeReleaseExpense removes a pledge release's expense entry.
func DeleteBankPledgeReleaseExpense(ctx context.Context, id uint) error {
	return cashDB(ctx).Delete(&models.Expense{}, id).Error
}
