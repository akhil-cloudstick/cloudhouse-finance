package loan

import (
	"context"
	"log"
	"time"

	"cloudhouse/backend/internal/commlog"
)

// CheckDueAndOverdueLoans is the one genuinely new *trigger* in the
// notification system (everything else just extends the existing
// notifyCustomer call sites) — IsDueSoon/IsOverdue (accrual.go's
// enrichStatusFlags) are pure read-time date math with no persisted state
// and no existing event to hook, so this needs its own periodic check plus
// dedup state, or the same loan would renotify every tick forever.
//
// Intended to be run on its own ticker from main.go (e.g. hourly — cheap:
// FindOpenForCalendar already returns exactly the not-yet-closed loan set
// this needs). Reuses the exact dueSoonWindowDays threshold enrichStatusFlags
// already defines — not reinvented here.
func (s *Service) CheckDueAndOverdueLoans(ctx context.Context) {
	loans, err := s.repo.FindOpenForCalendar(ctx)
	if err != nil {
		log.Printf("due/overdue notification check: failed to list open loans: %v", err)
		return
	}

	for i := range loans {
		l, err := s.accrueAndEnrich(ctx, &loans[i])
		if err != nil {
			log.Printf("due/overdue notification check: failed to enrich loan %d: %v", loans[i].ID, err)
			continue
		}

		dirty := false
		if l.IsDueSoon && l.DueSoonNotifiedAt == nil {
			now := time.Now()
			l.DueSoonNotifiedAt = &now
			dirty = true
			s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Due Soon", s.brandedMessage(ctx,
				"Dear %s, your gold loan %s is due on %s. Please arrange payment to avoid overdue charges. — CloudHouse Gold Finance",
				l.Customer.Name, l.LoanNumber, l.DueDate.Format("02-Jan-2006"),
			), commlog.TriggerLoanDueSoon, "loan", l.ID)
		}
		if l.IsOverdue && l.OverdueNotifiedAt == nil {
			now := time.Now()
			l.OverdueNotifiedAt = &now
			dirty = true
			s.notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Overdue", s.brandedMessage(ctx,
				"Dear %s, your gold loan %s is now overdue (due date %s). Please settle the outstanding amount at the earliest to avoid further action. — CloudHouse Gold Finance",
				l.Customer.Name, l.LoanNumber, l.DueDate.Format("02-Jan-2006"),
			), commlog.TriggerLoanOverdue, "loan", l.ID)
		}
		if dirty {
			if err := s.repo.Update(ctx, l); err != nil {
				log.Printf("due/overdue notification check: failed to persist notified-at for loan %d: %v", l.ID, err)
			}
		}
	}
}
