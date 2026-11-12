package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Investment/models"
	"context"
)

func init() {
	common.InvestmentsForInvestor = investmentsForInvestor
}

// investmentsForInvestor names every investment an investor holds, so deleting the investor can say
// what is in the way. An investment cannot be removed from here, so every one counts.
func investmentsForInvestor(ctx context.Context, investorID uint) ([]common.InvestorLine, error) {
	var invs []models.Investment
	if err := config.DB.WithContext(ctx).Select("id", "investment_number", "status").
		Where("customer_id = ?", investorID).Order("id").Find(&invs).Error; err != nil {
		return nil, err
	}
	out := make([]common.InvestorLine, 0, len(invs))
	for _, i := range invs {
		out = append(out, common.InvestorLine{ID: i.ID, Number: i.InvestmentNumber, Status: i.Status})
	}
	return out, nil
}
