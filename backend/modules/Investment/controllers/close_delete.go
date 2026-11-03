package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	cashModels "cloudhouse/backend/modules/Cash/models"
	"cloudhouse/backend/modules/Investment/models"
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// investmentCashSources are the cash-ledger source types every investment cash line is booked under: the opening
// deposit and add-cash top-ups (in), and interest payouts, principal returns and withdrawals (out).
var investmentCashSources = []string{"investment_deposit", "investment_payout"}

// legacyCashPurposes are the purposes an investment's cash lines were booked with before cash lines carried a
// source link, so a delete also finds lines written back then.
func legacyCashPurposes(number string) []string {
	kinds := []string{"Investment deposit", "Interest payout", "Principal return", "Interest withdrawal", "Principal withdrawal", "Interest & Principal withdrawal"}
	out := make([]string, 0, len(kinds))
	for _, k := range kinds {
		out = append(out, k+" — "+number)
	}
	return out
}

// amountOwed describes what an investment still owes its investor ("" when nothing is): principal not yet paid
// back, interest accrued but not withdrawn (live engine) and payouts still pending. A live investment must be
// settled up to today first.
func amountOwed(ctx context.Context, tx *gorm.DB, inv *models.Investment) (string, error) {
	var pending []models.InvestmentPayout
	if err := tx.WithContext(ctx).Where("investment_id = ? AND status = ?", inv.ID, "Pending").Find(&pending).Error; err != nil {
		return "", err
	}
	var principal, interest float64
	if inv.Engine == models.EngineLive {
		principal = inv.OutstandingPrincipal
		interest = clampMoney(inv.AccruedInterest - inv.InterestWithdrawn)
	} else {
		// a scheduled investment pays its principal back through a principal-return payout
		var returned float64
		if err := tx.WithContext(ctx).Model(&models.InvestmentPayout{}).
			Where("investment_id = ? AND status = ? AND is_principal_return = ?", inv.ID, "Paid", true).
			Select("COALESCE(SUM(amount), 0)").Scan(&returned).Error; err != nil {
			return "", err
		}
		principal = math.Max(0, common.RoundMoney(inv.PrincipalAmount-returned))
	}
	var parts []string
	if principal > epsilon {
		parts = append(parts, fmt.Sprintf("₹%.2f principal", principal))
	}
	if interest > epsilon {
		parts = append(parts, fmt.Sprintf("₹%.2f interest", interest))
	}
	if n := len(pending); n > 0 {
		s := "s"
		if n == 1 {
			s = ""
		}
		parts = append(parts, fmt.Sprintf("%d pending payout%s", n, s))
	}
	return strings.Join(parts, ", "), nil
}

// closeInvestment closes an active or matured investment that owes the investor nothing more: every payout is
// paid and the principal has been paid back, so no cash moves. It also tidies up a live investment left Active
// with ₹0 after everything was withdrawn.
func closeInvestment(ctx context.Context, investmentID uint, branchID *uint) (*models.Investment, error) {
	var closed *models.Investment
	err := investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("investment not found")
			}
			return err
		}
		if inv.Status != models.StatusActive && inv.Status != models.StatusMatured {
			return common.NewConflict("only an active or matured investment can be closed")
		}
		now := time.Now()
		if inv.Engine == models.EngineLive {
			if err := settleAndSave(ctx, tx, inv, now); err != nil {
				return err
			}
		}
		owed, err := amountOwed(ctx, tx, inv)
		if err != nil {
			return err
		}
		if owed != "" {
			return common.NewConflict("This investment cannot be closed yet — " + owed + " still owed to the investor.")
		}
		inv.OutstandingPrincipal = 0
		inv.Status = "Closed"
		inv.ClosedAt = &now
		if err := persistInvestment(ctx, tx, inv); err != nil {
			return err
		}
		closed = inv
		return nil
	})
	if err != nil {
		return nil, err
	}
	return closed, nil
}

// investmentDeleteBlocker is why an investment cannot be deleted ("" if it can). The investment a renewal rolled
// into holds this one's principal, so that one is deleted first (which reopens this one).
func investmentDeleteBlocker(inv *models.Investment) string {
	if inv.RenewedToInvestmentID != nil {
		return "it was renewed into another investment — delete that one first"
	}
	return ""
}

// reopenRenewedFrom undoes a renewal when the investment it rolled into is deleted: the earlier investment is
// Matured again and owes its principal. On a live investment the interest the renewal queued is taken back if
// it is still unpaid (a paid one stays, with its cash line).
func reopenRenewedFrom(ctx context.Context, tx *gorm.DB, inv *models.Investment) error {
	if inv.RenewedFromInvestmentID == nil {
		return nil
	}
	prev, err := lockByID(ctx, tx, *inv.RenewedFromInvestmentID, nil)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if prev.RenewedToInvestmentID == nil || *prev.RenewedToInvestmentID != inv.ID {
		return nil
	}
	if prev.Engine == models.EngineLive {
		var queued []models.InvestmentPayout
		if err := tx.WithContext(ctx).Where("investment_id = ? AND status = ? AND is_principal_return = ?", prev.ID, "Pending", false).Find(&queued).Error; err != nil {
			return err
		}
		for _, p := range queued {
			prev.InterestWithdrawn = math.Max(0, common.RoundMoney(prev.InterestWithdrawn-p.Amount))
		}
		if len(queued) > 0 {
			if err := tx.WithContext(ctx).Where("investment_id = ? AND status = ? AND is_principal_return = ?", prev.ID, "Pending", false).Delete(&models.InvestmentPayout{}).Error; err != nil {
				return err
			}
		}
		prev.OutstandingPrincipal = prev.PrincipalAmount
	}
	prev.Status = models.StatusMatured
	prev.ClosedAt = nil
	prev.RenewedToInvestmentID = nil
	return persistInvestment(ctx, tx, prev)
}

// deleteInvestment removes an investment at any stage, in one transaction: every cash line it booked (opening
// deposit, add-cash, interest payouts, principal returns, withdrawals, maturity settlement) is reversed, its
// payouts and transactions are removed, and a renewal it came from is undone. The investment row itself is
// soft-deleted so its number is never handed out again. Returns the investment and the cash lines reversed.
func deleteInvestment(ctx context.Context, investmentID uint, branchID *uint) (*models.Investment, int64, error) {
	var deleted *models.Investment
	var reversed int64
	err := investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := lockByID(ctx, tx, investmentID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("investment not found")
			}
			return err
		}
		if reason := investmentDeleteBlocker(inv); reason != "" {
			return common.NewConflict("This investment cannot be deleted — " + reason + ".")
		}
		res := tx.WithContext(ctx).Where("source_type IN ? AND source_id = ?", investmentCashSources, inv.ID).Delete(&cashModels.CashMovement{})
		if res.Error != nil {
			return res.Error
		}
		reversed = res.RowsAffected
		legacy := tx.WithContext(ctx).Where("COALESCE(source_type, '') = '' AND is_manual = ? AND purpose IN ?", false, legacyCashPurposes(inv.InvestmentNumber)).Delete(&cashModels.CashMovement{})
		if legacy.Error != nil {
			return legacy.Error
		}
		reversed += legacy.RowsAffected
		if err := tx.WithContext(ctx).Where("investment_id = ?", inv.ID).Delete(&models.InvestmentPayout{}).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Where("investment_id = ?", inv.ID).Delete(&models.InvestmentTransaction{}).Error; err != nil {
			return err
		}
		if err := reopenRenewedFrom(ctx, tx, inv); err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Delete(&models.Investment{}, inv.ID).Error; err != nil {
			return err
		}
		deleted = inv
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	return deleted, reversed, nil
}

func writeInvestmentEvent(ctx context.Context, actorEmployeeID uint, action string, inv *models.Investment, detail string) {
	actorName := "unknown"
	if actor, err := common.FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	_ = common.InsertAuditLog(ctx, &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID, ActorName: actorName, Action: action,
		EntityType: "investment", EntityID: inv.ID, EntityName: inv.InvestmentNumber, Detail: detail,
	})
}

// CloseInvestment is POST /investments/:id/close.
func CloseInvestment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := closeInvestment(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	actor, _, _ := auth.ActorFromContext(c)
	writeInvestmentEvent(ctx, actor, "Investment closed", rec, "closed with nothing owed to the investor; no cash moved")
	return common.Success(c, http.StatusOK, rec)
}

// DeleteInvestment is DELETE /investments/:id/delete[?reason=…].
func DeleteInvestment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	inv, reversed, err := deleteInvestment(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	detail := fmt.Sprintf("status %s, principal ₹%.2f; %d cash line(s) reversed", inv.Status, inv.PrincipalAmount, reversed)
	if r := strings.TrimSpace(c.QueryParam("reason")); r != "" {
		detail = "reason: " + r + " | " + detail
	}
	actor, _, _ := auth.ActorFromContext(c)
	writeInvestmentEvent(ctx, actor, "Investment deleted", inv, detail)
	return common.Success(c, http.StatusOK, echo.Map{"deleted": true})
}
