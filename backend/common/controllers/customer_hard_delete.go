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

// CustomerDependentLister reports records outside the gold loans (personal loans, investments)
// that still point at a customer, as readable lines such as "Personal loan PL-00001 (Active)".
type CustomerDependentLister func(ctx context.Context, customerID uint) ([]string, error)

var customerDependentListers []CustomerDependentLister

// RegisterCustomerDependents lets a module declare what it keeps against a customer, so a
// delete can name everything in the way instead of failing on a database constraint.
func RegisterCustomerDependents(l CustomerDependentLister) {
	customerDependentListers = append(customerDependentListers, l)
}

func errCustomerHasLinkedRecords(items []string) error {
	return NewConflict(fmt.Sprintf(
		"Cannot delete this customer — it still has: %s. Close or delete these first.",
		strings.Join(items, "; "),
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
			blocking = append(blocking, fmt.Sprintf("Gold loan %s (%s)", l.Number, l.Status))
		}
	}
	for _, list := range customerDependentListers {
		items, err := list(ctx, id)
		if err != nil {
			return err
		}
		blocking = append(blocking, items...)
	}
	if len(blocking) > 0 {
		return errCustomerHasLinkedRecords(blocking)
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
