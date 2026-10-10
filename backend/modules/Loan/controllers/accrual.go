package controllers

import (
	common "cloudhouse/backend/common/controllers"
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

func projectAccrual(l *models.Loan, asOf time.Time, firstMonthTopUps []models.LoanTopUp) (interestDelta, penalDelta float64, newAnchor time.Time) {
	from := l.LastAccrualDate
	firstAccrual := from.IsZero() || from.Equal(l.OpenedDate)
	if from.IsZero() {
		from = l.OpenedDate
	}
	switch l.Status {
	case models.StatusActive, models.StatusDueSoon, models.StatusOverdue:
	default:
		return 0, 0, from
	}
	if !asOf.After(from) || l.OutstandingAmount <= 0 {
		return 0, 0, from
	}
	annualRate := l.SchemeInterestRate / 100
	monthlyRate := annualRate / 12
	var anchor time.Time
	if firstAccrual {
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
	return interestDelta, penalDelta, anchor
}

func accrueAndSave(ctx context.Context, l *models.Loan) bool {
	now := time.Now()
	var firstMonthTopUps []models.LoanTopUp
	if l.LastAccrualDate.IsZero() || l.LastAccrualDate.Equal(l.OpenedDate) {
		if ups, err := findLoanTopUpActiveByLoanID(ctx, l.ID); err == nil {
			firstMonthTopUps = ups
		}
	}
	interestDelta, penalDelta, anchor := projectAccrual(l, now, firstMonthTopUps)
	if interestDelta <= 0 && penalDelta <= 0 {
		if refreshServicingStatus(l, now) {
			return persistLoan(ctx, l) == nil
		}
		return false
	}
	l.AccruedInterest = common.RoundMoney(l.AccruedInterest + interestDelta)
	l.AccruedPenalInterest = common.RoundMoney(l.AccruedPenalInterest + penalDelta)
	l.LastAccrualDate = anchor
	refreshServicingStatus(l, now)
	if err := persistLoan(ctx, l); err != nil {
		return false
	}
	_ = config.DB.
		WithContext(ctx).Create(&models.LoanAccrual{
		LoanID: l.ID, AccruedOn: anchor,
		Interest: common.RoundMoney(interestDelta), PenalInterest: common.RoundMoney(penalDelta),
	}).Error
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
	case models.PaymentTypeInterest, models.PaymentTypePrincipal, models.PaymentTypePartial, models.PaymentTypeFullSettlement:
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
