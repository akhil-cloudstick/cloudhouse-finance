package controllers

import (
	"context"
	"log"
	"time"
)

// currentInterestCycle returns the start (midnight UTC) of the monthly interest cycle that contains now,
// i.e. the latest monthly anniversary of openedDate that has already been reached. It is zero while the
// loan is still in its first month. A 31st anniversary falls on the last day of shorter months.
func currentInterestCycle(openedDate, now time.Time) time.Time {
	o := openedDate.UTC()
	n := now.UTC()
	today := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
	opened := time.Date(o.Year(), o.Month(), o.Day(), 0, 0, 0, 0, time.UTC)
	anniversary := func(year int, month time.Month) time.Time {
		last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
		day := o.Day()
		if day > last {
			day = last
		}
		return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	}
	cycle := anniversary(today.Year(), today.Month())
	if cycle.After(today) {
		cycle = anniversary(today.Year(), today.Month()-1)
	}
	if !cycle.After(opened) {
		return time.Time{}
	}
	return cycle
}

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
		if cycle := currentInterestCycle(l.OpenedDate, time.Now()); !cycle.IsZero() &&
			l.OutstandingInterest > 0 &&
			(l.InterestRemindedAt == nil || l.InterestRemindedAt.Before(cycle)) {
			now := time.Now()
			l.InterestRemindedAt = &now
			dirty = true
			notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Interest Payment Reminder", brandedMessage(ctx,
				"Dear %s, the interest of ₹%.2f on your gold loan %s is unpaid. Please pay it at the earliest to avoid further charges. — CloudHouse Finance",
				l.Customer.Name, l.OutstandingInterest, l.LoanNumber,
			), "loan_interest_reminder", "loan", l.ID)
		}
		if dirty {
			if err := persistLoan(ctx, l); err != nil {
				log.Printf("due/overdue notification check: failed to persist notified-at for loan %d: %v", l.ID, err)
			}
		}
	}
}
