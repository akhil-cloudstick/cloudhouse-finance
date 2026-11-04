package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/PersonalLoan/models"
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// loanDeleteBlocker is why a personal loan cannot be deleted ("" if it can). Payments must be
// removed one by one from the ledger first (each reverses its own cash entry), and a loan that
// is part of a renewal chain stays, because the other loan refers to it.
func loanDeleteBlocker(l *models.PersonalLoan, payments int64) string {
	switch {
	case l.RenewedToLoanID != nil:
		return "this loan was renewed into another loan"
	case l.RenewedFromLoanID != nil:
		return "this loan was created by renewing another loan"
	case payments > 0:
		return fmt.Sprintf("it has %d payment entr%s — delete them from the ledger first", payments, pluralYies(payments))
	}
	return ""
}

func pluralYies(n int64) string {
	if n == 1 {
		return "y"
	}
	return "ies"
}

// deletePersonalLoan removes a personal loan together with its installments and history, and
// reverses the cash-book entry of its disbursement, in one transaction.
func deletePersonalLoan(ctx context.Context, loanID uint, branchID *uint) (*models.PersonalLoan, error) {
	var deleted *models.PersonalLoan
	err := personalLoanDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID, branchID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("personal loan not found")
			}
			return err
		}
		var payments int64
		if err := tx.WithContext(ctx).Model(&models.PersonalLoanPayment{}).Where("personal_loan_id = ?", loanID).Count(&payments).Error; err != nil {
			return err
		}
		if reason := loanDeleteBlocker(l, payments); reason != "" {
			return common.NewConflict("This personal loan cannot be deleted — " + reason + ".")
		}
		if !slices.Contains(models.NotDisbursedStatuses, l.Status) {
			at := l.DisbursedAt
			if at.IsZero() {
				at = l.OpenedDate
			}
			group, err := findCashGroup(ctx, tx, l.DisbursementCashGroupID, "Loan disbursement — "+l.LoanNumber, "out", "", l.BranchID, l.DisbursedAmount, at)
			if err != nil {
				return err
			}
			if err := deleteCashGroup(ctx, tx, group); err != nil {
				return err
			}
		}
		if err := tx.WithContext(ctx).Where("personal_loan_id = ?", loanID).Delete(&models.PersonalLoanInstallment{}).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Where("personal_loan_id = ?", loanID).Delete(&models.PersonalLoanHistory{}).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Delete(&models.PersonalLoan{}, loanID).Error; err != nil {
			return err
		}
		deleted = l
		return nil
	})
	return deleted, err
}

// DeletePersonalLoan is DELETE /personal-loans/:id.
func DeletePersonalLoan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	l, err := deletePersonalLoan(ctx, loanID, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	actor, _, _ := auth.ActorFromContext(c)
	writePersonalLedgerAudit(ctx, actor, "Personal loan deleted", loanID, l.LoanNumber, c.QueryParam("reason"), l, &EditEntryResult{})
	return common.Success(c, http.StatusOK, echo.Map{"deleted": true})
}
