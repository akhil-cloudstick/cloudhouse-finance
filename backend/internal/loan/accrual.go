package loan

import (
	"context"
	"time"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/scheme"
)

// monthsPerQuarter is the period length for the "Quarterly simple" scheme
// method; every other method steps one calendar month at a time.
const monthsPerQuarter = 3

// daysInMonth returns the number of days in the given calendar month — day 0
// of month+1 is the last day of month, which also handles February/leap years
// and the December→January year rollover.
func daysInMonth(y int, m time.Month) int {
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// addMonths adds n calendar months to t, clamping the day-of-month to the
// target month's length. Go's AddDate normalises overflow instead of clamping
// (31 Jan + 1 month = 3 Mar), which would let a month-end loan silently skip
// a cycle; clamping gives 28/29 Feb as a customer would expect.
func addMonths(t time.Time, n int) time.Time {
	y, m, d := t.Date()
	target := time.Date(y, m, 1, 0, 0, 0, 0, t.Location()).AddDate(0, n, 0)
	ty, tm := target.Year(), target.Month()
	if last := daysInMonth(ty, tm); d > last {
		d = last
	}
	return time.Date(ty, tm, d, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
}

// completedPeriods counts how many WHOLE periods of `months` calendar months
// have elapsed between from and asOf, and returns the exact instant that many
// periods after from. The remainder — the part-month still in progress — is
// deliberately dropped: interest here is charged in whole monthly steps, so a
// cycle that has not completed yet owes nothing. Returning the exact boundary
// (rather than asOf) is what lets the caller advance LastAccrualDate without
// discarding those leftover days; they carry into the next call.
func completedPeriods(from, asOf time.Time, months int) (int, time.Time) {
	n := 0
	for !addMonths(from, months*(n+1)).After(asOf) {
		n++
	}
	return n, addMonths(from, months*n)
}

// projectAccrual computes the interest and penal-interest that would accrue
// on l between l.LastAccrualDate and asOf, WITHOUT mutating l — used both by
// accrueAndSave (which persists the result) and by List (which only wants a
// live-projected number for display, not a DB write on every listing).
//
// Interest is charged in WHOLE MONTHLY STEPS, never pro-rated by day: a loan
// twelve days into its cycle owes nothing for that cycle, and the month's
// interest lands in full the moment the month completes. Months are real
// calendar months measured from the accrual anchor (see addMonths), not
// 30-day blocks, so a loan opened on the 15th accrues on the 15th of every
// month regardless of month length.
//
// The third return value is the new accrual anchor — the exact instant the
// last completed period ended. Callers MUST store this as LastAccrualDate
// rather than "now", or the part-month remainder is thrown away on every
// read and a loan that is fetched frequently would never complete a month.
//
// Interest accrues on the current outstanding principal (reducing balance)
// for every method except "Flat monthly", which — per the conventional
// meaning of a flat-rate loan — charges on the original principal for the
// full term regardless of repayments. "Compound monthly" additionally
// charges each month on principal PLUS interest still unpaid, so unpaid
// interest itself earns interest.
//
// Penal interest accrues, in addition to regular interest, only for whole
// months the loan has been overdue (past DueDate), applying Scheme.PenalRate
// the same way regular interest applies Scheme.InterestRate (both read as
// annual percentages — see frontend/components/NewLoan.tsx's "N% p.a."
// label). Overdue months are counted from DueDate rather than from the
// anchor, and months already charged are subtracted, so a due date falling
// mid-cycle neither double-charges nor loses a month.
func projectAccrual(l *Loan, sch *scheme.Scheme, asOf time.Time) (interestDelta, penalDelta float64, newAnchor time.Time) {
	from := l.LastAccrualDate
	if from.IsZero() {
		from = l.OpenedDate
	}

	// A loan that's Pending Approval (not yet disbursed), Closed, Rejected,
	// or Auctioned shouldn't keep accruing.
	switch l.Status {
	case StatusActive, StatusDueSoon, StatusOverdue:
	default:
		return 0, 0, from
	}
	if !asOf.After(from) || l.OutstandingAmount <= 0 {
		return 0, 0, from
	}

	periodMonths := 1
	if sch.InterestMethod == "Quarterly simple" {
		periodMonths = monthsPerQuarter
	}
	periods, anchor := completedPeriods(from, asOf, periodMonths)
	if periods == 0 {
		// Still inside the current cycle — nothing is owed yet, and the
		// anchor must not move.
		return 0, 0, from
	}

	annualRate := sch.InterestRate / 100
	monthlyRate := annualRate / 12

	switch sch.InterestMethod {
	case "Flat monthly":
		interestDelta = l.PrincipalAmount * monthlyRate * float64(periods)
	case "Quarterly simple":
		interestDelta = l.OutstandingAmount * (annualRate / 4) * float64(periods)
	case "Compound monthly":
		unpaid := l.AccruedInterest - l.InterestPaid
		if unpaid < 0 {
			unpaid = 0
		}
		for i := 0; i < periods; i++ {
			d := (l.OutstandingAmount + unpaid) * monthlyRate
			interestDelta += d
			unpaid += d
		}
	case "Monthly simple interest":
		fallthrough
	default:
		interestDelta = l.OutstandingAmount * monthlyRate * float64(periods)
	}
	if interestDelta < 0 {
		interestDelta = 0
	}

	if sch.PenalRate > 0 && !l.DueDate.IsZero() {
		charged, _ := completedPeriods(l.DueDate, from, 1)
		total, _ := completedPeriods(l.DueDate, anchor, 1)
		if overdueMonths := total - charged; overdueMonths > 0 {
			penalDelta = l.OutstandingAmount * (sch.PenalRate / 100 / 12) * float64(overdueMonths)
			if penalDelta < 0 {
				penalDelta = 0
			}
		}
	}
	return interestDelta, penalDelta, anchor
}

// accrueAndSave advances l's AccruedInterest/AccruedPenalInterest up to now
// and persists the change, returning whether anything actually changed
// (callers use this to decide whether to re-fetch the saved row).
func (s *Service) accrueAndSave(ctx context.Context, l *Loan) bool {
	now := time.Now()
	interestDelta, penalDelta, anchor := projectAccrual(l, &l.Scheme, now)
	if interestDelta <= 0 && penalDelta <= 0 {
		// No accrual, but the loan may still have crossed its due date since
		// the last read — that alone flips a serviced loan back to Overdue.
		if refreshServicingStatus(l, now) {
			return s.repo.Update(ctx, l) == nil
		}
		return false
	}
	// Rounded at the write, per platform.RoundMoney's contract — an unrounded
	// running total drifts a little further from an exact rupee figure on
	// every accrual, and the residue eventually reads as arrears that were
	// in fact paid off (see enrichStatusFlags/moneyEpsilon).
	l.AccruedInterest = platform.RoundMoney(l.AccruedInterest + interestDelta)
	l.AccruedPenalInterest = platform.RoundMoney(l.AccruedPenalInterest + penalDelta)
	// The anchor, NOT time.Now() — the days since the last completed month
	// belong to the cycle still in progress and must survive this write.
	l.LastAccrualDate = anchor
	// Freshly accrued interest puts a serviced loan back into arrears.
	refreshServicingStatus(l, now)
	if err := s.repo.Update(ctx, l); err != nil {
		return false
	}
	return true
}

// enrich fills in a Loan's computed, request-scoped fields (gorm:"-" on the
// struct) from its persisted accrued/paid totals and its loaded Payments.
// Every read path that returns a Loan (Create/Get/List/Approve/
// RecordPayment/...) calls this so API responses always carry a consistent
// "what's owed today" view without duplicating this math per-handler.
func (s *Service) enrich(ctx context.Context, l *Loan) {
	l.OutstandingInterest = clampMoney(l.AccruedInterest - l.InterestPaid)
	l.OutstandingPenalInterest = clampMoney(l.AccruedPenalInterest - l.PenalInterestPaid)
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

// refreshServicingStatus recomputes an open loan's Status from whether the
// customer is currently in arrears, and reports whether it changed.
//
// A loan past its due date whose interest AND penal interest are paid off in
// full reads as Active rather than Overdue: the term has expired but the
// customer is servicing the debt, and staff need to tell them apart from a
// borrower who has paid nothing. Let arrears build up again and it reverts to
// Overdue on the next accrual — the transition is automatic in both
// directions, so Active is never a state a loan gets stuck in.
//
// Deliberately scoped to the three ordinary open statuses. Loans in the
// approval, closure, auction or closed states are driven by their own
// workflows and must not be rewritten from here — an Auction Eligible loan
// does not quietly become Active because someone paid the interest off.
//
// NOTE: this makes Status alone no longer sufficient to tell whether a loan
// is past term. IsOverdue/DaysOverdue (recomputed on every read by
// enrichStatusFlags) stay authoritative for that.
func refreshServicingStatus(l *Loan, asOf time.Time) bool {
	switch l.Status {
	case StatusActive, StatusDueSoon, StatusOverdue:
	default:
		return false
	}

	outstandingInterest := l.AccruedInterest - l.InterestPaid
	outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
	inArrears := outstandingInterest >= moneyEpsilon || outstandingPenal >= moneyEpsilon

	want := normalStatusFor(l, asOf)
	if !inArrears {
		// Serviced: an expired term alone no longer reads as Overdue.
		want = StatusActive
	}
	if want == l.Status {
		return false
	}
	l.Status = want
	return true
}

// dueSoonWindowDays/defaultedAfterDays are the day-thresholds behind the
// IsDueSoon/IsDefaulted display flags below.
const (
	dueSoonWindowDays  = 7
	defaultedAfterDays = 90
)

// moneyEpsilon is the tolerance below which a rupee balance counts as
// settled — the same 0.01 guard allocatePayment and the closure/auction
// checks use. Accrued and paid totals are float64 sums of rate arithmetic,
// so a fully-cleared balance routinely lands a whisker above zero
// (79.73 − 79.73 = 1.4e-14) rather than exactly on it. Comparing such a
// residue with a bare `> 0` reports arrears that do not exist.
const moneyEpsilon = 0.01

// clampMoney floors a computed balance at zero, treating anything within
// moneyEpsilon of zero as exactly zero so float noise never leaks out as a
// phantom fraction of a paisa.
func clampMoney(v float64) float64 {
	if v < moneyEpsilon {
		return 0
	}
	return v
}

// enrichStatusFlags computes IsDueSoon/IsOverdue/IsDefaulted/DaysOverdue — a
// read-time-only display/filter classification (same "compute on every
// read" pattern as the rest of enrich()), not a persisted status
// transition. Only loans still open (not Closed/Rejected/Auctioned) are
// eligible for these flags; a closed loan is neither due soon nor overdue
// regardless of its due date.
//
// IsOverdue/DaysOverdue/IsDueSoon are pure l.DueDate-vs-asOf math. IsDefaulted
// additionally requires genuine payment arrears — OutstandingInterest and/or
// OutstandingPenalInterest still owed — not just an expired term date. A
// loan that's past its due date but has kept its accrued interest and penal
// interest fully paid down (e.g. one just withdrawn from the auction
// pipeline via a partial-repayment "Removed From Auction" decision, see
// ResolveAuctionDecision) must not immediately flip back to Defaulted and
// reappear in the Auctions worklist on the next read — it should only
// become Defaulted again once it's genuinely back in arrears. This must be
// called after OutstandingInterest/OutstandingPenalInterest are computed
// (see enrich() above) for the same reason.
func enrichStatusFlags(l *Loan, asOf time.Time) {
	switch l.Status {
	case StatusClosed, StatusAuctioned:
		return
	}
	if asOf.After(l.DueDate) {
		overdueDays := int(asOf.Sub(l.DueDate).Hours() / 24)
		l.IsOverdue = true
		l.DaysOverdue = overdueDays
		// Genuine arrears only — a residue smaller than moneyEpsilon is float
		// noise from a cleared balance, not money the customer owes. Judging
		// it with a bare `> 0` kept loans flagged Defaulted (and so eligible
		// for auction) after their interest had been paid off in full.
		l.IsDefaulted = overdueDays > defaultedAfterDays &&
			(l.OutstandingInterest >= moneyEpsilon || l.OutstandingPenalInterest >= moneyEpsilon)
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
