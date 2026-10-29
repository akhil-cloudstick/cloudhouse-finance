package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	cashModels "cloudhouse/backend/modules/Cash/models"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// Editing or deleting a top-up works like editing a payment (see rebuild.go): the top-up changes, the loan's
// principal follows it, and the loan is recalculated from its first day with every top-up applied on its date.
// The cash lines the top-up booked are removed and booked again.

const topUpSettlementDescription = "Interest settled from top-up payout"

// EditTopUpInput holds the fields a top-up edit may change; nil means "leave as is".
type EditTopUpInput struct {
	OccurredOn         *time.Time
	Amount             *float64
	CashAmount         *float64
	UpiAmount          *float64
	BankTransferAmount *float64
	BankID             *uint
	Reference          *string
}

// topUpCashGroup is the cash-book group a top-up booked. A top-up from before groups were saved is found by its
// purpose, date and customer, and only used when its lines add up to exactly the top-up's amount.
func topUpCashGroup(ctx context.Context, tx *gorm.DB, l *models.Loan, t *models.LoanTopUp) (string, error) {
	if t.CashTransactionGroupID != "" {
		return t.CashTransactionGroupID, nil
	}
	var groups []struct {
		TransactionGroupID string
		Total              float64
	}
	if err := tx.WithContext(ctx).Table("cash_movements").
		Select("transaction_group_id, SUM(amount) AS total").
		Where("purpose = ? AND type = ? AND occurred_on = ? AND transaction_group_id <> ''", "Loan top-up — "+l.LoanNumber, "out", t.OccurredOn).
		Group("transaction_group_id").Scan(&groups).Error; err != nil {
		return "", err
	}
	var match []string
	for _, g := range groups {
		if absMoney(g.Total-t.Amount) <= 0.01 {
			match = append(match, g.TransactionGroupID)
		}
	}
	if len(match) != 1 {
		return "", common.NewConflict("this top-up's cash entries cannot be identified exactly, so it cannot be edited safely")
	}
	return match[0], nil
}

func absMoney(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

// editLoanTopUp edits (in != nil) or deletes (in == nil) one top-up, then recalculates the loan.
func editLoanTopUp(ctx context.Context, loanID, topUpID uint, in *EditTopUpInput, reason string, dryRun bool) (*EditPaymentResult, *models.LoanTopUp, error) {
	result := &EditPaymentResult{DryRun: dryRun}
	var oldTopUp *models.LoanTopUp
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID)
		if err != nil {
			return common.NewNotFound("loan not found")
		}
		all, rows, err := loadReplayRows(ctx, tx, loanID)
		if err != nil {
			return err
		}
		if err := guardReplayable(ctx, tx, l, all); err != nil {
			return err
		}
		originalStatus := l.Status
		result.Before = summarize(l)

		ups, err := activeTopUpsInOrder(ctx, tx, loanID)
		if err != nil {
			return err
		}
		idx := -1
		var sum float64
		for i := range ups {
			sum = common.RoundMoney(sum + ups[i].Amount)
			if ups[i].ID == topUpID {
				idx = i
			}
		}
		if idx < 0 {
			return common.NewNotFound("this top-up cannot be edited (it is not an approved top-up of this loan)")
		}
		old := ups[idx]
		oldTopUp = &old

		// The loan is first recalculated untouched: if that does not reproduce what is saved, an edit would
		// silently change figures this recalculation cannot explain. Only the entries from the top-up's date on
		// (the earlier of its old and new date) are recalculated; what was saved before it is kept as it is.
		// Multiple-interest loans restate earlier interest rows when the rate steps, so they are recalculated whole.
		earliest := old.OccurredOn
		if in != nil && in.OccurredOn != nil && in.OccurredOn.Before(earliest) {
			earliest = *in.OccurredOn
		}
		from := len(rows)
		for i := range rows {
			if !rows[i].PaidOn.Before(earliest) {
				from = i
				break
			}
		}
		if l.SchemeInterestMethod == commonModels.InterestMethodMultiple {
			from = 0
		}
		if err := probeReplayFrom(ctx, tx, l, rows, originalStatus, from); err != nil {
			return err
		}

		group, err := topUpCashGroup(ctx, tx, l, &old)
		if err != nil {
			return err
		}

		initial := common.RoundMoney(l.PrincipalAmount - sum)
		newSum := sum
		edited := rows
		var settlementID uint
		var movedSettlement string
		var movedSettlementID uint
		var t models.LoanTopUp
		if in == nil {
			newSum = common.RoundMoney(sum - old.Amount)
			// the interest taken out of this top-up's payout goes with it
			kept := make([]models.LoanPayment, 0, len(rows))
			for _, p := range rows {
				if settlementID == 0 && p.Description == topUpSettlementDescription && p.PaidOn.Sub(old.OccurredOn) >= 0 && p.PaidOn.Sub(old.OccurredOn) <= 2*time.Millisecond {
					settlementID = p.ID
					continue
				}
				kept = append(kept, p)
			}
			edited = kept
			if err := tx.WithContext(ctx).Delete(&models.LoanTopUp{}, topUpID).Error; err != nil {
				return err
			}
		} else {
			t = old
			if in.OccurredOn != nil {
				t.OccurredOn = *in.OccurredOn
			}
			if in.Amount != nil {
				t.Amount = common.RoundMoney(*in.Amount)
			}
			if in.CashAmount != nil {
				t.CashAmount = *in.CashAmount
			}
			if in.UpiAmount != nil {
				t.UpiAmount = *in.UpiAmount
			}
			if in.BankTransferAmount != nil {
				t.BankTransferAmount = *in.BankTransferAmount
			}
			if in.BankID != nil {
				t.BankID = in.BankID
			}
			if in.Reference != nil {
				t.Reference = *in.Reference
			}
			if err := validateTopUpSplit(TopUpInput{Amount: t.Amount, CashAmount: t.CashAmount, UpiAmount: t.UpiAmount, BankTransferAmount: t.BankTransferAmount, ChequeAmount: t.ChequeAmount, BankID: t.BankID}); err != nil {
				return err
			}
			if t.Amount <= 0 {
				return common.NewBadRequest("amount must be greater than zero")
			}
			if err := validatePaymentDateWindow(l, t.OccurredOn); err != nil {
				return err
			}
			for i := range edited {
				p := &edited[i]
				if p.Description != topUpSettlementDescription || p.PaidOn.Sub(old.OccurredOn) < 0 || p.PaidOn.Sub(old.OccurredOn) > 2*time.Millisecond {
					continue
				}
				if t.Amount+0.01 < p.Amount {
					return common.NewBadRequest(fmt.Sprintf("the top-up cannot be less than the ₹%.2f interest settled from its payout", p.Amount))
				}
				if in.OccurredOn != nil {
					p.PaidOn = t.OccurredOn.Add(time.Millisecond) // the interest taken from the payout moves with the top-up
					movedSettlement = p.CashTransactionGroupID
					movedSettlementID = p.ID
				}
				break
			}
			if movedSettlementID != 0 {
				sortReplayRows(edited)
			}
			newSum = common.RoundMoney(sum - old.Amount + t.Amount)
			if err := tx.WithContext(ctx).Save(&t).Error; err != nil {
				return err
			}
		}
		l.PrincipalAmount = common.RoundMoney(initial + newSum)

		if err := replayLoanFrom(ctx, tx, l, edited, originalStatus, from); err != nil {
			return common.NewBadRequest(err.Error())
		}
		if in != nil && in.Amount != nil && t.Amount > old.Amount+0.005 {
			if err := checkTopUpEligible(ctx, l, initial, ups, &t, edited); err != nil {
				return err
			}
		}
		result.After = summarize(l)
		if dryRun {
			return errDryRun
		}

		for i := range edited {
			if err := tx.WithContext(ctx).Save(&edited[i]).Error; err != nil {
				return err
			}
		}
		if settlementID != 0 {
			var settlement models.LoanPayment
			if err := tx.WithContext(ctx).First(&settlement, settlementID).Error; err == nil {
				if err := cashbook.DeleteCollectionByGroup(cashbook.WithTx(ctx, tx), settlement.CashTransactionGroupID); err != nil {
					return err
				}
			}
			if err := tx.WithContext(ctx).Delete(&models.LoanPayment{}, settlementID).Error; err != nil {
				return err
			}
		}
		if err := updateLoanTx(ctx, tx, l); err != nil {
			return err
		}
		// The top-up's cash-out lines are removed and, for an edit, booked again as corrected.
		if err := tx.WithContext(ctx).Where("transaction_group_id = ?", group).Delete(&cashModels.CashMovement{}).Error; err != nil {
			return err
		}
		if movedSettlement != "" {
			if err := tx.WithContext(ctx).Model(&cashModels.CashMovement{}).Where("transaction_group_id = ?", movedSettlement).Update("occurred_on", t.OccurredOn).Error; err != nil {
				return err
			}
		}
		if in != nil {
			_, groupID, err := cashbook.RecordLoanTopUpCashOut(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, t.Amount, t.CashAmount, t.UpiAmount, t.BankTransferAmount, t.ChequeAmount, l.BranchID, t.OccurredOn, l.CustomerID, t.BankID)
			if err != nil {
				return fmt.Errorf("could not record the corrected top-up in Cash-in-Hand: %w", err)
			}
			if err := tx.WithContext(ctx).Model(&models.LoanTopUp{}).Where("id = ?", t.ID).Update("cash_transaction_group_id", groupID).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, errDryRun) {
		return result, oldTopUp, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return result, oldTopUp, nil
}

func writeTopUpAudit(ctx context.Context, actorEmployeeID uint, action string, loanID uint, loanNumber, reason string, old *models.LoanTopUp, res *EditPaymentResult) {
	actorName := "unknown"
	if actor, err := common.FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	oldJSON, _ := json.Marshal(old)
	detail := fmt.Sprintf("reason: %s | top-up before: %s | loan before: %+v | loan after: %+v", reason, oldJSON, res.Before, res.After)
	_ = common.InsertAuditLog(ctx, &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID, ActorName: actorName, Action: action,
		EntityType: "loan", EntityID: loanID, EntityName: loanNumber, Detail: detail,
	})
}

type editTopUpRequest struct {
	OccurredOn         *string  `json:"occurred_on"`
	Amount             *float64 `json:"amount"`
	CashAmount         *float64 `json:"cash_amount"`
	UpiAmount          *float64 `json:"upi_amount"`
	BankTransferAmount *float64 `json:"bank_transfer_amount"`
	BankID             *uint    `json:"bank_id"`
	Reference          *string  `json:"reference"`
	Reason             string   `json:"reason"`
}

// EditLoanTopUp is PATCH /loans/:id/top-ups/:top_up_id[?dry_run=true].
func EditLoanTopUp(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	topUpID, err := common.IDParam(c, "top_up_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	var req editTopUpRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in := &EditTopUpInput{
		Amount: req.Amount, CashAmount: req.CashAmount, UpiAmount: req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount, BankID: req.BankID, Reference: req.Reference,
	}
	if req.OccurredOn != nil {
		d, err := parsePaidOn(*req.OccurredOn)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid occurred_on: expected YYYY-MM-DD"})
		}
		in.OccurredOn = &d
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, old, err := editLoanTopUp(ctx, loanID, topUpID, in, req.Reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actorEmployeeID, _, _ := auth.ActorFromContext(c)
		writeTopUpAudit(ctx, actorEmployeeID, "Top-up edited", loanID, loanNumberOf(ctx, loanID), req.Reason, old, res)
	}
	return common.Success(c, http.StatusOK, res)
}

// DeleteLoanTopUp is DELETE /loans/:id/top-ups/:top_up_id?reason=…[&dry_run=true].
func DeleteLoanTopUp(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	topUpID, err := common.IDParam(c, "top_up_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	reason := c.QueryParam("reason")
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, old, err := editLoanTopUp(ctx, loanID, topUpID, nil, reason, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actorEmployeeID, _, _ := auth.ActorFromContext(c)
		writeTopUpAudit(ctx, actorEmployeeID, "Top-up deleted", loanID, loanNumberOf(ctx, loanID), reason, old, res)
	}
	return common.Success(c, http.StatusOK, res)
}

// checkTopUpEligible refuses an edit that raises a top-up so far that the principal right after it is above what the
// pledged gold allows (the same limit a new top-up is held to). edited holds the recalculated payments.
func checkTopUpEligible(ctx context.Context, l *models.Loan, initial float64, ups []models.LoanTopUp, t *models.LoanTopUp, edited []models.LoanPayment) error {
	ornaments, err := FindByLoanID(ctx, l.ID)
	if err != nil {
		return err
	}
	lc := *l
	recalculateTotals(&lc, ornaments)
	principal := initial
	for _, u := range ups {
		amount := u.Amount
		if u.ID == t.ID {
			amount = t.Amount
		}
		if u.ID == t.ID || u.OccurredOn.Before(t.OccurredOn) || (u.OccurredOn.Equal(t.OccurredOn) && u.ID < t.ID) {
			principal += amount
		}
	}
	for _, p := range edited {
		if p.PaidOn.Before(t.OccurredOn) {
			principal -= p.PrincipalApplied
		}
	}
	principal = common.RoundMoney(principal)
	if principal > common.RoundMoney(lc.EligibleLoanAmount)+0.01 {
		return common.NewBadRequest(fmt.Sprintf("the top-up would take the principal to ₹%.2f, above the eligible loan amount ₹%.2f (based on scheme LTV)", principal, lc.EligibleLoanAmount))
	}
	return nil
}
