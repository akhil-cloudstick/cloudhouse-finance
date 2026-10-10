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

func matchesServicing(l *models.Loan, servicing string) bool {
	switch servicing {
	case "due_soon":
		return l.IsDueSoon
	case "overdue":
		return l.IsOverdue && !l.IsDefaulted && l.Status != models.StatusActive && !inAuctionPipeline(l.Status)
	case "defaulted":
		return l.IsDefaulted && !inAuctionPipeline(l.Status)
	}
	return true
}

func servicingCandidates(servicing string, now time.Time) (statusNotIn []string, dueBefore, dueFrom *time.Time) {
	notIn := append([]string{}, notDefaultableStatuses...)
	switch servicing {
	case "due_soon":
		from := now
		before := now.AddDate(0, 0, dueSoonWindowDays+1)
		return notIn, &before, &from
	case "overdue":
		notIn = append(notIn, models.StatusAuctionEligible, models.StatusAuctionedBalanceDue, models.StatusActive)
		return notIn, &now, nil
	case "defaulted":
		notIn = append(notIn, models.StatusAuctionEligible, models.StatusAuctionedBalanceDue)
		before := now.AddDate(0, 0, -defaultedAfterDays)
		return notIn, &before, nil
	}
	return nil, nil, nil
}
