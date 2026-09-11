package customer

import (
	"context"
	"fmt"
	"strings"

	"cloudhouse/backend/internal/platform/httpx"

	"gorm.io/gorm"
)

// LoanSummary is the minimal view of a customer's loan LoanHardDeleter needs
// — just enough to check every loan is Closed/Auctioned before a customer
// hard-delete proceeds, and to hard-delete each one afterward.
type LoanSummary struct {
	ID     uint
	Number string
	Status string
}

// LoanHardDeleter is satisfied structurally by *loan.Service
// (LoansForCustomer + the pre-existing HardDeleteLoan) — defined here rather
// than imported from internal/loan to avoid an import cycle (loan already
// imports customer for CustomerID-related lookups). Wired in from main.go
// via SetLoanHardDeleter once both services exist.
type LoanHardDeleter interface {
	LoansForCustomer(ctx context.Context, customerID uint) ([]LoanSummary, error)
	HardDeleteLoan(ctx context.Context, loanID uint) error
}

// SetLoanHardDeleter wires the loan package's hard-delete capability into
// this service after both services have been constructed in main.go (loan.
// Service itself depends on customer.Repository, so the reverse can't be
// supplied at construction time without an import cycle).
func (s *Service) SetLoanHardDeleter(d LoanHardDeleter) {
	s.loanHardDeleter = d
}

// ErrLoanHardDeleterNotConfigured guards against HardDeleteCustomer being
// called before main.go's wiring step runs SetLoanHardDeleter. There's no
// httpx "internal server error" constructor (see httpx.StatusForErr's own
// doc comment — an unmapped failure defaults to 400, never 500), so this
// uses NewConflict; it should never actually surface outside a wiring bug.
var ErrLoanHardDeleterNotConfigured = httpx.NewConflict("customer hard delete is not wired up")

// ErrCustomerHasActiveLoans is returned (with the offending loan numbers
// named) when a customer still has a loan that hasn't reached Closed/
// Auctioned — staff must close or hard-delete those loans first.
func errCustomerHasActiveLoans(loanNumbers []string) error {
	return httpx.NewConflict(fmt.Sprintf(
		"Cannot delete this customer — the following loan(s) are still active: %s. Close or delete them first.",
		strings.Join(loanNumbers, ", "),
	))
}

// HardDeleteCustomer permanently removes a customer and every record tied
// to them:
//  1. Every one of the customer's loans is hard-deleted via the exact same
//     cascade loan.Service.HardDeleteLoan already uses — refused outright if
//     any loan isn't yet Closed/Auctioned, so an in-progress pledge can't be
//     wiped out by accident.
//  2. The customer's own directly-keyed rows (device tokens/OTP, in-app
//     notifications, any reminder keyed straight to the customer rather
//     than via a loan) are removed.
//  3. The customer row itself is hard-deleted.
//
// No single outer transaction wraps all of this — each per-loan hard-delete
// is already its own atomic transaction (see HardDeleteLoan), and step 2+3
// run in one further transaction; a failure partway through simply leaves
// already-deleted loans deleted, which is safe to retry (this method is
// idempotent per loan).
func (s *Service) HardDeleteCustomer(ctx context.Context, id uint) error {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if s.loanHardDeleter == nil {
		return ErrLoanHardDeleterNotConfigured
	}

	loans, err := s.loanHardDeleter.LoansForCustomer(ctx, id)
	if err != nil {
		return err
	}
	var blocking []string
	for _, l := range loans {
		if l.Status != "Closed" && l.Status != "Auctioned" {
			blocking = append(blocking, l.Number)
		}
	}
	if len(blocking) > 0 {
		return errCustomerHasActiveLoans(blocking)
	}

	for _, l := range loans {
		if err := s.loanHardDeleter.HardDeleteLoan(ctx, l.ID); err != nil {
			return err
		}
	}

	db := s.repo.DB()
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM customer_device_tokens WHERE customer_id = ?", rec.ID).Error; err != nil {
			return err
		}
		if rec.Phone != "" {
			if err := tx.Exec("DELETE FROM customer_otp WHERE phone = ?", rec.Phone).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec("DELETE FROM notifications WHERE customer_id = ?", rec.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM reminders WHERE customer_id = ?", rec.ID).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&Customer{}, rec.ID).Error
	})
}
