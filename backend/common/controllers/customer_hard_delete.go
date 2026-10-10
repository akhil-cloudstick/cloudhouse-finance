package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

type LoanSummary struct {
	ID     uint
	Number string
	Status string
}

type LoanHardDeleter interface {
	LoansForCustomer(ctx context.Context, customerID uint) ([]LoanSummary, error)
	HardDeleteLoan(ctx context.Context, loanID uint) error
}

func errCustomerHasActiveLoans(loanNumbers []string) error {
	return NewConflict(fmt.Sprintf(
		"Cannot delete this customer — the following loan(s) are still active: %s. Close or delete them first.",
		strings.Join(loanNumbers, ", "),
	))
}

func hardDeleteCustomer(ctx context.Context, id uint) error {
	rec, err := FindCustomerByID(ctx, id)
	if err != nil {
		return NewNotFound("customer not found")
	}
	if LoansForCustomer == nil ||
		config.IsDemoRun(ctx) {
		return NewConflict("customer hard delete is not wired up")
	}
	loans, err := LoansForCustomer(ctx, id)
	if err != nil {
		return err
	}
	var blocking []string
	for _, l := range loans {
		if l.Status != "Closed" && l.Status != "Rejected" && l.Status != "Auctioned" {
			blocking = append(blocking, l.Number)
		}
	}
	if len(blocking) > 0 {
		return errCustomerHasActiveLoans(blocking)
	}
	for _, l := range loans {
		if err := HardDeleteLoan(ctx, l.ID); err != nil {
			return err
		}
	}
	db := customerDB()
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM customer_device_tokens WHERE customer_id = ?", rec.ID).Error; err != nil {
			return err
		}
		if rec.Phone != "" {
			if err := tx.Exec("DELETE FROM customer_otp WHERE phone = ? AND tenant_id = ?", rec.Phone, rec.TenantID).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec("DELETE FROM notifications WHERE customer_id = ?", rec.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM reminders WHERE customer_id = ?", rec.ID).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&commonModels.Customer{}, rec.ID).Error
	})
}
