package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	cashModels "cloudhouse/backend/modules/Cash/models"
	"cloudhouse/backend/modules/Investment/models"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// An investment's details can be corrected only while nothing has been built on them: it is Active
// and no payout, interest, add-cash, withdrawal or renewal has happened. The investor and branch
// never change. Anything later is fixed from the ledger instead.

type editInvestmentRequest struct {
	PlanID             *uint    `json:"plan_id"`
	PrincipalAmount    *float64 `json:"principal_amount"`
	StartDate          *string  `json:"start_date"`
	CashAmount         *float64 `json:"cash_amount"`
	UpiAmount          *float64 `json:"upi_amount"`
	BankTransferAmount *float64 `json:"bank_transfer_amount"`
	ChequeAmount       *float64 `json:"cheque_amount"`
	BankID             *uint    `json:"bank_id"`
	Reason             string   `json:"reason"`
}

// investmentEditBlocker is why an investment cannot be edited ("" if it can).
func investmentEditBlocker(inv *models.Investment, transactions, paidPayouts int64) string {
	switch {
	case inv.Status != models.StatusActive:
		return "an investment in status " + inv.Status + " cannot be edited"
	case inv.RenewedToInvestmentID != nil:
		return "it was renewed into another investment"
	case inv.RenewedFromInvestmentID != nil:
		return "it was created by renewing another investment"
	case transactions > 0 || paidPayouts > 0 || inv.TotalInterestPaid > 0 || inv.InterestWithdrawn > 0:
		return "interest, a payout, a top-up or a withdrawal has already been recorded — correct it from the ledger instead"
	}
	return ""
}

func editInvestment(ctx context.Context, id uint, branchID *uint, req editInvestmentRequest, startDate *time.Time) (*models.Investment, *models.Investment, error) {
	var before, after *models.Investment
	err := investmentDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := lockByID(ctx, tx, id, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("investment not found")
			}
			return err
		}
		var transactions, paidPayouts int64
		if err := tx.WithContext(ctx).Model(&models.InvestmentTransaction{}).Where("investment_id = ?", id).Count(&transactions).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Model(&models.InvestmentPayout{}).Where("investment_id = ? AND status = ?", id, "Paid").Count(&paidPayouts).Error; err != nil {
			return err
		}
		if reason := investmentEditBlocker(inv, transactions, paidPayouts); reason != "" {
			return common.NewConflict("This investment cannot be edited — " + reason + ".")
		}
		snapshot := *inv
		before = &snapshot
		principal := inv.PrincipalAmount
		if req.PrincipalAmount != nil {
			principal = common.RoundMoney(*req.PrincipalAmount)
		}
		if principal <= 0 {
			return common.NewBadRequest("principal amount must be greater than zero")
		}
		plan, err := findPlanByID(ctx, inv.PlanID)
		if err != nil {
			return err
		}
		if req.PlanID != nil && *req.PlanID != inv.PlanID {
			plan, err = findPlanByID(ctx, *req.PlanID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return common.NewNotFound("investment plan not found")
				}
				return err
			}
			if !plan.IsActive {
				return common.NewBadRequest("investment plan is not active")
			}
			// The terms are snapshotted from the new plan, as when an investment is opened.
			inv.PlanID = plan.ID
			inv.InterestRateType, inv.InterestRatePercent = plan.InterestRateType, plan.InterestRatePercent
			inv.PayoutFrequency, inv.TenureMonths, inv.Engine = plan.PayoutFrequency, plan.TenureMonths, engineOrDefault(plan.Engine)
		}
		if principal < plan.MinPrincipal {
			return common.NewBadRequest("principal amount is below the plan's minimum")
		}
		oldStart := inv.StartDate
		start := oldStart
		if startDate != nil {
			if startDate.Format("2006-01-02") > time.Now().Format("2006-01-02") {
				return common.NewBadRequest("start date cannot be in the future")
			}
			start = *startDate
		}
		amountChanged := common.RoundMoney(principal) != common.RoundMoney(inv.PrincipalAmount)
		splitGiven := req.CashAmount != nil || req.UpiAmount != nil || req.BankTransferAmount != nil || req.ChequeAmount != nil || req.BankID != nil
		inv.PrincipalAmount, inv.StartDate = principal, start
		inv.MaturityDate = start.AddDate(0, inv.TenureMonths, 0)
		inv.OutstandingPrincipal, inv.AccruedInterest, inv.LastAccrualDate = 0, 0, time.Time{}
		if inv.Engine == models.EngineLive {
			inv.OutstandingPrincipal, inv.LastAccrualDate = principal, start
		}
		// Payouts were generated from the old terms: replace them all (none is paid).
		if err := tx.WithContext(ctx).Where("investment_id = ?", id).Delete(&models.InvestmentPayout{}).Error; err != nil {
			return err
		}
		if inv.Engine != models.EngineLive {
			payouts := generatePayoutSchedule(inv)
			for i := range payouts {
				payouts[i].TenantID = inv.TenantID
			}
			if err := createPayouts(ctx, tx, payouts); err != nil {
				return err
			}
		}
		deposit := tx.WithContext(ctx).Where("source_type = ? AND source_id = ?", "investment_deposit", inv.ID)
		switch {
		case amountChanged || splitGiven:
			var cash, upi, bank, cheque float64
			if req.CashAmount != nil {
				cash = *req.CashAmount
			}
			if req.UpiAmount != nil {
				upi = *req.UpiAmount
			}
			if req.BankTransferAmount != nil {
				bank = *req.BankTransferAmount
			}
			if req.ChequeAmount != nil {
				cheque = *req.ChequeAmount
			}
			cash, upi, bank, cheque, err = common.NormalizeSplit(cash, upi, bank, cheque, principal, req.BankID)
			if err != nil {
				return err
			}
			var bankID *uint
			if upi+bank+cheque > 0 {
				bankID = req.BankID
			}
			if err := deposit.Delete(&cashModels.CashMovement{}).Error; err != nil {
				return err
			}
			if err := tx.WithContext(ctx).Where("COALESCE(source_type, '') = '' AND is_manual = ? AND purpose IN ?", false, []string{"Investment deposit — " + inv.InvestmentNumber}).Delete(&cashModels.CashMovement{}).Error; err != nil {
				return err
			}
			if _, err := cashbook.RecordInvestmentDepositCashIn(cashbook.WithTx(ctx, tx), inv.ID, inv.InvestmentNumber, principal, cash, upi, bank, cheque, bankID, inv.BranchID, start, inv.CustomerID); err != nil {
				return fmt.Errorf("could not record the corrected deposit in Cash-in-Hand: %w", err)
			}
		case !sameDay(start, oldStart):
			// Only the date moved: the deposit keeps its breakdown and is dated to match.
			if err := deposit.Model(&cashModels.CashMovement{}).Update("occurred_on", start).Error; err != nil {
				return err
			}
		}
		if err := persistInvestment(ctx, tx, inv); err != nil {
			return err
		}
		after = inv
		return nil
	})
	return before, after, err
}

// EditInvestment is PATCH /investments/:id — corrects an investment before anything is paid on it.
func EditInvestment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req editInvestmentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	var startDate *time.Time
	if req.StartDate != nil && strings.TrimSpace(*req.StartDate) != "" {
		d, err := time.ParseInLocation("2006-01-02", *req.StartDate, time.Local)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid start_date: expected YYYY-MM-DD"})
		}
		startDate = &d
	}
	before, after, err := editInvestment(ctx, id, auth.GetBranchScope(c), req, startDate)
	if err != nil {
		return common.FailErr(c, err)
	}
	detail := fmt.Sprintf("principal ₹%.2f → ₹%.2f, start %s → %s, plan %d → %d", before.PrincipalAmount, after.PrincipalAmount, before.StartDate.Format("2006-01-02"), after.StartDate.Format("2006-01-02"), before.PlanID, after.PlanID)
	if r := strings.TrimSpace(req.Reason); r != "" {
		detail = "reason: " + r + " | " + detail
	}
	actor, _, _ := auth.ActorFromContext(c)
	writeInvestmentEvent(ctx, actor, "Investment edited", after, detail)
	return common.Success(c, http.StatusOK, after)
}
