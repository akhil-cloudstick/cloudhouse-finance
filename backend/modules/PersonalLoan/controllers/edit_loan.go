package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/PersonalLoan/models"
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// A personal loan's terms can be corrected only while nothing has been built on them: no payment
// entry, no renewal link and no penal interest. Anything later is fixed from the ledger (payment
// and disbursement edits) instead. The customer and branch never change.

type editLoanRequest struct {
	PrincipalAmount    *float64 `json:"principal_amount"`
	InterestType       *string  `json:"interest_type"`
	InterestValue      *float64 `json:"interest_value"`
	Frequency          *string  `json:"frequency"`
	TenureCount        *int     `json:"tenure_count"`
	FullDisbursement   *bool    `json:"full_disbursement"`
	PenalInterestRate  *float64 `json:"penal_interest_rate"`
	GracePeriodDays    *int     `json:"grace_period_days"`
	DisbursedAt        *string  `json:"disbursed_at"`
	CashAmount         *float64 `json:"cash_amount"`
	UpiAmount          *float64 `json:"upi_amount"`
	BankTransferAmount *float64 `json:"bank_transfer_amount"`
	ChequeAmount       *float64 `json:"cheque_amount"`
	BankID             *uint    `json:"bank_id"`
	Reason             string   `json:"reason"`
}

// loanEditBlocker is why a loan's terms cannot be edited ("" if they can).
func loanEditBlocker(l *models.PersonalLoan, payments int64) string {
	switch {
	case l.Status != models.StatusActive && l.Status != models.StatusPendingApproval:
		return "a loan in status " + l.Status + " cannot be edited"
	case l.RenewedToLoanID != nil:
		return "this loan was renewed into another loan"
	case l.RenewedFromLoanID != nil:
		return "this loan was created by renewing another loan"
	case payments > 0:
		return fmt.Sprintf("it already has %d payment entr%s — correct them from the ledger instead", payments, pluralYies(payments))
	case l.PenalCycleCount > 0 || l.TotalPenalInterestCharged > 0:
		return "penal interest has been charged on it"
	}
	return ""
}

// loanPrincipalEntered is the loan amount as it was typed in: the stored principal is the amount
// owed, which includes the interest when the loan was disbursed in full.
func loanPrincipalEntered(l *models.PersonalLoan) float64 {
	if l.FullDisbursement {
		return common.RoundMoney(l.PrincipalAmount - l.InterestAmount)
	}
	return l.PrincipalAmount
}

func editPersonalLoan(ctx context.Context, loanID uint, branchID *uint, req editLoanRequest, disbursedAt *time.Time) (*models.PersonalLoan, *models.PersonalLoan, error) {
	var before, after *models.PersonalLoan
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
		if reason := loanEditBlocker(l, payments); reason != "" {
			return common.NewConflict("This personal loan cannot be edited — " + reason + ".")
		}
		snapshot := *l
		before = &snapshot
		booked := !slices.Contains(models.NotDisbursedStatuses, l.Status)

		principal := loanPrincipalEntered(l)
		interestType, interestValue := l.InterestType, l.InterestValue
		frequency, tenure, full, grace := l.Frequency, l.TenureCount, l.FullDisbursement, l.GracePeriodDays
		if req.PrincipalAmount != nil {
			principal = *req.PrincipalAmount
		}
		if req.InterestType != nil {
			interestType = *req.InterestType
		}
		if req.InterestValue != nil {
			interestValue = *req.InterestValue
		}
		if req.Frequency != nil {
			frequency = *req.Frequency
		}
		if req.TenureCount != nil {
			tenure = *req.TenureCount
		}
		if req.FullDisbursement != nil {
			full = *req.FullDisbursement
		}
		if req.GracePeriodDays != nil {
			grace = *req.GracePeriodDays
		}
		switch {
		case principal <= 0:
			return common.NewBadRequest("principal amount must be greater than zero")
		case tenure <= 0:
			return common.NewBadRequest("tenure count must be greater than zero")
		case !validateFrequency(frequency):
			return common.NewBadRequest("frequency must be Daily, Weekly or Monthly")
		case !validateInterestType(interestType):
			return common.NewBadRequest("interest type must be Flat or Percentage")
		case interestValue < 0:
			return common.NewBadRequest("interest value must not be negative")
		case grace < 0:
			return common.NewBadRequest("grace period days must not be negative")
		case req.PenalInterestRate != nil && *req.PenalInterestRate < 0:
			return common.NewBadRequest("penal interest rate must not be negative")
		}
		principal = common.RoundMoney(principal)
		interestAmount := computeInterest(principal, interestType, interestValue)
		if interestAmount >= principal {
			return common.NewBadRequest("interest amount must be less than the principal amount")
		}
		disbursed := common.RoundMoney(principal - interestAmount)
		obligation := principal
		if full {
			disbursed = principal
			obligation = common.RoundMoney(principal + interestAmount)
		}

		// Penal terms follow the interest terms unless they were set by hand.
		oldRate, oldFlat := defaultPenalTerms(l.InterestType, l.InterestValue, l.InterestAmount)
		followsInterest := l.PenalInterestRate == oldRate && l.PenalFlatAmount == oldFlat
		switch {
		case req.PenalInterestRate != nil && *req.PenalInterestRate > 0:
			l.PenalInterestRate, l.PenalFlatAmount = *req.PenalInterestRate, 0
		case req.PenalInterestRate != nil || followsInterest:
			l.PenalInterestRate, l.PenalFlatAmount = defaultPenalTerms(interestType, interestValue, interestAmount)
		}

		oldAt := l.DisbursedAt
		if oldAt.IsZero() {
			oldAt = l.OpenedDate
		}
		oldCash, oldUpi, oldBank, oldCheque := l.DisbursementCashAmount, l.DisbursementUpiAmount, l.DisbursementBankTransferAmount, l.DisbursementChequeAmount
		if common.RoundMoney(oldCash+oldUpi+oldBank+oldCheque) == 0 {
			oldCash = l.DisbursedAmount
		}
		newAt := oldAt
		if disbursedAt != nil && !sameDay(*disbursedAt, oldAt) {
			if disbursedAt.Format("2006-01-02") > time.Now().Format("2006-01-02") {
				return common.NewBadRequest("disbursement date cannot be in the future")
			}
			newAt = *disbursedAt
		}
		splitGiven := req.CashAmount != nil || req.UpiAmount != nil || req.BankTransferAmount != nil || req.ChequeAmount != nil || req.BankID != nil
		amountChanged := common.RoundMoney(disbursed) != common.RoundMoney(l.DisbursedAmount)
		cashChanged := booked && (amountChanged || splitGiven || !sameDay(newAt, oldAt))

		cash, upi, bank, cheque := oldCash, oldUpi, oldBank, oldCheque
		bankID := l.DisbursementBankID
		if splitGiven || amountChanged {
			// A new amount needs a new breakdown: none given means all cash, as when a loan is opened.
			cash, upi, bank, cheque = 0, 0, 0, 0
			if splitGiven {
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
			}
			if req.BankID != nil {
				bankID = req.BankID
			}
		}
		cash, upi, bank, cheque, err = common.NormalizeSplit(cash, upi, bank, cheque, disbursed, bankID)
		if err != nil {
			return err
		}
		if upi+bank+cheque == 0 {
			bankID = nil
		}
		if cashChanged && cash > oldCash+epsilon {
			if err := ensurePayoutFunds(ctx, l.BranchID, cash-oldCash, bankID, 0); err != nil {
				return err
			}
		}

		l.PrincipalAmount, l.InterestType, l.InterestValue, l.InterestAmount = obligation, interestType, common.RoundDecimal2(interestValue), interestAmount
		l.DisbursedAmount, l.FullDisbursement, l.Frequency, l.TenureCount, l.GracePeriodDays = disbursed, full, frequency, tenure, grace
		l.DisbursementCashAmount, l.DisbursementUpiAmount, l.DisbursementBankTransferAmount, l.DisbursementChequeAmount, l.DisbursementBankID = cash, upi, bank, cheque, bankID
		l.InstallmentAmount = common.RoundMoney(obligation / float64(tenure))
		l.OutstandingAmount = obligation
		if booked {
			l.DisbursedAt, l.OpenedDate = newAt, newAt
		}

		if cashChanged {
			oldGroup, err := findCashGroup(ctx, tx, l.DisbursementCashGroupID, "Loan disbursement — "+l.LoanNumber, "out", "", l.BranchID, before.DisbursedAmount, oldAt)
			if err != nil {
				return err
			}
			if err := deleteCashGroup(ctx, tx, oldGroup); err != nil {
				return err
			}
			_, groupID, err := cashbook.RecordLoanDisbursementCashOut(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, l.DisbursedAmount, cash, upi, bank, cheque, l.BranchID, newAt, l.CustomerID, bankID)
			if err != nil {
				return fmt.Errorf("could not record the corrected disbursement in Cash-in-Hand: %w", err)
			}
			l.DisbursementCashGroupID = groupID
		}
		if booked {
			installments := generateSchedule(l)
			for i := range installments {
				installments[i].TenantID = l.TenantID
			}
			if err := replaceInstallments(ctx, tx, l.ID, installments); err != nil {
				return err
			}
		}
		if err := persistPersonalLoan(ctx, tx, l); err != nil {
			return err
		}
		if err := logHistory(ctx, tx, l.ID, l.TenantID, "loan_edited",
			fmt.Sprintf("Loan terms edited — principal ₹%.2f, %s %.2f, %d %s", obligation, interestType, interestValue, tenure, frequency), obligation, nil, time.Now()); err != nil {
			return err
		}
		after = l
		return nil
	})
	return before, after, err
}

// EditPersonalLoan is PATCH /personal-loans/:id — corrects a loan's terms before anything is paid on it.
func EditPersonalLoan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req editLoanRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	var disbursedAt *time.Time
	if req.DisbursedAt != nil && strings.TrimSpace(*req.DisbursedAt) != "" {
		d, err := parseEditDate(*req.DisbursedAt)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid disbursed_at: expected YYYY-MM-DD"})
		}
		disbursedAt = &d
	}
	before, after, err := editPersonalLoan(ctx, loanID, auth.GetBranchScope(c), req, disbursedAt)
	if err != nil {
		return common.FailErr(c, err)
	}
	actor, _, _ := auth.ActorFromContext(c)
	writePersonalLedgerAudit(ctx, actor, "Personal loan edited", loanID, before.LoanNumber, req.Reason, before, &EditEntryResult{Before: summarizePersonal(before), After: summarizePersonal(after)})
	return common.Success(c, http.StatusOK, after)
}
