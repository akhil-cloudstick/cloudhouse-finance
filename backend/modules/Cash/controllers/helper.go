package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Cash/models"
)

func init() {
	common.BankBalances = BankBalances
}

// hasLoanDetails reports whether a category is a loan with a ledger. Any "Loan…" category is one — its
// number and principal are optional, so a loan with no details still has a ledger and takes repayments.
func hasLoanDetails(s *models.Category) bool {
	return IsLoanSource(s.Name)
}
