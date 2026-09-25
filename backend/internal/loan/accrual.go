package loan

import (
	"context"
	"sort"
	"time"

	"cloudhouse/backend/internal/platform"
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

// firstMonthTopUpSegment is one day-span of the still-unaccrued first month
// held at a single, unchanging balance — either before any top-up (the
// loan's opening balance) or between two top-ups (or a top-up and the
// month's end).
type firstMonthTopUpSegment struct {
	start, end time.Time
	base       float64 // PrincipalAmount or OutstandingAmount, per the method — see projectAccrual
}

// firstMonthTopUpSegments builds the day-by-day balance history for a
// loan's still-unaccrued first month, if — and only if — at least one
// top-up in topUps actually landed before monthEnd (addMonths(OpenedDate,
// 1)). Returns nil when there is nothing to split (no top-ups, or every
// top-up landed on/after monthEnd — accrual has already run naturally by
// then in practice, but this guard keeps the function correct either way),
// so callers can fall back to the ordinary flat-month charge unchanged.
//
// l.PrincipalAmount/OutstandingAmount already reflect every top-up applied
// so far (TopUpLoan adds directly to both) — this walks the given top-ups
// NEWEST FIRST, subtracting each one's Amount back out, to reconstruct what
// the balance was BEFORE it landed. topUps is expected oldest-first (see
// LoanTopUpRepository.FindByLoanID's own ordering); this function sorts
// defensively rather than trusting the caller's order.
func firstMonthTopUpSegments(l *Loan, topUps []LoanTopUp, monthEnd time.Time) []firstMonthTopUpSegment {
	if len(topUps) == 0 {
		return nil
	}
	sorted := make([]LoanTopUp, len(topUps))
	copy(sorted, topUps)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].OccurredOn.Before(sorted[j].OccurredOn) })

	// Only top-ups strictly before the month's end actually split anything;
	// one recorded later belongs to a month that will accrue normally once
	// it arrives.
	inMonth := sorted[:0:0]
	for _, t := range sorted {
		if t.OccurredOn.Before(monthEnd) {
			inMonth = append(inMonth, t)
		}
	}
	if len(inMonth) == 0 {
		return nil
	}

	currentBase := l.OutstandingAmount
	if l.SchemeInterestMethod == "Flat monthly" {
		currentBase = l.PrincipalAmount
	}

	// Walk newest-first, peeling each top-up's Amount off currentBase to
	// find the balance that held immediately before it — then walk that
	// reconstructed history forward (oldest segment first) to build the
	// actual day-span list accrual sums over.
	preTopUpBase := make([]float64, len(inMonth))
	for i := len(inMonth) - 1; i >= 0; i-- {
		currentBase -= inMonth[i].Amount
		preTopUpBase[i] = currentBase
	}

	segments := make([]firstMonthTopUpSegment, 0, len(inMonth)+1)
	segStart := l.OpenedDate
	base := preTopUpBase[0]
	for i, t := range inMonth {
		end := t.OccurredOn
		if end.After(monthEnd) {
			end = monthEnd
		}
		segments = append(segments, firstMonthTopUpSegment{start: segStart, end: end, base: base})
		segStart = end
		if i+1 < len(preTopUpBase) {
			base = preTopUpBase[i+1]
		} else {
			// After the last top-up, the balance is the loan's current one
			// (every top-up already applied).
			base = l.OutstandingAmount
			if l.SchemeInterestMethod == "Flat monthly" {
				base = l.PrincipalAmount
			}
		}
	}
	if segStart.Before(monthEnd) {
		segments = append(segments, firstMonthTopUpSegment{start: segStart, end: monthEnd, base: base})
	}
	return segments
}

// projectAccrual computes the interest and penal-interest that would accrue
// on l between l.LastAccrualDate and asOf, WITHOUT mutating l — used both by
// accrueAndSave (which persists the result) and by List (which only wants a
// live-projected number for display, not a DB write on every listing).
//
// Interest charges a MINIMUM OF ONE FULL MONTH, billed the moment the loan
// starts accruing at all — a loan repaid five days after opening still owes
// a full month's interest, matching the conventional "minimum interest
// period" gold-loan term. From the second month onward, interest accrues by
// whole calendar month when a month completes, PLUS a running day-by-day
// charge (`monthlyRate/30` per day) for whatever time is left short of the
// next one — never both for the same day (see the anchor-management
// comments below for how that's guaranteed). Months are real calendar
// months measured from the accrual anchor (see addMonths), not 30-day
// blocks, so a loan opened on the 15th completes each month on the 15th
// regardless of month length.
//
// The third return value is the new accrual anchor. Callers MUST store this
// as LastAccrualDate rather than "now" for the first-month floor to behave
// (see below) — it deliberately does NOT always equal asOf.
//
// Interest accrues on the current outstanding principal (reducing balance)
// for every method except "Flat monthly", which — per the conventional
// meaning of a flat-rate loan — charges on the original principal for the
// full term regardless of repayments. "Compound monthly" additionally
// charges each month on principal PLUS interest still unpaid, so unpaid
// interest itself earns interest. The day-by-day remainder charge uses
// whichever of those two bases (PrincipalAmount vs OutstandingAmount) that
// loan's own method already uses for its whole-month charge — never a
// third, hardcoded base.
//
// firstMonthTopUps: any top-ups (Service.TopUpLoan) that landed inside the
// still-unaccrued first month, oldest first. Ordinarily the first-month
// floor below charges a flat month on whatever OutstandingAmount happens to
// be AT ACCRUAL TIME — since accrual is lazy/read-time, a top-up recorded
// before the first accrual ever runs would otherwise get the WHOLE first
// month charged on the post-top-up balance, including the days before the
// top-up existed. When this is non-empty, the flat-month charge is instead
// split day-by-day at monthlyRate/30 (the same daily rate the leftover-days
// charge below already uses): the pre-top-up balance for the days up to
// each top-up's OccurredOn, then the new balance for the days after it,
// continuing through however many top-ups landed in the month, up to the
// addMonths(OpenedDate, 1) boundary. Empty for every call site that hasn't
// resolved the loan's top-up history (e.g. List's batch projection, which
// accepts the flat-month behavior for its display-only, unsaved figure
// rather than an extra query per listed loan).
//
// Penal interest accrues, in addition to regular interest, only for whole
// months the loan has been overdue (past DueDate), applying the loan's own
// frozen SchemePenalRate the same way regular interest applies
// SchemeInterestRate (both read as annual percentages — see
// frontend/components/NewLoan.tsx's "N% p.a." label, and both snapshotted
// from the scheme at loan creation/reassignment rather than looked up live
// — see Loan.applySchemeSnapshot). Unlike regular interest, the penal base
// is OutstandingAmount PLUS unpaid interest (AccruedInterest − InterestPaid,
// including the interestDelta this same call just computed) — a customer who
// has fallen behind on interest as well as principal is charged penal on the
// whole amount owed, not principal alone. No minimum-month floor and no
// daily proration apply to penal interest — it stays whole-month-only,
// counted from DueDate rather than from the accrual anchor, with months
// already charged subtracted so a due date falling mid-cycle neither
// double-charges nor loses a month.
func projectAccrual(l *Loan, asOf time.Time, firstMonthTopUps []LoanTopUp) (interestDelta, penalDelta float64, newAnchor time.Time) {
	from := l.LastAccrualDate
	// CreateLoan seeds LastAccrualDate to OpenedDate directly (never leaves
	// it zero — see service.go), so "no accrual has happened yet" is
	// `from == OpenedDate`, not `from.IsZero()`. The zero check stays as a
	// fallback for any pre-existing row from before that field existed.
	firstAccrual := from.IsZero() || from.Equal(l.OpenedDate)
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

	annualRate := l.SchemeInterestRate / 100
	monthlyRate := annualRate / 12
	// The same base each method's whole-month branch below uses for ITS
	// charge — kept as one variable so the leftover-days charge can never
	// drift onto a different base than the method it's supplementing.
	dailyBase := l.OutstandingAmount
	if l.SchemeInterestMethod == "Flat monthly" {
		dailyBase = l.PrincipalAmount
	}

	var anchor time.Time
	if firstAccrual {
		anchor = addMonths(l.OpenedDate, 1)
		if segments := firstMonthTopUpSegments(l, firstMonthTopUps, anchor); segments != nil {
			// A top-up landed before this loan's first accrual ever ran —
			// split the flat first-month charge day-by-day across each
			// balance the loan actually held during the month, instead of
			// charging the whole month on whatever it ended up at. Same
			// per-day rate (monthlyRate/30) the leftover-days charge below
			// already uses elsewhere in this function.
			for _, seg := range segments {
				days := seg.end.Sub(seg.start).Hours() / 24
				if days <= 0 {
					continue
				}
				interestDelta += seg.base * (monthlyRate / 30) * days
			}
		} else {
			// Minimum-one-month floor — the ordinary case (no top-up landed
			// before this loan's first accrual ran). Charged once,
			// immediately, using the method's own whole-month formula for
			// exactly one period; the anchor above already jumped a full
			// logical month past OpenedDate regardless of how little real
			// time has actually passed. That's what makes a same-month
			// repayment still owe a full month: there is no real day left
			// inside that already-billed month for any later call to
			// re-discover and charge again.
			switch l.SchemeInterestMethod {
			case "Flat monthly":
				interestDelta = l.PrincipalAmount * monthlyRate
			case "Quarterly simple":
				interestDelta = l.OutstandingAmount * (annualRate / 4)
			default: // "Compound monthly", "Monthly simple interest"
				interestDelta = l.OutstandingAmount * monthlyRate
			}
		}
	} else {
		// Anchor is already past the opening month — no more floor logic.
		// Whole completed months first (existing per-method formulas,
		// unchanged), then whatever's left short of the next month is
		// charged day-by-day and the anchor advances all the way to asOf so
		// those leftover days are consumed, not recounted next call.
		periodMonths := 1
		if l.SchemeInterestMethod == "Quarterly simple" {
			periodMonths = monthsPerQuarter
		}
		periods, boundary := completedPeriods(from, asOf, periodMonths)
		switch l.SchemeInterestMethod {
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
		default: // "Monthly simple interest"
			interestDelta = l.OutstandingAmount * monthlyRate * float64(periods)
		}
		if leftoverDays := asOf.Sub(boundary).Hours() / 24; leftoverDays > 0 {
			interestDelta += dailyBase * (monthlyRate / 30) * leftoverDays
		}
		anchor = asOf
	}
	if interestDelta < 0 {
		interestDelta = 0
	}

	if l.SchemePenalRate > 0 && !l.DueDate.IsZero() {
		charged, _ := completedPeriods(l.DueDate, from, 1)
		total, _ := completedPeriods(l.DueDate, anchor, 1)
		if overdueMonths := total - charged; overdueMonths > 0 {
			unpaidInterest := l.AccruedInterest + interestDelta - l.InterestPaid
			if unpaidInterest < 0 {
				unpaidInterest = 0
			}
			penalBase := l.OutstandingAmount + unpaidInterest
			penalDelta = penalBase * (l.SchemePenalRate / 100 / 12) * float64(overdueMonths)
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
	// Top-up history is only fetched when this loan is actually about to hit
	// the first-accrual floor (see projectAccrual's firstMonthTopUps doc
	// comment) — an unconditional query here would cost every single
	// accrual call, not just the one-time first month, for a loan that has
	// never been topped up at all (the overwhelming majority).
	var firstMonthTopUps []LoanTopUp
	if l.LastAccrualDate.IsZero() || l.LastAccrualDate.Equal(l.OpenedDate) {
		if ups, err := s.topUpRepo.FindByLoanID(ctx, l.ID); err == nil {
			firstMonthTopUps = ups
		}
	}
	interestDelta, penalDelta, anchor := projectAccrual(l, now, firstMonthTopUps)
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
	case StatusClosed, StatusRejected, StatusAuctioned:
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

// methodOrDerived returns legacyMethod verbatim when a caller supplied one
// (see PaymentInput.Method's doc comment for why some callers still do),
// otherwise derives it from the four split amounts (platform.DeriveMethod).
func methodOrDerived(legacyMethod string, cash, upi, bank, cheque float64) string {
	if legacyMethod != "" {
		return legacyMethod
	}
	return platform.DeriveMethod(cash, upi, bank, cheque)
}
