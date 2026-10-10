package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/PersonalLoan/models"
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"gorm.io/gorm"
)

func lastDueDate(installments []models.PersonalLoanInstallment) time.Time {
	var last time.Time
	for _, inst := range installments {
		if inst.DueDate.After(last) {
			last = inst.DueDate
		}
	}
	return last
}

func isPastGracePeriod(loan *models.PersonalLoan, installments []models.PersonalLoanInstallment, asOf time.Time) bool {
	if len(installments) == 0 {
		return false
	}
	graceEnd := lastDueDate(installments).AddDate(0, 0, loan.GracePeriodDays)
	return asOf.After(graceEnd)
}

func evaluateAndApplyPenal(loan *models.PersonalLoan, installments []models.PersonalLoanInstallment, asOf time.Time) (fires bool, penalAmount float64, newInstallments []models.PersonalLoanInstallment) {
	switch loan.Status {
	case models.StatusActive, models.StatusPending:
	default:
		return false, 0, nil
	}
	if (loan.PenalInterestRate <= 0 && loan.PenalFlatAmount <= 0) || loan.OutstandingAmount <= epsilon {
		return false, 0, nil
	}
	if !isPastGracePeriod(loan, installments, asOf) {
		return false, 0, nil
	}
	lastDue := lastDueDate(installments)
	if loan.LastPenalAppliedAt != nil && !loan.LastPenalAppliedAt.Before(lastDue) {
		return false, 0, nil
	}
	if loan.PenalInterestRate > 0 {
		penalAmount = common.RoundMoney(loan.OutstandingAmount * loan.PenalInterestRate / 100)
	} else {
		penalAmount = common.RoundMoney(loan.PenalFlatAmount)
	}
	if penalAmount <= 0 {
		return false, 0, nil
	}
	newOutstanding := common.RoundMoney(loan.OutstandingAmount + penalAmount)
	scheduleLoan := *loan
	scheduleLoan.PrincipalAmount = newOutstanding
	scheduleLoan.InstallmentAmount = common.RoundMoney(newOutstanding / float64(loan.TenureCount))
	newInstallments = generateScheduleFrom(&scheduleLoan, asOf)
	for i := range newInstallments {
		newInstallments[i].PersonalLoanID = loan.ID
	}
	return true, penalAmount, newInstallments
}

func SweepPenalInterest(ctx context.Context) error {
	loans, err := findActiveForPenalSweep(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	for _, l := range loans {
		if err := applyPenalIfDue(ctx, l.ID, now); err != nil {
			log.Printf("penal interest sweep failed for personal loan %d: %v", l.ID, err)
		}
	}
	return nil
}

func applyPenalIfDue(ctx context.Context, loanID uint, asOf time.Time) error {
	return personalLoanDB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loan, err := lockByID(ctx, tx, loanID, nil)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var installments []models.PersonalLoanInstallment
		if err := tx.Where("personal_loan_id = ?", loanID).Find(&installments).Error; err != nil {
			return err
		}
		fires, penalAmount, newInstallments := evaluateAndApplyPenal(loan, installments, asOf)
		if !fires {
			return nil
		}
		loan.OutstandingAmount = common.RoundMoney(loan.OutstandingAmount + penalAmount)
		loan.TotalPenalInterestCharged = common.RoundMoney(loan.TotalPenalInterestCharged + penalAmount)
		loan.PenalCycleCount++
		loan.LastPenalAppliedAt = &asOf
		loan.Status = models.StatusPending
		if err := persistPersonalLoan(ctx, tx, loan); err != nil {
			return err
		}
		for i := range newInstallments {
			newInstallments[i].TenantID = loan.TenantID
		}
		if err := replaceInstallments(ctx, tx, loan.ID, newInstallments); err != nil {
			return err
		}
		return logHistory(ctx, tx, loan.ID, loan.TenantID, models.EventPenalApplied,
			fmt.Sprintf("Installment period ended unpaid — ₹%.2f penal interest added (cycle %d)", penalAmount, loan.PenalCycleCount), penalAmount, nil, asOf)
	})
}
