package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"strconv"
	"strings"
	"time"
)

func splitCSV(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func parseUintCSV(v string) []uint {
	var out []uint
	for _, p := range splitCSV(v) {
		if id, err := strconv.ParseUint(p, 10, 64); err == nil {
			out = append(out, uint(id))
		}
	}
	return out
}

func validServicing(v string) bool {
	switch v {
	case "due_soon", "overdue", "defaulted":
		return true
	}
	return false
}

func inAuctionPipeline(status string) bool {
	return status == models.StatusAuctionEligible || status == models.StatusAuctionedBalanceDue
}

// inArrears: interest or penal interest is still owed. A past-term loan with none owed (only principal left) is
// being serviced, so it reads Active, not Overdue.
func inArrears(l *models.Loan) bool {
	return l.OutstandingInterest >= moneyEpsilon || l.OutstandingPenalInterest >= moneyEpsilon
}

// effectiveStatus is the one status a loan reads as, after the read-time flags are set. It is what the loan's row
// shows and what the status tabs match, so a loan is never listed under one tab and labelled with another.
// Defaulted is its own class (served by the servicing filter), so it is reported as such here.
func effectiveStatus(l *models.Loan) string {
	switch l.Status {
	case models.StatusActive, models.StatusDueSoon, models.StatusOverdue:
	default:
		return l.Status // Pending Approval, Closure Requested, Auction Eligible, Auctioned…, Closed, Rejected
	}
	if l.IsDefaulted {
		return "Defaulted"
	}
	if l.IsOverdue {
		if inArrears(l) {
			return models.StatusOverdue
		}
		return models.StatusActive
	}
	if l.IsDueSoon {
		return models.StatusDueSoon
	}
	return models.StatusActive
}

func matchesServicing(l *models.Loan, servicing string) bool {
	switch servicing {
	case "due_soon":
		return l.IsDueSoon
	case "overdue":
		return l.IsOverdue && !l.IsDefaulted && inArrears(l) && !inAuctionPipeline(l.Status)
	case "defaulted":
		return l.IsDefaulted && !inAuctionPipeline(l.Status)
	}
	return true
}

func servicingCandidates(servicing string, now time.Time) (statusNotIn []string, dueBefore, dueFrom *time.Time) {
	// A fully paid loan (Closure Requested) is never due, overdue or defaulted.
	notIn := append(append([]string{}, notDefaultableStatuses...), models.StatusClosureRequested)
	// A loan is due, not overdue, for the whole of its due date, so the day
	// boundaries are the start of today rather than the current instant.
	today := startOfDay(now)
	switch servicing {
	case "due_soon":
		from := today
		before := today.AddDate(0, 0, dueSoonWindowDays+1)
		return notIn, &before, &from
	case "overdue":
		// Active stays a candidate: the saved status can lag, and the read-time arrears check decides.
		notIn = append(notIn, models.StatusAuctionEligible, models.StatusAuctionedBalanceDue)
		return notIn, &today, nil
	case "defaulted":
		notIn = append(notIn, models.StatusAuctionEligible, models.StatusAuctionedBalanceDue)
		before := now.AddDate(0, 0, -defaultedAfterDays)
		return notIn, &before, nil
	}
	return nil, nil, nil
}
