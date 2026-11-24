package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	reportControllers "cloudhouse/backend/modules/Reports/controllers"
	reportModels "cloudhouse/backend/modules/Reports/models"
	"context"
	"time"
)

func init() { reportControllers.ListLoanStatusRows = listLoanStatusRows }

// listLoanStatusRows feeds the Loans Status report through the Loans page's own listing (listLoans), so a loan reads
// as Active / Due Soon / Overdue / Defaulted / Closed exactly as it does on the Loans page and in the mobile app.
func listLoanStatusRows(ctx context.Context, branchIDs, customerIDs []uint, from, to *time.Time) ([]reportModels.LoanStatusRow, error) {
	loans, _, err := listLoans(ctx, LoanFilter{BranchIDs: branchIDs, CustomerIDs: customerIDs, OpenedFrom: from, OpenedTo: to})
	if err != nil {
		return nil, err
	}
	rows := make([]reportModels.LoanStatusRow, 0, len(loans))
	for i := range loans {
		l := &loans[i]
		switch st := effectiveStatus(l); st {
		case models.StatusActive, models.StatusDueSoon, models.StatusOverdue, "Defaulted", models.StatusClosed:
			rows = append(rows, reportModels.LoanStatusRow{
				LoanID: l.ID, LoanNumber: l.LoanNumber, CustomerName: l.Customer.Name, BranchName: l.Branch.Name,
				Status: st, Outstanding: l.OutstandingAmount, DueDate: l.DueDate,
			})
		}
	}
	return rows, nil
}
