package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Cash/models"
)

func init() {
	common.BankBalances = BankBalances
}

func hasLoanDetails(s *models.Category) bool {
	return s.PrincipalAmount != nil && s.BankID != nil
}
