package reminder

import (
	"errors"
	"fmt"
	"time"

	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/loan"
)

var (
	ErrNotFound        = errors.New("reminder not found")
	ErrCustomerReq     = errors.New("customer is required")
	ErrCustomerInvalid = errors.New("customer does not exist")
	ErrTypeInvalid     = errors.New("type must be Follow-Up, Promise-to-Pay, or Custom")
	ErrDueDateReq      = errors.New("due date is required")
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
// calendar aggregation that also reads from loan.Repository.
type Service struct {
	repo         *Repository
	customerRepo *customer.Repository
	loanRepo     *loan.Repository
}

func NewService(repo *Repository, customerRepo *customer.Repository, loanRepo *loan.Repository) *Service {
	return &Service{repo: repo, customerRepo: customerRepo, loanRepo: loanRepo}
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

func (s *Service) Create(in CreateInput) (*Reminder, error) {
	if err := validate(in.CustomerID, in.Type, in.DueDate); err != nil {
		return nil, err
	}
	if _, err := s.customerRepo.FindByID(in.CustomerID); err != nil {
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
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

func (s *Service) Get(id uint, branchID *uint) (*Reminder, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	if branchID != nil && rec.Customer.BranchID != *branchID {
		return nil, ErrNotFound
	}
	return rec, nil
}

func (s *Service) List(f Filter) ([]Reminder, error) {
	return s.repo.FindAll(f)
}

func (s *Service) Update(id uint, in UpdateInput) (*Reminder, error) {
	rec, err := s.repo.FindByID(id)
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
	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

// Complete marks a reminder Done — the one-click action offered on the
// calendar/dashboard for a manual reminder that's been actioned.
func (s *Service) Complete(id uint) (*Reminder, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrNotFound
	}
	rec.Status = StatusDone
	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

func (s *Service) Delete(id uint) error {
	if _, err := s.repo.FindByID(id); err != nil {
		return ErrNotFound
	}
	return s.repo.Delete(id)
}

// GetCalendarEvents builds the unified calendar for [from, to] (inclusive,
// both truncated to whole days): every open loan's Due Date (LoanDue, or
// Overdue if already past due), a monthly "interest payment" reminder on
// each open loan's opened-date day-of-month (InterestDue — a practical
// convention since interest here accrues continuously rather than on a
// real billing schedule, see loan/accrual.go), and every manual Reminder
// whose DueDate falls in range (FollowUp/PromiseToPay/Custom).
func (s *Service) GetCalendarEvents(from, to time.Time, branchID *uint) ([]CalendarEvent, error) {
	from = truncateDay(from)
	to = truncateDay(to)

	var events []CalendarEvent

	loans, err := s.loanRepo.FindOpenForCalendar()
	if err != nil {
		return nil, err
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

	from2, to2 := from, to
	reminders, err := s.repo.FindAll(Filter{From: &from2, To: &to2, BranchID: branchID})
	if err != nil {
		return nil, err
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

	return events, nil
}

func truncateDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
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
