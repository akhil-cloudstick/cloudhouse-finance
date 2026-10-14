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

	"gorm.io/gorm"
)

const (
	dueSoonWindowDays  = 7
	defaultedAfterDays = 90

	// multipleCycleDays is the length of one charge period on a Multiple-interest loan.
	multipleCycleDays = 30
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
func projectMultipleInterest(l *models.Loan, asOf, from time.Time, firstAccrual, through bool, firstMonthTopUps []models.LoanTopUp) (interest float64, anchor time.Time, level int, parts []accrualPart) {
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
	// The periods already charged since the unpaid-days count began: the rows saved earlier, and any charged
	// earlier in this same call. When a rate step is passed, each of them is restated at the new rate, so every
	// month shows the rate the loan is on now, not only the month being charged.
	type charged struct {
		days    float64
		savedID uint // an interest row already saved, or 0 for a part of this call
		part    int  // index into parts when savedID is 0
	}
	var done []charged
	var restated float64 // the part of this call's interest that went to earlier periods
	savedShare := map[uint]float64{}
	var savedOrder []uint
	restate := func(extra float64) {
		var weight float64
		for _, c := range done {
			weight += c.days
		}
		if weight <= 0 {
			return
		}
		for _, c := range done {
			share := extra * c.days / weight
			if c.savedID != 0 {
				if _, seen := savedShare[c.savedID]; !seen {
					savedOrder = append(savedOrder, c.savedID)
				}
				savedShare[c.savedID] += share
			} else {
				parts[c.part].Interest += share
			}
		}
		restated += extra
	}
	// withRestated adds, after the parts, one entry per saved row that was restated
	withRestated := func(p []accrualPart) []accrualPart {
		for _, id := range savedOrder {
			p = append(p, accrualPart{SavedID: id, Interest: savedShare[id]})
		}
		return p
	}
	if !firstAccrual {
		prevEnd := start
		for _, r := range l.PriorAccruals {
			if days := dayDiff(prevEnd, r.AccruedOn); days > 0 && r.Interest > 0.004 {
				done = append(done, charged{days: float64(days), savedID: r.ID})
			}
			prevEnd = r.AccruedOn
		}
	}
	raise := func(periodStart, periodEnd time.Time) {
		watch := dayDiff(start, periodEnd)
		for level < len(tiers)-1 && watch > ladderThreshold(tiers, level) {
			accrued := dayDiff(start, periodStart)
			if accrued > 0 {
				extra := l.OutstandingAmount * multipleDayRate(tiers[level+1].Rate-tiers[level].Rate) * float64(accrued)
				interest += extra
				restate(extra)
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
		firstDays := multipleCycleDays
		if l.SchemeMinimumDays > firstDays {
			firstDays = l.SchemeMinimumDays
		}
		anchor = l.OpenedDate.AddDate(0, 0, firstDays)
		if !through && asOf.Before(anchor) {
			// nothing is charged ahead of time: the first charge waits until its period is over
			return 0, from, level, nil
		}
		if through && asOf.Before(anchor) {
			// settling early: only the minimum period is owed in full
			anchor = l.OpenedDate.AddDate(0, 0, l.SchemeMinimumDays)
			if asOf.After(anchor) {
				anchor = asOf
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
	periods := dayDiff(from, asOf) / multipleCycleDays
	boundary := from.AddDate(0, 0, periods*multipleCycleDays)
	// chargePeriod charges one period at the rate the loan is on after any step it passes, and files it as a new
	// part; what the step restated on earlier periods is not part of this period's own interest
	chargePeriod := func(ps, pe time.Time) {
		before, restatedBefore := interest, restated
		raise(ps, pe)
		charge(l.OutstandingAmount, ps, pe)
		parts = append(parts, accrualPart{On: pe, Interest: interest - before - (restated - restatedBefore)})
		done = append(done, charged{days: float64(dayDiff(ps, pe)), part: len(parts) - 1})
	}
	for k := 1; k <= periods; k++ {
		chargePeriod(from.AddDate(0, 0, (k-1)*multipleCycleDays), from.AddDate(0, 0, k*multipleCycleDays))
	}
	if through && asOf.After(boundary) {
		chargePeriod(boundary, asOf)
		boundary = asOf
	}
	return interest, boundary, level, withRestated(parts)
}

// accrualPart is one month's share of an accrual, dated at the month's end. A part with SavedID set is not a
// new period: it is extra interest for a row already saved, from restating it at a higher rate step.
type accrualPart struct {
	On       time.Time
	Interest float64
	SavedID  uint
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
	return projectAccrualThrough(l, asOf, false, firstMonthTopUps)
}

// partialPeriodInterest is the interest for part of a charge period on a
// single-rate scheme: the period's interest spread evenly over its days (30 for
// a month, 90 for a quarter). unpaid is the interest already owing, which a
// compound scheme charges interest on.
func partialPeriodInterest(l *models.Loan, days int, unpaid float64) float64 {
	if periodDays := singleRatePeriodDays(l); days > periodDays {
		days = periodDays
	}
	return singleRateInterestForDays(l, days, unpaid)
}

func singleRatePeriodDays(l *models.Loan) int {
	if l.SchemeInterestMethod == "Quarterly simple" {
		return 90
	}
	return 30
}

// singleRateInterestForDays is the interest on a single-rate scheme for any
// number of days, on the same per-day footing as a part period: a period's
// interest spread evenly over its days. Unlike partialPeriodInterest it is not
// capped at one period, so a minimum longer than a month is charged in full.
func singleRateInterestForDays(l *models.Loan, days int, unpaid float64) float64 {
	periodDays := singleRatePeriodDays(l)
	if days <= 0 {
		return 0
	}
	annualRate := l.SchemeInterestRate / 100
	monthlyRate := annualRate / 12
	share := float64(days) / float64(periodDays)
	switch l.SchemeInterestMethod {
	case "Flat monthly":
		return l.PrincipalAmount * monthlyRate * share
	case "Quarterly simple":
		return l.OutstandingAmount * (annualRate / 4) * share
	case "Compound monthly":
		if unpaid < 0 {
			unpaid = 0
		}
		return (l.OutstandingAmount + unpaid) * monthlyRate * share
	default:
		return l.OutstandingAmount * monthlyRate * share
	}
}

// projectAccrualThrough is projectAccrualDetail that, when through is set,
// also charges the days since the last charge date up to asOf, instead of
// stopping at the last completed charge period. A payment uses it so interest
// is settled to the payment date.
func projectAccrualThrough(l *models.Loan, asOf time.Time, through bool, firstMonthTopUps []models.LoanTopUp) (interestDelta, penalDelta float64, newAnchor time.Time, newLevel int, parts []accrualPart) {
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
	// a loan's first charge can be asked for on the day it opened (a payment or the page that day owes the minimum
	// period); after that, nothing accrues until asOf is past the last charge date
	onOpeningDay := through && firstAccrual && asOf.Equal(from)
	if asOf.Before(from) || (asOf.Equal(from) && !onOpeningDay) || l.OutstandingAmount <= 0 {
		return 0, 0, from, newLevel, nil
	}
	annualRate := l.SchemeInterestRate / 100
	monthlyRate := annualRate / 12
	var anchor time.Time
	if l.SchemeInterestMethod == commonModels.InterestMethodMultiple && len(l.SchemeRateTiers) > 0 {
		interestDelta, anchor, newLevel, parts = projectMultipleInterest(l, asOf, from, firstAccrual, through, firstMonthTopUps)
	} else if firstAccrual {
		monthEnd := addMonths(l.OpenedDate, 1)
		minEnd := l.OpenedDate.AddDate(0, 0, l.SchemeMinimumDays)
		anchor = monthEnd
		if minEnd.After(anchor) {
			anchor = minEnd
		}
		// the first charge is made once its period is over; nothing is charged ahead of
		// time, so what is owed never depends on whether the loan was opened in between
		if asOf.Before(anchor) && !through {
			return 0, 0, from, newLevel, nil
		}
		// an early settlement owes the days so far, but never less than the minimum period
		partial := asOf.Before(anchor)
		if partial {
			anchor = asOf
			if minEnd.After(anchor) {
				anchor = minEnd
			}
		}
		extended := !partial && anchor.After(monthEnd)
		if segments := firstMonthTopUpSegments(l, firstMonthTopUps, anchor); segments != nil {
			for _, seg := range segments {
				days := seg.end.Sub(seg.start).Hours() / 24
				if days <= 0 {
					continue
				}
				interestDelta += seg.base * (monthlyRate / 30) * days
			}
		} else if partial || extended {
			interestDelta = singleRateInterestForDays(l, dayDiff(l.OpenedDate, anchor), 0)
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
		if through && asOf.After(boundary) {
			interestDelta += partialPeriodInterest(l, dayDiff(boundary, asOf), l.AccruedInterest+interestDelta-l.InterestPaid)
			anchor = asOf
		}
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
	return accrueAndSaveAt(ctx, l, sameClockAsOpened(l, time.Now()), false)
}

// sameClockAsOpened is t's calendar day at the loan's own time of day, so that
// the days counted from the opened date are whole days: a payment and the page
// showing what is owed count the same days at any hour.
func sameClockAsOpened(l *models.Loan, t time.Time) time.Time {
	o := l.OpenedDate
	y, m, d := t.In(o.Location()).Date()
	return time.Date(y, m, d, o.Hour(), o.Minute(), o.Second(), 0, o.Location())
}

// syncAccrualState brings l's money, charge-date and status fields up to what is
// saved, once the loan row is locked: another request may have charged or been
// paid since l was read.
func syncAccrualState(l, saved *models.Loan) {
	l.AccruedInterest = saved.AccruedInterest
	l.AccruedPenalInterest = saved.AccruedPenalInterest
	l.InterestPaid = saved.InterestPaid
	l.PenalInterestPaid = saved.PenalInterestPaid
	l.OutstandingAmount = saved.OutstandingAmount
	l.OutstandingProcessingFee = saved.OutstandingProcessingFee
	l.LastAccrualDate = saved.LastAccrualDate
	l.RateTierLevel = saved.RateTierLevel
	l.ArrearsSince = saved.ArrearsSince
	l.Status = saved.Status
}

// accrueStep works out one pass of interest to asOf and applies it to l in
// memory, returning the ledger rows to save with it. Nothing is written.
func accrueStep(ctx context.Context, l *models.Loan, asOf time.Time, through bool) (rows []models.LoanAccrual, restated []accrualPart, changed bool) {
	now := time.Now()
	var firstMonthTopUps []models.LoanTopUp
	first := l.LastAccrualDate.IsZero() || l.LastAccrualDate.Equal(l.OpenedDate)
	if first {
		if ups, err := findLoanTopUpActiveByLoanID(ctx, l.ID); err == nil {
			firstMonthTopUps = ups
		}
	} else if l.SchemeInterestMethod == commonModels.InterestMethodMultiple && l.PriorAccruals == nil {
		l.PriorAccruals = loadCycleAccruals(ctx, l)
	}
	interestDelta, penalDelta, anchor, level, parts := projectAccrualThrough(l, asOf, through, firstMonthTopUps)
	if interestDelta <= 0 && penalDelta <= 0 {
		return nil, nil, refreshServicingStatus(l, now)
	}
	// a rate step restates the periods already charged: their extra goes onto their own saved rows, and only
	// what is left is the interest of the new periods
	var newParts []accrualPart
	var restatedTotal float64
	for _, p := range parts {
		if p.SavedID == 0 {
			newParts = append(newParts, p)
			continue
		}
		p.Interest = common.RoundMoney(p.Interest)
		restated = append(restated, p)
		restatedTotal += p.Interest
	}
	l.RateTierLevel = level
	l.AccruedInterest = common.RoundMoney(l.AccruedInterest + interestDelta)
	l.AccruedPenalInterest = common.RoundMoney(l.AccruedPenalInterest + penalDelta)
	l.LastAccrualDate = anchor
	l.PriorAccruals = nil
	refreshServicingStatus(l, now)
	return accrualRows(l.ID, interestDelta-restatedTotal, penalDelta, anchor, newParts), restated, true
}

// loadCycleAccruals is the interest rows saved since the loan's unpaid-days count began, oldest first.
func loadCycleAccruals(ctx context.Context, l *models.Loan) []models.LoanAccrual {
	start := l.OpenedDate
	if l.ArrearsSince != nil {
		start = *l.ArrearsSince
	}
	var rows []models.LoanAccrual
	if err := config.DB.WithContext(ctx).Where("loan_id = ? AND accrued_on > ?", l.ID, start).Order("accrued_on, id").Find(&rows).Error; err != nil {
		return nil
	}
	return rows
}

// saveRestated adds each restated share to its saved interest row, inside the caller's transaction.
func saveRestated(ctx context.Context, tx *gorm.DB, restated []accrualPart) error {
	for _, p := range restated {
		if err := tx.WithContext(ctx).Model(&models.LoanAccrual{}).Where("id = ?", p.SavedID).
			Update("interest", gorm.Expr("interest + ?", p.Interest)).Error; err != nil {
			return err
		}
	}
	return nil
}

// accrueThroughInTx charges a loan's interest up to paidOn, including the days
// of a part-finished charge period, inside the caller's transaction on a loan it
// has locked, so a payment settles interest to the payment date and the charge
// is undone with the payment if the payment fails. It takes two passes because a
// loan's first charge is made on its own before the periods that follow it.
func accrueThroughInTx(ctx context.Context, tx *gorm.DB, l *models.Loan, paidOn time.Time) error {
	if now := time.Now(); paidOn.After(now) {
		paidOn = now
	}
	asOf := sameClockAsOpened(l, paidOn)
	for pass := 0; pass < 2; pass++ {
		rows, restated, _ := accrueStep(ctx, l, asOf, true)
		if len(rows) > 0 {
			if err := tx.WithContext(ctx).Create(&rows).Error; err != nil {
				return err
			}
		}
		if err := saveRestated(ctx, tx, restated); err != nil {
			return err
		}
	}
	return nil
}

// accrueAndSaveAt saves the interest owed to asOf. The loan row is locked and
// re-read first, so two requests at once cannot both charge the same period, and
// the loan and its ledger rows are saved together.
func accrueAndSaveAt(ctx context.Context, l *models.Loan, asOf time.Time, through bool) bool {
	saved := false
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		fresh, err := lockByID(ctx, tx, l.ID)
		if err != nil {
			return err
		}
		syncAccrualState(l, fresh)
		rows, restated, changed := accrueStep(ctx, l, asOf, through)
		if !changed {
			return nil
		}
		if err := updateLoanTx(ctx, tx, l); err != nil {
			return err
		}
		if len(rows) > 0 {
			if err := tx.WithContext(ctx).Create(&rows).Error; err != nil {
				return err
			}
		}
		if err := saveRestated(ctx, tx, restated); err != nil {
			return err
		}
		saved = true
		return nil
	})
	return err == nil && saved
}

// interestToDate is what the loan owes in interest and penal interest as of now:
// what has been saved plus the days since the last charge, worked out on the
// spot and never saved. A payment saves exactly this figure, so the amount shown
// is the amount owed whenever the page was opened.
func interestToDate(ctx context.Context, l *models.Loan) (interest, penal float64) {
	var firstMonthTopUps []models.LoanTopUp
	if l.ID != 0 && (l.LastAccrualDate.IsZero() || l.LastAccrualDate.Equal(l.OpenedDate)) {
		if ups, err := findLoanTopUpActiveByLoanID(ctx, l.ID); err == nil {
			firstMonthTopUps = ups
		}
	}
	// worked out on a copy in the same two passes a payment makes: a loan whose first
	// charge has not been saved yet gets that charge first, then the days after it
	asOf := sameClockAsOpened(l, time.Now())
	owing := *l
	for pass := 0; pass < 2; pass++ {
		interestDelta, penalDelta, anchor, level, _ := projectAccrualThrough(&owing, asOf, true, firstMonthTopUps)
		owing.AccruedInterest += interestDelta
		owing.AccruedPenalInterest += penalDelta
		owing.LastAccrualDate = anchor
		owing.RateTierLevel = level
		firstMonthTopUps = nil
	}
	return common.RoundMoney(owing.AccruedInterest), common.RoundMoney(owing.AccruedPenalInterest)
}

func enrichLoan(ctx context.Context, l *models.Loan) {
	accrued, accruedPenal := interestToDate(ctx, l)
	l.OutstandingInterest = clampMoney(accrued - l.InterestPaid)
	l.OutstandingPenalInterest = clampMoney(accruedPenal - l.PenalInterestPaid)
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
