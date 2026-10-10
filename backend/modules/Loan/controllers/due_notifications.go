package controllers

import (
	"context"
	"log"
	"time"
)

func CheckDueAndOverdueLoans(ctx context.Context) {
	loans, err := FindOpenForCalendar(ctx)
	if err != nil {
		log.Printf("due/overdue notification check: failed to list open loans: %v", err)
		return
	}
	for i := range loans {
		l, err := accrueAndEnrich(ctx, &loans[i])
		if err != nil {
			log.Printf("due/overdue notification check: failed to enrich loan %d: %v", loans[i].ID, err)
			continue
		}
		dirty := false
		if l.IsDueSoon && l.DueSoonNotifiedAt == nil {
			now := time.Now()
			l.DueSoonNotifiedAt = &now
			dirty = true
			notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Due Soon", brandedMessage(ctx,
				"Dear %s, your gold loan %s is due on %s. Please arrange payment to avoid overdue charges. — CloudHouse Finance",
				l.Customer.Name, l.LoanNumber, l.DueDate.Format("02-Jan-2006"),
			), "loan_due_soon", "loan", l.ID)
		}
		if l.IsOverdue && l.OverdueNotifiedAt == nil {
			now := time.Now()
			l.OverdueNotifiedAt = &now
			dirty = true
			notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Overdue", brandedMessage(ctx,
				"Dear %s, your gold loan %s is now overdue (due date %s). Please settle the outstanding amount at the earliest to avoid further action. — CloudHouse Finance",
				l.Customer.Name, l.LoanNumber, l.DueDate.Format("02-Jan-2006"),
			), "loan_overdue", "loan", l.ID)
		}
		if dirty {
			if err := persistLoan(ctx, l); err != nil {
				log.Printf("due/overdue notification check: failed to persist notified-at for loan %d: %v", l.ID, err)
			}
		}
	}
}
