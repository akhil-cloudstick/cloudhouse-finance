package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"math"
	"sort"
	"time"
)

const (
	dueSoonWindowDays  = 7
	defaultedAfterDays = 90
)

const moneyEpsilon = 0.01

type firstMonthTopUpSegment struct {
	start, end time.Time
	base       float64
}

func daysInMonth(y int, m time.Month) int {
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func addMonths(t time.Time, n int) time.Time {
	y, m, d := t.Date()
	target := time.Date(y, m, 1, 0, 0, 0, 0, t.Location()).AddDate(0, n, 0)
	ty, tm := target.Year(), target.Month()
	if last := daysInMonth(ty, tm); d > last {
		d = last
	}
	return time.Date(ty, tm, d, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
}

func startAccrualAtDisbursement(l *models.Loan, disbursedAt time.Time) {
	opened := l.OpenedDate.In(time.Local)
	if opened.Format("2006-01-02") < l.CreatedAt.In(time.Local).Format("2006-01-02") {
		return
	}
	from := time.Date(opened.Year(), opened.Month(), opened.Day(), 0, 0, 0, 0, time.Local)
	d := disbursedAt.In(time.Local)
	to := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.Local)
	days := int(math.Round(to.Sub(from).Hours() / 24))
	if days <= 0 {
		return
	}
	l.OpenedDate = l.OpenedDate.AddDate(0, 0, days)
	l.DueDate = l.DueDate.AddDate(0, 0, days)
	l.LastAccrualDate = l.OpenedDate
	l.RateTierLevel = 0
	l.ArrearsSince = nil
	l.DueSoonNotifiedAt = nil
	l.OverdueNotifiedAt = nil
}

func completedPeriods(from, asOf time.Time, months int) (int, time.Time) {
	n := 0
	for !addMonths(from, months*(n+1)).After(asOf) {
		n++
	}
	return n, addMonths(from, months*n)
}

func firstMonthTopUpSegments(l *models.Loan, topUps []models.LoanTopUp, monthEnd time.Time) []firstMonthTopUpSegment {
	if len(topUps) == 0 {
		return nil
	}
	sorted := make([]models.LoanTopUp, len(topUps))
	copy(sorted, topUps)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].OccurredOn.Before(sorted[j].OccurredOn) })
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

func dayDiff(a, b time.Time) int {
	return int(math.Round(b.Sub(a).Hours() / 24))
}

// multipleDayRate is the interest on one rupee for one day at an annual rate:
// Multiple-interest loans accrue on the actual number of days, over a 365-day year.
func multipleDayRate(annualPercent float64) float64 {
	return annualPercent / 100 / 365
}

// ladderThreshold is the unpaid-days count that, once passed, moves the loan
// from step `level` to the next: the days of rows 0..level added together.
func ladderThreshold(tiers []commonModels.RateTier, level int) int {
	total := 0
	for i := 0; i <= level && i < len(tiers); i++ {
		total += tiers[i].Days
	}
	return total
}

// projectMultipleInterest accrues a "Multiple interest" loan. Interest is
// worked out on the actual days (outstanding × rate ÷ 365 × days in the period)
// and charged one calendar month at a time. When the days since interest was
// last paid pass a step's limit, the interest already accrued over those days
// is re-priced at the new rate: the extra is outstanding × (new − old) ÷ 365 ×
// days already accrued, added to the period being charged. Returns the
// interest, the new anchor, the step the loan ends on, and the interest split
// by month (each month's share includes any re-pricing it triggered) so the
// ledger can show one entry per month.
func projectMultipleInterest(l *models.Loan, asOf, from time.Time, firstAccrual bool, firstMonthTopUps []models.LoanTopUp) (interest float64, anchor time.Time, level int, parts []accrualPart) {
	tiers := l.SchemeRateTiers
	level = l.RateTierLevel
	if level < 0 {
		level = 0
	}
	if level > len(tiers)-1 {
		level = len(tiers) - 1
	}
	start := l.OpenedDate
	if l.ArrearsSince != nil {
		start = *l.ArrearsSince
	}
	raise := func(periodStart, periodEnd time.Time) {
		watch := dayDiff(start, periodEnd)
		for level < len(tiers)-1 && watch > ladderThreshold(tiers, level) {
			accrued := dayDiff(start, periodStart)
			if accrued > 0 {
				interest += l.OutstandingAmount * multipleDayRate(tiers[level+1].Rate-tiers[level].Rate) * float64(accrued)
			}
			level++
		}
	}
	charge := func(base float64, periodStart, periodEnd time.Time) {
		if days := dayDiff(periodStart, periodEnd); days > 0 {
			interest += base * multipleDayRate(tiers[level].Rate) * float64(days)
		}
	}
	if firstAccrual {
		anchor = addMonths(l.OpenedDate, 1)
		if l.SchemeMinimumDays > 0 {
			if floor := l.OpenedDate.AddDate(0, 0, l.SchemeMinimumDays); floor.After(anchor) {
				anchor = floor
			}
		}
		raise(l.OpenedDate, anchor)
		if segments := firstMonthTopUpSegments(l, firstMonthTopUps, anchor); segments != nil {
			for _, seg := range segments {
				charge(seg.base, seg.start, seg.end)
			}
		} else {
			charge(l.OutstandingAmount, l.OpenedDate, anchor)
		}
		return interest, anchor, level, []accrualPart{{On: anchor, Interest: interest}}
	}
	periods, boundary := completedPeriods(from, asOf, 1)
	for k := 1; k <= periods; k++ {
		ps, pe := addMonths(from, k-1), addMonths(from, k)
		before := interest
		raise(ps, pe)
		charge(l.OutstandingAmount, ps, pe)
		parts = append(parts, accrualPart{On: pe, Interest: interest - before})
	}
	return interest, boundary, level, parts
}

// accrualPart is one month's share of an accrual, dated at the month's end.
type accrualPart struct {
	On       time.Time
	Interest float64
}

// resetRateCycle sends a Multiple-interest loan back to its first rate and
// restarts the unpaid-days count from the payment date.
func resetRateCycle(l *models.Loan, paidOn time.Time) {
	if l.SchemeInterestMethod != commonModels.InterestMethodMultiple {
		return
	}
	l.RateTierLevel = 0
	l.ArrearsSince = &paidOn
}

func projectAccrual(l *models.Loan, asOf time.Time, firstMonthTopUps []models.LoanTopUp) (interestDelta, penalDelta float64, newAnchor time.Time) {
	interestDelta, penalDelta, newAnchor, _ = projectAccrualState(l, asOf, firstMonthTopUps)
	return
}

// projectAccrualState is projectAccrual plus the rate step the loan ends on,
// for callers that save the result.
func projectAccrualState(l *models.Loan, asOf time.Time, firstMonthTopUps []models.LoanTopUp) (interestDelta, penalDelta float64, newAnchor time.Time, newLevel int) {
	interestDelta, penalDelta, newAnchor, newLevel, _ = projectAccrualDetail(l, asOf, firstMonthTopUps)
	return
}

// projectAccrualDetail is projectAccrualState plus, for Multiple-interest
// loans, the interest split by month.
func projectAccrualDetail(l *models.Loan, asOf time.Time, firstMonthTopUps []models.LoanTopUp) (interestDelta, penalDelta float64, newAnchor time.Time, newLevel int, parts []accrualPart) {
	newLevel = l.RateTierLevel
	from := l.LastAccrualDate
	firstAccrual := from.IsZero() || from.Equal(l.OpenedDate)
	if from.IsZero() {
		from = l.OpenedDate
	}
	switch l.Status {
	case models.StatusActive, models.StatusDueSoon, models.StatusOverdue:
	default:
		return 0, 0, from, newLevel, nil
	}
	if !asOf.After(from) || l.OutstandingAmount <= 0 {
		return 0, 0, from, newLevel, nil
	}
	annualRate := l.SchemeInterestRate / 100
	monthlyRate := annualRate / 12
	var anchor time.Time
	if l.SchemeInterestMethod == commonModels.InterestMethodMultiple && len(l.SchemeRateTiers) > 0 {
		interestDelta, anchor, newLevel, parts = projectMultipleInterest(l, asOf, from, firstAccrual, firstMonthTopUps)
	} else if firstAccrual {
		anchor = addMonths(l.OpenedDate, 1)
		if segments := firstMonthTopUpSegments(l, firstMonthTopUps, anchor); segments != nil {
			for _, seg := range segments {
				days := seg.end.Sub(seg.start).Hours() / 24
				if days <= 0 {
					continue
				}
				interestDelta += seg.base * (monthlyRate / 30) * days
			}
		} else {
			switch l.SchemeInterestMethod {
			case "Flat monthly":
				interestDelta = l.PrincipalAmount * monthlyRate
			case "Quarterly simple":
				interestDelta = l.OutstandingAmount * (annualRate / 4)
			default:
				interestDelta = l.OutstandingAmount * monthlyRate
			}
		}
	} else {
		periodMonths := 1
		if l.SchemeInterestMethod == "Quarterly simple" {
			periodMonths = 3
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
		default:
			interestDelta = l.OutstandingAmount * monthlyRate * float64(periods)
		}
		anchor = boundary
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
	return interestDelta, penalDelta, anchor, newLevel, parts
}

// accrualRows turns an accrual into the rows saved for the ledger: one per month
// when the projection came in parts, otherwise a single row. Rounding is settled
// on the last month so the rows add up to exactly the interest added to the loan.
func accrualRows(loanID uint, interest, penal float64, anchor time.Time, parts []accrualPart) []models.LoanAccrual {
	if len(parts) < 2 {
		return []models.LoanAccrual{{LoanID: loanID, AccruedOn: anchor, Interest: common.RoundMoney(interest), PenalInterest: common.RoundMoney(penal)}}
	}
	rows := make([]models.LoanAccrual, 0, len(parts))
	var sum float64
	for i, p := range parts {
		amount := common.RoundMoney(p.Interest)
		if i == len(parts)-1 {
			amount = common.RoundMoney(common.RoundMoney(interest) - sum)
		}
		sum = common.RoundMoney(sum + amount)
		rows = append(rows, models.LoanAccrual{LoanID: loanID, AccruedOn: p.On, Interest: amount})
	}
	rows[len(rows)-1].PenalInterest = common.RoundMoney(penal)
	return rows
}

func accrueAndSave(ctx context.Context, l *models.Loan) bool {
	now := time.Now()
	var firstMonthTopUps []models.LoanTopUp
	if l.LastAccrualDate.IsZero() || l.LastAccrualDate.Equal(l.OpenedDate) {
		if ups, err := findLoanTopUpActiveByLoanID(ctx, l.ID); err == nil {
			firstMonthTopUps = ups
		}
	}
	interestDelta, penalDelta, anchor, level, parts := projectAccrualDetail(l, now, firstMonthTopUps)
	if interestDelta <= 0 && penalDelta <= 0 {
		if refreshServicingStatus(l, now) {
			return persistLoan(ctx, l) == nil
		}
		return false
	}
	l.RateTierLevel = level
	l.AccruedInterest = common.RoundMoney(l.AccruedInterest + interestDelta)
	l.AccruedPenalInterest = common.RoundMoney(l.AccruedPenalInterest + penalDelta)
	l.LastAccrualDate = anchor
	refreshServicingStatus(l, now)
	if err := persistLoan(ctx, l); err != nil {
		return false
	}
	rows := accrualRows(l.ID, interestDelta, penalDelta, anchor, parts)
	_ = config.DB.
		WithContext(ctx).Create(&rows).Error
	return true
}

func enrichLoan(ctx context.Context, l *models.Loan) {
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
	l.ApprovalWarning = sanctionWarning(ctx, l)
}

func refreshServicingStatus(l *models.Loan, asOf time.Time) bool {
	switch l.Status {
	case models.StatusActive, models.StatusDueSoon, models.StatusOverdue:
	default:
		return false
	}
	outstandingInterest := l.AccruedInterest - l.InterestPaid
	outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
	inArrears := outstandingInterest >= moneyEpsilon || outstandingPenal >= moneyEpsilon
	want := normalStatusFor(l, asOf)
	if !inArrears {
		want = models.StatusActive
	}
	if want == l.Status {
		return false
	}
	l.Status = want
	return true
}

func clampMoney(v float64) float64 {
	if v < moneyEpsilon {
		return 0
	}
	return v
}

func enrichStatusFlags(l *models.Loan, asOf time.Time) {
	switch l.Status {
	case models.StatusClosed, models.StatusRejected, models.StatusAuctioned:
		return
	}
	if asOf.After(l.DueDate) {
		overdueDays := int(asOf.Sub(l.DueDate).Hours() / 24)
		l.IsOverdue = true
		l.DaysOverdue = overdueDays
		l.IsDefaulted = overdueDays > defaultedAfterDays &&
			(l.OutstandingInterest >= moneyEpsilon || l.OutstandingPenalInterest >= moneyEpsilon)
		return
	}
	daysUntilDue := int(l.DueDate.Sub(asOf).Hours() / 24)
	l.IsDueSoon = daysUntilDue <= dueSoonWindowDays
}

func isCashPaymentType(t string) bool {
	switch t {
	case models.PaymentTypeInterest, models.PaymentTypePenalInterest, models.PaymentTypePrincipal, models.PaymentTypePartial, models.PaymentTypeFullSettlement:
		return true
	default:
		return false
	}
}

func methodOrDerived(legacyMethod string, cash, upi, bank, cheque float64) string {
	if legacyMethod != "" {
		return legacyMethod
	}
	return common.DeriveMethod(cash, upi, bank, cheque)
}
