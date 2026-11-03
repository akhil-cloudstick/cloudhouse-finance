package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Investment/models"
	"context"
	"fmt"
)

func init() {
	common.RegisterCustomerDependents(investmentsForCustomer)
}

// investmentsForCustomer names every investment a customer holds, so deleting the customer
// can say what is in the way. An investment cannot be removed from here, so every one counts.
func investmentsForCustomer(ctx context.Context, customerID uint) ([]string, error) {
	var invs []models.Investment
	if err := config.DB.WithContext(ctx).Select("id", "investment_number", "status").
		Where("customer_id = ?", customerID).Order("id").Find(&invs).Error; err != nil {
		return nil, err
	}
	out := make([]string, 0, len(invs))
	for _, i := range invs {
		out = append(out, fmt.Sprintf("Investment %s (%s)", i.InvestmentNumber, i.Status))
	}
	return out, nil
}
