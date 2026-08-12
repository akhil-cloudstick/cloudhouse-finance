package loan

import (
	"math"
	"time"

	"ambikagold/backend/internal/scheme"
)

// hoursPerDay/daysPerMonth/daysPerQuarter are approximations used throughout
// this file's accrual math — gold-loan schemes here are quoted as flat
// monthly/quarterly rates, not exact-daycount instruments, so a 30-day month
// / 91-day quarter is precise enough and keeps the formulas simple.
const (
	daysPerMonth   = 30.0
	daysPerQuarter = 91.0
)

// projectAccrual computes the interest and penal-interest that would accrue
// on l between l.LastAccrualDate and asOf, WITHOUT mutating l — used both by
// accrueAndSave (which persists the result) and by List (which only wants a
// live-projected number for display, not a DB write on every listing).
//
// Interest accrues on the current outstanding principal (reducing balance)
// for every method except "Flat monthly", which — per the conventional
// meaning of a flat-rate loan — charges on the original principal for the
// full term regardless of repayments. Penal interest accrues, in addition
// to regular interest, only for the days the loan has been overdue (past
// DueDate), applying Scheme.PenalRate the same way regular interest applies
// Scheme.InterestRate (both read as annual percentages — see
// frontend/components/NewLoan.tsx's "N% p.a." label).
func projectAccrual(l *Loan, sch *scheme.Scheme, asOf time.Time) (interestDelta, penalDelta float64) {
	// A loan that's Pending Approval (not yet disbursed), Closed, Rejected,
	// or Auctioned shouldn't keep accruing.
	switch l.Status {
	case StatusActive, StatusDueSoon, StatusOverdue:
	default:
		return 0, 0
	}

	from := l.LastAccrualDate
	if from.IsZero() {
		from = l.OpenedDate
	}
	if !asOf.After(from) || l.OutstandingAmount <= 0 {
		return 0, 0
	}

	days := asOf.Sub(from).Hours() / 24
	annualRate := sch.InterestRate / 100

	switch sch.InterestMethod {
	case "Flat monthly":
		interestDelta = l.PrincipalAmount * (annualRate / 12) * (days / daysPerMonth)
	case "Quarterly simple":
		interestDelta = l.OutstandingAmount * (annualRate / 4) * (days / daysPerQuarter)
	case "Compound monthly":
		months := days / daysPerMonth
		monthlyRate := annualRate / 12
		interestDelta = l.OutstandingAmount * (math.Pow(1+monthlyRate, months) - 1)
	case "Monthly simple interest":
		fallthrough
	default:
		interestDelta = l.OutstandingAmount * (annualRate / 12) * (days / daysPerMonth)
	}
	if interestDelta < 0 {
		interestDelta = 0
	}

	if sch.PenalRate > 0 && asOf.After(l.DueDate) {
		overdueFrom := from
		if l.DueDate.After(overdueFrom) {
			overdueFrom = l.DueDate
		}
		if asOf.After(overdueFrom) {
			overdueDays := asOf.Sub(overdueFrom).Hours() / 24
			penalDelta = l.OutstandingAmount * (sch.PenalRate / 100 / 12) * (overdueDays / daysPerMonth)
			if penalDelta < 0 {
				penalDelta = 0
			}
		}
	}
	return interestDelta, penalDelta
}

// accrueAndSave advances l's AccruedInterest/AccruedPenalInterest up to now
// and persists the change, returning whether anything actually changed
// (callers use this to decide whether to re-fetch the saved row).
func (s *Service) accrueAndSave(l *Loan) bool {
	now := time.Now()
	interestDelta, penalDelta := projectAccrual(l, &l.Scheme, now)
	if interestDelta <= 0 && penalDelta <= 0 {
		return false
	}
	l.AccruedInterest += interestDelta
	l.AccruedPenalInterest += penalDelta
	l.LastAccrualDate = now
	if err := s.repo.Update(l); err != nil {
		return false
	}
	return true
}

// enrich fills in a Loan's computed, request-scoped fields (gorm:"-" on the
// struct) from its persisted accrued/paid totals and its loaded Payments.
// Every read path that returns a Loan (Create/Get/List/Approve/
// RecordPayment/...) calls this so API responses always carry a consistent
// "what's owed today" view without duplicating this math per-handler.
func (s *Service) enrich(l *Loan) {
	l.OutstandingInterest = l.AccruedInterest - l.InterestPaid
	if l.OutstandingInterest < 0 {
		l.OutstandingInterest = 0
	}
	l.OutstandingPenalInterest = l.AccruedPenalInterest - l.PenalInterestPaid
	if l.OutstandingPenalInterest < 0 {
		l.OutstandingPenalInterest = 0
	}
	l.TotalOutstandingBalance = l.OutstandingAmount + l.OutstandingInterest + l.OutstandingPenalInterest + l.OutstandingProcessingFee
	l.SettlementAmount = l.TotalOutstandingBalance

	var totalPaid float64
	for _, p := range l.Payments {
		if isCashPaymentType(p.Type) {
			totalPaid += p.Amount
		}
	}
	l.TotalPaid = totalPaid

	enrichStatusFlags(l, time.Now())
	l.ApprovalWarning = sanctionWarning(l)
}

// dueSoonWindowDays/defaultedAfterDays are the day-thresholds behind the
// IsDueSoon/IsDefaulted display flags below.
const (
	dueSoonWindowDays  = 7
	defaultedAfterDays = 90
)

// enrichStatusFlags computes IsDueSoon/IsOverdue/IsDefaulted/DaysOverdue
// purely from l.DueDate vs asOf — a read-time-only display/filter
// classification (same "compute on every read" pattern as the rest of
// enrich()), not a persisted status transition. Only loans still open
// (not Closed/Rejected/Auctioned) are eligible for these flags; a closed
// loan is neither due soon nor overdue regardless of its due date.
func enrichStatusFlags(l *Loan, asOf time.Time) {
	switch l.Status {
	case StatusClosed, StatusAuctioned:
		return
	}
	if asOf.After(l.DueDate) {
		overdueDays := int(asOf.Sub(l.DueDate).Hours() / 24)
		l.IsOverdue = true
		l.DaysOverdue = overdueDays
		l.IsDefaulted = overdueDays > defaultedAfterDays
		return
	}
	daysUntilDue := int(l.DueDate.Sub(asOf).Hours() / 24)
	l.IsDueSoon = daysUntilDue <= dueSoonWindowDays
}

// isCashPaymentType reports whether a LoanPayment.Type represents cash
// actually received (and so should be reflected in Cash-in-Hand — see
// loan.CashRecorder) as opposed to a non-cash ledger correction.
func isCashPaymentType(t string) bool {
	switch t {
	case PaymentTypeInterest, PaymentTypePrincipal, PaymentTypePartial, PaymentTypeFullSettlement:
		return true
	default:
		return false
	}
}
