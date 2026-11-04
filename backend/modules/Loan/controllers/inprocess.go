package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"context"
)

// The top-up and bank-pledge release paths for in-process callers (the demo seed): the same functions the HTTP
// handlers call, with no branch scope.

func TopUp(ctx context.Context, loanID uint, in TopUpInput) (*models.Loan, error) {
	return topUpLoan(ctx, loanID, in)
}

func ApproveTopUpRequest(ctx context.Context, topUpID uint, in TopUpApprovalInput) (*models.LoanTopUp, error) {
	return approveTopUp(ctx, topUpID, nil, in)
}

func ListLoanTopUps(ctx context.Context, loanID uint) ([]models.LoanTopUp, error) {
	return listTopUps(ctx, loanID)
}

func ReleasePledge(ctx context.Context, loanID, pledgeID uint, in BankPledgeReleaseInput, actorID *uint, actorRole string) (*models.Loan, error) {
	return releaseBankPledge(ctx, loanID, pledgeID, nil, in, actorID, actorRole)
}
