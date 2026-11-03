package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/PersonalLoan/models"
	"context"
	"fmt"
)

func init() {
	common.RegisterCustomerDependents(personalLoansForCustomer)
}

// personalLoansForCustomer names every personal loan a customer has, so deleting the
// customer can say what is in the way. A personal loan cannot be removed from here, so
// every one counts, not just open ones.
func personalLoansForCustomer(ctx context.Context, customerID uint) ([]string, error) {
	var loans []models.PersonalLoan
	if err := config.DB.WithContext(ctx).Select("id", "loan_number", "status").
		Where("customer_id = ?", customerID).Order("id").Find(&loans).Error; err != nil {
		return nil, err
	}
	return dependentLines("Personal loan", loans, func(l models.PersonalLoan) (string, string) { return l.LoanNumber, l.Status }), nil
}

func dependentLines[T any](label string, rows []T, ref func(T) (string, string)) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		number, status := ref(r)
		out = append(out, fmt.Sprintf("%s %s (%s)", label, number, status))
	}
	return out
}
