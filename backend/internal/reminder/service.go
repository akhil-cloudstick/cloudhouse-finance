package reminder

import (
	"context"
	"fmt"
	"sort"
	"time"

	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/loan"
	"ambikagold/backend/internal/personalloan"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
	"ambikagold/backend/internal/tenant"
)

var (
	ErrNotFound        = httpx.NewNotFound("reminder not found")
	ErrCustomerReq     = httpx.NewBadRequest("customer is required")
	ErrCustomerInvalid = httpx.NewBadRequest("customer does not exist")
	ErrTypeInvalid     = httpx.NewBadRequest("type must be Follow-Up, Promise-to-Pay, or Custom")
	ErrDueDateReq      = httpx.NewBadRequest("due date is required")
)

var validTypes = map[string]bool{
	TypeFollowUp:     true,
	TypePromiseToPay: true,
	TypeCustom:       true,
}

// CreateInput / UpdateInput mirror the fields the "Add Reminder" modal on
// Calendar.tsx collects.
type CreateInput struct {
	CustomerID uint
	LoanID     *uint
	Type       string
	DueDate    time.Time
	Note       string

	CreatedByEmployeeID uint
}

type UpdateInput struct {
	Type    string
	DueDate time.Time
	Note    string
	Status  string
}

// Service implements reminder business rules on top of Repository, plus the
// calendar aggregation that also reads from loan.Repository and
// personalloan.Service (personal loans have no import back to this
// package, so a direct dependency here — same as loan.Repository — needs
// no interface indirection).
type Service struct {
	repo            *Repository
	customerRepo    *customer.Repository
	loanRepo        *loan.Repository
	personalLoanSvc *personalloan.Service
	auctionRepo  *loan.AuctionRepository
	whatsapp        platform.SMSSender // reused interface — Send(phone, message) matches SMSSender exactly
	commlogRepo     *commlog.Repository
	tenantRepo   *tenant.Repository
}

func NewService(repo *Repository, customerRepo *customer.Repository, loanRepo *loan.Repository, personalLoanSvc *personalloan.Service, auctionRepo *loan.AuctionRepository, whatsapp platform.SMSSender, commlogRepo *commlog.Repository, tenantRepo *tenant.Repository) *Service {
	return &Service{repo: repo, customerRepo: customerRepo, loanRepo: loanRepo, personalLoanSvc: personalLoanSvc, auctionRepo: auctionRepo, whatsapp: whatsapp, commlogRepo: commlogRepo, tenantRepo: tenantRepo}
}

// businessName resolves the tenant's own display name (multi-tenancy plan,
// Step 9) — falls back to a neutral label rather than another business's
// name if the lookup fails for any reason.
func (s *Service) businessName(ctx context.Context) string {
	id, ok := platform.TenantFromContext(ctx)
	if !ok {
		return "your lender"
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil || t.Name == "" {
		return "your lender"
	}
	return t.Name
}

func validate(customerID uint, typ string, dueDate time.Time) error {
	if customerID == 0 {
		return ErrCustomerReq
	}
	if !validTypes[typ] {
		return ErrTypeInvalid
	}
	if dueDate.IsZero() {
		return ErrDueDateReq
	}
	return nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*Reminder, error) {
	if err := validate(in.CustomerID, in.Type, in.DueDate); err != nil {
		return nil, err
	}
	if _, err := s.customerRepo.FindByID(ctx, in.CustomerID); err != nil {
		return nil, ErrCustomerInvalid
	}
	rec := &Reminder{
		CustomerID:          in.CustomerID,
		LoanID:              in.LoanID,
		Type:                in.Type,
		DueDate:             in.DueDate,
		Note:                in.Note,
		Status:              StatusPending,
		CreatedByEmployeeID: in.CreatedByEmployeeID,
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

func (s *Service) Get(ctx context.Context, id uint, branchID *uint) (*Reminder, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.Customer.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) List(ctx context.Context, f Filter) ([]Reminder, error) {
	return s.repo.FindAll(ctx, f)
}

func (s *Service) Update(ctx context.Context, id uint, in UpdateInput) (*Reminder, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := validate(rec.CustomerID, in.Type, in.DueDate); err != nil {
		return nil, err
	}
	rec.Type = in.Type
	rec.DueDate = in.DueDate
	rec.Note = in.Note
	if in.Status != "" {
		rec.Status = in.Status
	}
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

// Complete marks a reminder Done — the one-click action offered on the
// calendar/dashboard for a manual reminder that's been actioned.
func (s *Service) Complete(ctx context.Context, id uint) (*Reminder, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	rec.Status = StatusDone
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

// SendWhatsApp texts the reminder's note (or a default follow-up line) to
// its customer's phone via the configured WhatsApp sender (see
// platform.OpenWASender), then marks the reminder Done — sending IS the
// action for a manual reminder, the same way Complete is a one-click
// "actioned" marker.
func (s *Service) SendWhatsApp(ctx context.Context, id uint) (*Reminder, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	message := rec.Note
	if message == "" {
		message = fmt.Sprintf("This is a reminder from %s regarding your %s.", s.businessName(ctx), rec.Type)
	}
	sendErr := s.whatsapp.Send(rec.Customer.Phone, message)
	if s.commlogRepo != nil {
		logRec := &commlog.CommunicationLog{
			RecipientName:     rec.Customer.Name,
			RecipientPhone:    rec.Customer.Phone,
			ChatID:            commlog.NormalizeChatID(rec.Customer.Phone),
			Channel:           commlog.ChannelWhatsApp,
			TriggerType:       commlog.TriggerReminder,
			MessageBody:       message,
			RelatedEntityType: "reminder",
			RelatedEntityID:   rec.ID,
			Status:            commlog.StatusSent,
		}
		if sendErr != nil {
			logRec.Status = commlog.StatusFailed
			logRec.ErrorMessage = sendErr.Error()
		}
		_ = s.commlogRepo.Create(ctx, logRec)
	}
	if sendErr != nil {
		return nil, fmt.Errorf("sending whatsapp reminder: %w", sendErr)
	}
	rec.Status = StatusDone
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

func (s *Service) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.FindByID(ctx, id); err != nil {
		return ErrNotFound
	}
	return s.repo.Delete(ctx, id)
}

// GetCalendarEvents builds the unified calendar for [from, to] (inclusive,
// both truncated to whole days): every open loan's Due Date (LoanDue, or
// Overdue if already past due), a monthly "interest payment" reminder on
// each open loan's opened-date day-of-month (InterestDue — a practical
// convention since interest here accrues continuously rather than on a
// real billing schedule, see loan/accrual.go), every loan currently
// scheduled for auction (AuctionScheduled, on its AuctionDate), and every
// manual Reminder whose DueDate falls in range (FollowUp/PromiseToPay/
// Custom).
//
// The merged list is always sorted Overdue-first-then-ascending-by-date
// (moved here from the frontend's client-side sort — see
// frontend/components/Dashboard.tsx) before pagination is applied. page/
// pageSize are both optional: either <= 0 skips pagination entirely and
// every event is returned (GET /reminders/calendar's original, still-used
// shape), matching the "additive query params" backward-compatibility rule
// — existing callers that never send page/pageSize keep getting the exact
// response shape they always have. The returned int is always the *full*
// (pre-slice) event count.
func (s *Service) GetCalendarEvents(ctx context.Context, from, to time.Time, branchID *uint, page, pageSize int) ([]CalendarEvent, int, error) {
	from = truncateDay(from)
	to = truncateDay(to)

	var events []CalendarEvent

	loans, err := s.loanRepo.FindOpenForCalendar(ctx)
	if err != nil {
		return nil, 0, err
	}
	now := truncateDay(time.Now())
	for _, l := range loans {
		if branchID != nil && l.BranchID != *branchID {
			continue
		}
		due := truncateDay(l.DueDate)
		custID := l.CustomerID
		custName := l.Customer.Name

		// Loan Due Date / Overdue — one event, categorized by whether the
		// due date has already passed as of today (not as of `to`, so an
		// already-overdue loan still reads as Overdue even when browsing a
		// past month).
		if !due.Before(from) && !due.After(to) {
			evType, title := "LoanDue", "Loan due"
			if due.Before(now) {
				evType, title = "Overdue", "Loan overdue"
			}
			events = append(events, CalendarEvent{
				Date:         due.Format("2006-01-02"),
				Type:         evType,
				Title:        fmt.Sprintf("%s — %s", title, l.LoanNumber),
				Detail:       custName,
				LoanID:       &l.ID,
				LoanNumber:   l.LoanNumber,
				CustomerID:   &custID,
				CustomerName: custName,
			})
		}
		// Also surface a currently-overdue loan even if its DueDate itself
		// falls outside [from, to] — e.g. browsing a future month while an
		// old loan is still unpaid — anchored to `now` so it lands on
		// today's cell, not silently dropped from the calendar.
		if due.Before(now) && (due.Before(from) || due.After(to)) && !now.Before(from) && !now.After(to) {
			events = append(events, CalendarEvent{
				Date:         now.Format("2006-01-02"),
				Type:         "Overdue",
				Title:        fmt.Sprintf("Loan overdue — %s", l.LoanNumber),
				Detail:       custName,
				LoanID:       &l.ID,
				LoanNumber:   l.LoanNumber,
				CustomerID:   &custID,
				CustomerName: custName,
			})
		}

		// Monthly interest-payment reminder on the opened-date anniversary
		// day, for every month the loan has been (or still is) open,
		// intersected with [from, to].
		for _, occ := range monthlyOccurrences(l.OpenedDate, from, to) {
			events = append(events, CalendarEvent{
				Date:         occ.Format("2006-01-02"),
				Type:         "InterestDue",
				Title:        fmt.Sprintf("Interest payment reminder — %s", l.LoanNumber),
				Detail:       custName,
				LoanID:       &l.ID,
				LoanNumber:   l.LoanNumber,
				CustomerID:   &custID,
				CustomerName: custName,
			})
		}
	}

	// Personal-loan installment due dates — one event per unpaid
	// installment, same Due/Overdue-anchored-to-today treatment as gold
	// loans above. personalLoanSvc is nil-checked so this package still
	// works in any test/wiring that doesn't construct one.
	if s.personalLoanSvc != nil {
		installments, err := s.personalLoanSvc.ListPendingInstallmentsForCalendar(ctx, branchID)
		if err != nil {
			return nil, 0, err
		}
		for _, inst := range installments {
			due := truncateDay(inst.DueDate)
			loanID := inst.LoanID

			if !due.Before(from) && !due.After(to) {
				evType, title := "PersonalLoanDue", "Installment due"
				if due.Before(now) {
					evType, title = "PersonalLoanOverdue", "Installment overdue"
				}
				events = append(events, CalendarEvent{
					Date:           due.Format("2006-01-02"),
					Type:           evType,
					Title:          fmt.Sprintf("%s — %s", title, inst.LoanNumber),
					Detail:         inst.CustomerName,
					PersonalLoanID: &loanID,
					LoanNumber:     inst.LoanNumber,
					CustomerID:     &inst.CustomerID,
					CustomerName:   inst.CustomerName,
				})
			}
			// Same "still overdue but outside the browsed range" anchor the
			// gold-loan loop above uses, so an old unpaid installment never
			// silently disappears from the calendar while browsing a later
			// month.
			if due.Before(now) && (due.Before(from) || due.After(to)) && !now.Before(from) && !now.After(to) {
				events = append(events, CalendarEvent{
					Date:           now.Format("2006-01-02"),
					Type:           "PersonalLoanOverdue",
					Title:          fmt.Sprintf("Installment overdue — %s", inst.LoanNumber),
					Detail:         inst.CustomerName,
					PersonalLoanID: &loanID,
					LoanNumber:     inst.LoanNumber,
					CustomerID:     &inst.CustomerID,
					CustomerName:   inst.CustomerName,
				})
			}
		}
	}

	scheduledAuctions, err := s.auctionRepo.FindScheduledForCalendar(ctx)
	if err != nil {
		return nil, 0, err
	}
	for _, a := range scheduledAuctions {
		if branchID != nil && a.BranchID != *branchID {
			continue
		}
		date := truncateDay(a.AuctionDate)
		if date.Before(from) || date.After(to) {
			continue
		}
		loanID := a.LoanID
		custID := a.CustomerID
		events = append(events, CalendarEvent{
			Date:         date.Format("2006-01-02"),
			Type:         "AuctionScheduled",
			Title:        fmt.Sprintf("Auction scheduled — %s", a.LoanNumber),
			Detail:       a.CustomerName,
			LoanID:       &loanID,
			LoanNumber:   a.LoanNumber,
			CustomerID:   &custID,
			CustomerName: a.CustomerName,
		})
	}

	from2, to2 := from, to
	reminders, err := s.repo.FindAll(ctx, Filter{From: &from2, To: &to2, BranchID: branchID})
	if err != nil {
		return nil, 0, err
	}
	for _, r := range reminders {
		evType := "Custom"
		switch r.Type {
		case TypeFollowUp:
			evType = "FollowUp"
		case TypePromiseToPay:
			evType = "PromiseToPay"
		}
		rID := r.ID
		custID := r.CustomerID
		events = append(events, CalendarEvent{
			Date:         truncateDay(r.DueDate).Format("2006-01-02"),
			Type:         evType,
			Title:        fmt.Sprintf("%s — %s", r.Type, r.Customer.Name),
			Detail:       r.Note,
			LoanID:       r.LoanID,
			CustomerID:   &custID,
			CustomerName: r.Customer.Name,
			ReminderID:   &rID,
			Status:       r.Status,
		})
	}

	isOverdue := func(e CalendarEvent) bool { return e.Type == "Overdue" || e.Type == "PersonalLoanOverdue" }
	sort.SliceStable(events, func(i, j int) bool {
		a, b := events[i], events[j]
		if isOverdue(a) != isOverdue(b) {
			return isOverdue(a)
		}
		return a.Date < b.Date
	})

	total := len(events)
	if page <= 0 || pageSize <= 0 {
		return events, total, nil
	}
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return events[start:end], total, nil
}

// truncateDay zeroes out the time-of-day, always in UTC — regardless of
// what Location t happens to carry — so it lines up with from/to, which
// GetCalendarEvents' caller parses via time.Parse("2006-01-02", s) (always
// UTC per the time package's own doc). Truncating in t's own Location
// instead (the previous behavior) broke for personal-loan installment due
// dates: they inherit the real time-of-day AND server-local Location (IST)
// from PersonalLoan.OpenedDate = time.Now() at loan creation, so e.g.
// "2026-10-01 21:03 IST" truncated in IST became "2026-10-01 00:00 IST" —
// an instant equal to "2026-09-30 18:30 UTC", which compared as *before* a
// UTC `from` of "2026-10-01", silently dropping the event from every month
// it should have appeared in. Gold-loan due dates happened not to hit this
// (their time-of-day is already near-zero), but converting to UTC first
// here is the general fix, not a personal-loan-specific patch.
func truncateDay(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

// monthlyOccurrences returns every date, on openedDate's day-of-month,
// starting from openedDate's own month and repeating monthly, that falls
// within [from, to]. time.Date normalizes overflow days itself (e.g. an
// opened-date of Jan 31 rolls a 30-day February's occurrence to Mar 2/3),
// matching Go's standard date-arithmetic behavior rather than clamping —
// an acceptable approximation for a reminder, not a billing statement.
func monthlyOccurrences(openedDate, from, to time.Time) []time.Time {
	var out []time.Time
	if openedDate.IsZero() || to.Before(openedDate) {
		return out
	}
	day := openedDate.Day()
	// Start at the first monthly anniversary on/after `from` (but never
	// before openedDate itself).
	year, month := from.Year(), from.Month()
	if from.Before(openedDate) {
		year, month = openedDate.Year(), openedDate.Month()
	}
	cursor := time.Date(year, month, day, 0, 0, 0, 0, openedDate.Location())
	if cursor.Before(openedDate) {
		cursor = cursor.AddDate(0, 1, 0)
	}
	for !cursor.After(to) {
		if !cursor.Before(from) {
			out = append(out, cursor)
		}
		cursor = cursor.AddDate(0, 1, 0)
	}
	return out
}
