package loan

import "time"

// Servicing filter values for LoanFilter.Servicing / GET /loans?servicing=.
// These are the Loans page's Due Soon / Overdue / Defaulted tabs. They are
// read-time classifications (see enrichStatusFlags), not stored statuses, so
// each is narrowed in SQL to a candidate superset and then decided exactly on
// the enriched loan in Service.List before paging.
const (
	ServicingDueSoon   = "due_soon"
	ServicingOverdue   = "overdue"
	ServicingDefaulted = "defaulted"
)

// validServicing reports whether v is a recognised servicing filter value.
func validServicing(v string) bool {
	switch v {
	case ServicingDueSoon, ServicingOverdue, ServicingDefaulted:
		return true
	}
	return false
}

// inAuctionPipeline is true for the stored statuses that already have their
// own place in the Auctions flow — such a loan keeps its IsDefaulted flag but
// is not listed under the Overdue or Defaulted tabs.
func inAuctionPipeline(status string) bool {
	return status == StatusAuctionEligible || status == StatusAuctionedBalanceDue
}

// matchesServicing is the exact test applied to an enriched loan. The tabs
// are mutually exclusive: Overdue excludes defaulted loans, and a loan whose
// interest is fully paid (status Active despite being past term) is not in
// arrears, so it is not listed as Overdue.
func matchesServicing(l *Loan, servicing string) bool {
	switch servicing {
	case ServicingDueSoon:
		return l.IsDueSoon
	case ServicingOverdue:
		return l.IsOverdue && !l.IsDefaulted && l.Status != StatusActive && !inAuctionPipeline(l.Status)
	case ServicingDefaulted:
		return l.IsDefaulted && !inAuctionPipeline(l.Status)
	}
	return true
}

// servicingCandidates narrows the SQL side. It must return a superset of what
// matchesServicing accepts, since arrears are only known after enrichment.
func servicingCandidates(servicing string, now time.Time) (statusNotIn []string, dueBefore, dueFrom *time.Time) {
	notIn := append([]string{}, notDefaultableStatuses...)
	switch servicing {
	case ServicingDueSoon:
		// IsDueSoon: not past due, and at most dueSoonWindowDays whole days left.
		from := now
		before := now.AddDate(0, 0, dueSoonWindowDays+1)
		return notIn, &before, &from
	case ServicingOverdue:
		notIn = append(notIn, StatusAuctionEligible, StatusAuctionedBalanceDue, StatusActive)
		return notIn, &now, nil
	case ServicingDefaulted:
		notIn = append(notIn, StatusAuctionEligible, StatusAuctionedBalanceDue)
		before := now.AddDate(0, 0, -defaultedAfterDays)
		return notIn, &before, nil
	}
	return nil, nil, nil
}
