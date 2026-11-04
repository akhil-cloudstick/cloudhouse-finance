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
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// Editing the sanction (disbursement) works like editing a payment or a top-up (see rebuild.go): the loan's
// starting figures change, then the loan is recalculated from its first day with every payment and top-up
// applied again. The disbursement cash lines are removed and booked again as corrected. The edit is applied
// at once (it does not go back through approval).

// EditDisbursementInput holds the fields a sanction edit may change; nil means "leave as is".
type EditDisbursementInput struct {
	DisbursedOn        *time.Time
	DueDate            *time.Time
	SanctionedAmount   *float64 // the principal the loan carries at the start (excluding top-ups)
	ServiceCharge      *float64
	CashAmount         *float64
	UpiAmount          *float64
	BankTransferAmount *float64
	BankID             *uint
	// Prepare changes the loan's own terms (a new scheme) inside the same transaction, before the loan is recalculated,
	// so the terms and their effect on every interest figure are saved together or not at all. When it is set the loan
	// is not first checked against its old terms: the figures are meant to change.
	Prepare func(l *models.Loan) error
}

// disbursementFigures are the loan's starting figures worked out from an edit.
type disbursementFigures struct {
	Sanctioned    float64
	ServiceCharge float64
	Disbursed     float64
}

// computeDisbursementFigures works out the sanctioned amount, the service charge and the payout. The customer is
// paid the sanctioned amount less the service charge (the same rule the approval uses). When only the amount
// changes, a percentage charge follows it and a flat charge stays as it is.
func computeDisbursementFigures(l *models.Loan, in *EditDisbursementInput, currentSanctioned float64) (disbursementFigures, error) {
	f := disbursementFigures{Sanctioned: common.RoundMoney(currentSanctioned), ServiceCharge: common.RoundMoney(l.ServiceChargeAmount)}
	if in.SanctionedAmount != nil {
		f.Sanctioned = common.RoundMoney(*in.SanctionedAmount)
		if in.ServiceCharge == nil && l.ServiceChargeType == commonModels.ServiceChargeTypePercent {
			f.ServiceCharge = common.RoundMoney(computeServiceChargeAmount(l.ServiceChargeType, l.ServiceChargeValue, f.Sanctioned))
		}
	}
	if in.ServiceCharge != nil {
		f.ServiceCharge = common.RoundMoney(*in.ServiceCharge)
	}
	if f.Sanctioned <= 0 {
		return f, common.NewBadRequest("sanctioned amount must be greater than zero")
	}
	if f.ServiceCharge < 0 {
		return f, common.NewBadRequest("service charge cannot be negative")
	}
	f.Disbursed = common.RoundMoney(f.Sanctioned - f.ServiceCharge)
	if f.Disbursed <= 0 {
		return f, common.NewBadRequest("the service charge must be less than the sanctioned amount")
	}
	return f, nil
}

// checkEligible refuses a sanctioned amount above what the pledged gold allows.
func checkEligible(l *models.Loan, f disbursementFigures) error {
	capped := f.Sanctioned
	if l.ServiceChargeMode == commonModels.ServiceChargeModeAddedToPrincipal {
		capped = common.RoundMoney(f.Sanctioned - f.ServiceCharge)
	}
	if capped > common.RoundMoney(l.EligibleLoanAmount)+0.01 {
		return common.NewBadRequest(fmt.Sprintf("amount ₹%.2f cannot exceed the eligible loan amount ₹%.2f (based on scheme LTV)", capped, l.EligibleLoanAmount))
	}
	return nil
}

func dayOf(t time.Time) string { return t.In(time.Local).Format("2006-01-02") }

// editLoanDisbursement edits the sanction, then recalculates the loan.
func editLoanDisbursement(ctx context.Context, loanID uint, in *EditDisbursementInput, reason string, dryRun bool, choices packetChoices) (*EditPaymentResult, *models.Loan, error) {
	result := &EditPaymentResult{DryRun: dryRun}
	restoredOrnaments := false
	var before *models.Loan
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID)
		if err != nil {
			return common.NewNotFound("loan not found")
		}
		if l.Status == models.StatusPendingApproval {
			return common.NewConflict("this loan is still pending approval — use Edit Loan instead")
		}
		if l.DisbursementDate == nil {
			return common.NewConflict("this loan has not been disbursed yet")
		}
		all, rows, err := loadReplayRows(ctx, tx, loanID)
		if err != nil {
			return err
		}
		if err := guardReplayable(ctx, tx, l, all); err != nil {
			return err
		}
		interestBefore := accrualSnapshot(ctx, tx, loanID)
		// A loan edited before edits were made in place may have an earlier payout and its reversal: the payout in
		// force is the last one.
		var disbRows []*models.LoanPayment
		reversed := 0
		for i := range all {
			switch all[i].Type {
			case models.PaymentTypeDisbursement:
				disbRows = append(disbRows, &all[i])
			case paymentTypeDisbursementReversal:
				reversed++
			}
		}
		if len(disbRows)-reversed > 1 {
			return common.NewConflict("this loan was disbursed more than once, so its sanction cannot be edited safely")
		}
		if len(disbRows) > 1 {
			disbRows = disbRows[len(disbRows)-1:]
		}
		originalStatus := l.Status
		result.Before = summarize(l)
		snapshot := *l
		before = &snapshot

		var linked int64
		if err := tx.WithContext(ctx).Model(&cashModels.CashMovement{}).
			Where("source_id = ? AND source_type IN ?", l.ID, []string{cashbook.SourceLoanDisbursement, cashbook.SourceLoanServiceCharge}).
			Count(&linked).Error; err != nil {
			return err
		}
		if linked == 0 {
			return common.NewConflict("this loan's disbursement cash entries cannot be identified exactly, so it cannot be edited safely")
		}

		// An edit that only changes how the payout was paid (mode, bank) touches no figure: nothing is recalculated.
		light := in.Prepare == nil &&
			(in.SanctionedAmount == nil || absMoney(common.RoundMoney(*in.SanctionedAmount)-l.SanctionedAmount) < 0.005) &&
			(in.ServiceCharge == nil || absMoney(common.RoundMoney(*in.ServiceCharge)-l.ServiceChargeAmount) < 0.005) &&
			(in.DisbursedOn == nil || dayOf(*in.DisbursedOn) == dayOf(*l.DisbursementDate)) &&
			(in.DueDate == nil || dayOf(*in.DueDate) == dayOf(l.DueDate))
		if in.Prepare != nil {
			if err := in.Prepare(l); err != nil {
				return err
			}
		} else if !light {
			// Recalculated untouched first: an edit must not silently change figures this recalculation cannot explain.
			if err := probeReplay(ctx, tx, l, rows, originalStatus); err != nil {
				return err
			}
		}

		ups, err := activeTopUpsInOrder(ctx, tx, loanID)
		if err != nil {
			return err
		}
		var topUpSum float64
		earliest := time.Time{}
		for _, t := range ups {
			topUpSum = common.RoundMoney(topUpSum + t.Amount)
			if earliest.IsZero() || t.OccurredOn.Before(earliest) {
				earliest = t.OccurredOn
			}
		}
		for _, p := range rows {
			if earliest.IsZero() || p.PaidOn.Before(earliest) {
				earliest = p.PaidOn
			}
		}
		currentSanctioned := common.RoundMoney(l.PrincipalAmount - topUpSum)

		fig, err := computeDisbursementFigures(l, in, currentSanctioned)
		if err != nil {
			return err
		}
		if in.SanctionedAmount != nil && absMoney(fig.Sanctioned-currentSanctioned) > 0.005 {
			if err := checkEligible(l, fig); err != nil {
				return err
			}
		}

		// date and due date
		oldOpened := l.OpenedDate
		newDate := *l.DisbursementDate
		if in.DisbursedOn != nil && dayOf(*in.DisbursedOn) != dayOf(newDate) {
			newDate = *in.DisbursedOn
			if dayOf(newDate) > dayOf(time.Now()) {
				return common.NewBadRequest("disbursement date cannot be in the future")
			}
			if !earliest.IsZero() && dayOf(newDate) > dayOf(earliest) {
				return common.NewBadRequest("disbursement date cannot be after the loan's first payment or top-up on " + dayOf(earliest))
			}
			// whole calendar days between the two dates, whatever the time of day each was saved with
			calDay := func(t time.Time) time.Time {
				y, m, d := t.In(time.Local).Date()
				return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
			}
			days := int(math.Round(calDay(newDate).Sub(calDay(*l.DisbursementDate)).Hours() / 24))
			l.OpenedDate = oldOpened.AddDate(0, 0, days)
			l.DueDate = l.DueDate.AddDate(0, 0, days)
			l.DisbursementDate = &newDate
		}
		if in.DueDate != nil {
			l.DueDate = *in.DueDate
		}
		if !l.DueDate.After(l.OpenedDate) {
			return common.NewBadRequest("due date must be after the disbursement date")
		}

		// payout split: defaults to the saved split, which must still add up to the payout
		var disb *models.LoanPayment
		if len(disbRows) == 1 {
			disb = disbRows[0]
		}
		cash, upi, bank := 0.0, 0.0, 0.0
		var bankID *uint
		if disb != nil {
			cash, upi, bank, bankID = disb.CashAmount, disb.UpiAmount, disb.BankTransferAmount, disb.BankID
		} else {
			cash = fig.Disbursed
		}
		// no breakdown sent for a changed payout: the saved one is scaled to the new amount
		if in.CashAmount == nil && in.UpiAmount == nil && in.BankTransferAmount == nil && disb != nil && absMoney(disb.Amount-fig.Disbursed) > 0.005 {
			c, u, b, ch := scaleSplit(cash, upi, bank, 0, disb.Amount, fig.Disbursed)
			cash, upi, bank = common.RoundMoney(c+ch), u, b
		}
		if in.CashAmount != nil {
			cash = *in.CashAmount
		}
		if in.UpiAmount != nil {
			upi = *in.UpiAmount
		}
		if in.BankTransferAmount != nil {
			bank = *in.BankTransferAmount
		}
		if in.BankID != nil {
			bankID = in.BankID
		}
		if err := common.ValidateSplit(cash, upi, bank, 0, fig.Disbursed); err != nil {
			return err
		}
		if upi+bank > 0 && bankID == nil {
			return common.NewBadRequest("bank is required when the payout breakdown includes UPI or Bank Transfer")
		}
		parts, err := cashbook.SplitParts(cash, upi, bank, 0, bankID)
		if err != nil {
			return err
		}

		l.PrincipalAmount = common.RoundMoney(fig.Sanctioned + topUpSum)
		l.SanctionedAmount = fig.Sanctioned
		l.DisbursedAmount = fig.Disbursed
		if absMoney(fig.ServiceCharge-l.ServiceChargeAmount) > 0.005 {
			l.ServiceChargeAmount = fig.ServiceCharge
			if in.ServiceCharge != nil {
				l.ServiceChargeType = commonModels.ServiceChargeTypeFlat
				l.ServiceChargeValue = fig.ServiceCharge
			}
		}

		// every payment as it was saved (the recalculation changes the rows in place)
		savedRows := make(map[uint]models.LoanPayment, len(rows))
		for _, r := range rows {
			savedRows[r.ID] = r
		}
		edited := rows
		fit := newReplayFit(0, choices.Adjust)
		fit.strict = !dryRun
		if light {
			result.After = result.Before
		} else {
			if err := replayLoanFrom(withReplayFit(ctx, fit), tx, l, edited, originalStatus, 0); err != nil {
				return common.NewBadRequest(err.Error())
			}
			result.After = summarize(l)
			result.Following = fit.listed
			result.InterestChanges = interestChanges(interestBefore, accrualSnapshot(ctx, tx, loanID))
			result.Dependents = editDependents(ctx, loanID, result)
		}
		if dryRun {
			return errDryRun
		}
		plan, edited, err := prepareFollowing(ctx, tx, l, fit, savedRows, edited)
		if err != nil {
			return err
		}

		if !light {
			for i := range edited {
				if err := tx.WithContext(ctx).Save(&edited[i]).Error; err != nil {
					return err
				}
			}
			if err := updateLoanTx(ctx, tx, l); err != nil {
				return err
			}
			if err := plan.finish(ctx, tx, l, edited); err != nil {
				return err
			}
		}
		if err := tx.WithContext(ctx).Where("source_id = ? AND source_type IN ?", l.ID, []string{cashbook.SourceLoanDisbursement, cashbook.SourceLoanServiceCharge}).
			Delete(&cashModels.CashMovement{}).Error; err != nil {
			return err
		}
		groupID, err := cashbook.RecordLoanDisbursementGross(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, parts, nil, l.BranchID, *l.DisbursementDate, l.CustomerID)
		if err != nil {
			return fmt.Errorf("could not record the corrected disbursement in Cash-in-Hand: %w", err)
		}
		if disb != nil {
			disb.Amount = fig.Disbursed
			disb.PaidOn = *l.DisbursementDate
			disb.CashAmount, disb.UpiAmount, disb.BankTransferAmount, disb.ChequeAmount = cash, upi, bank, 0
			disb.BankID = bankID
			disb.Method = common.DeriveMethod(cash, upi, bank, 0)
			disb.RunningBalance = fig.Sanctioned
			disb.CashTransactionGroupID = groupID
			if err := tx.WithContext(ctx).Save(disb).Error; err != nil {
				return err
			}
		}
		// the gold the ticked boxes put back, saved with the edit or not at all
		restoredOrnaments, err = applyEditDependents(ctx, tx, loanID, result.Dependents, choices)
		return err
	})
	if errors.Is(err, errDryRun) {
		return result, before, nil
	}
	if err != nil {
		return nil, nil, err
	}
	refreshAfterRestore(ctx, loanID, restoredOrnaments)
	return result, before, nil
}

func writeDisbursementAudit(ctx context.Context, actorEmployeeID uint, loanID uint, loanNumber, reason string, old *models.Loan, res *EditPaymentResult) {
	actorName := "unknown"
	if actor, err := common.FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	oldJSON, _ := json.Marshal(echo.Map{
		"opened_date": old.OpenedDate, "due_date": old.DueDate, "disbursement_date": old.DisbursementDate,
		"sanctioned_amount": old.SanctionedAmount, "disbursed_amount": old.DisbursedAmount,
		"service_charge_amount": old.ServiceChargeAmount, "principal_amount": old.PrincipalAmount,
	})
	detail := fmt.Sprintf("reason: %s | sanction before: %s | loan before: %+v | loan after: %+v", reason, oldJSON, res.Before, res.After)
	_ = common.InsertAuditLog(ctx, &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID, ActorName: actorName, Action: "Sanction edited",
		EntityType: "loan", EntityID: loanID, EntityName: loanNumber, Detail: detail,
	})
}

type editDisbursementRequest struct {
	DisbursedOn        *string               `json:"disbursed_on"`
	DueDate            *string               `json:"due_date"`
	SanctionedAmount   *float64              `json:"sanctioned_amount"`
	ServiceCharge      *float64              `json:"service_charge"`
	CashAmount         *float64              `json:"cash_amount"`
	UpiAmount          *float64              `json:"upi_amount"`
	BankTransferAmount *float64              `json:"bank_transfer_amount"`
	BankID             *uint                 `json:"bank_id"`
	Reason             string                `json:"reason"`
	AdjustFollowing    []LoanFollowingAdjust `json:"adjust_following"`
	ReversePacket      bool                  `json:"reverse_packet"`
	RestorePartial     bool                  `json:"restore_partial_release"`
}

// EditLoanDisbursement is PATCH /loans/:id/disbursement[?dry_run=true].
func EditLoanDisbursement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	var req editDisbursementRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in := &EditDisbursementInput{
		SanctionedAmount: req.SanctionedAmount, ServiceCharge: req.ServiceCharge, CashAmount: req.CashAmount,
		UpiAmount: req.UpiAmount, BankTransferAmount: req.BankTransferAmount, BankID: req.BankID,
	}
	if req.DisbursedOn != nil {
		d, err := parsePaidOn(*req.DisbursedOn)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid disbursed_on: expected YYYY-MM-DD"})
		}
		in.DisbursedOn = &d
	}
	if req.DueDate != nil {
		d, err := parseDate(*req.DueDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid due_date: expected YYYY-MM-DD"})
		}
		in.DueDate = &d
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	actor, _, _ := auth.ActorFromContext(c)
	res, old, err := editLoanDisbursement(ctx, loanID, in, req.Reason, dryRun, packetChoices{ReversePacket: req.ReversePacket, RestorePartial: req.RestorePartial, ActorEmployee: actor, Adjust: req.AdjustFollowing})
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actorEmployeeID, _, _ := auth.ActorFromContext(c)
		writeDisbursementAudit(ctx, actorEmployeeID, loanID, loanNumberOf(ctx, loanID), req.Reason, old, res)
	}
	return common.Success(c, http.StatusOK, res)
}
