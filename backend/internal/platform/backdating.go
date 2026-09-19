package platform

import (
	"fmt"
	"time"

	"cloudhouse/backend/internal/platform/httpx"
)

// ValidateOccurredOn rejects occurredOn when it is in the future, or earlier
// than lastKnownDate — the shared comparator behind every new financial
// mutation's backdating rule (split-payment recording, investment deposit/
// withdrawal, loan top-up): "the ledger is always chronological and nothing
// already recorded ever needs to be recalculated."
//
// lastKnownDate is the most recent existing movement/payment/event date on
// the SAME account, found by the caller with its own domain-specific query
// (e.g. loan.PaymentRepository.SumInterestCollected's sibling queries, or a
// new FindMostRecentDateForLoan) — this function only does the comparison,
// since "what counts as the latest event" differs per account type. A
// zero-value lastKnownDate means the account has no prior events yet and is
// skipped.
//
// Both sides are compared as calendar dates, not full timestamps: occurredOn
// comes from a date-only form field (midnight local time), while
// lastKnownDate is a stored event's real timestamp (whatever time of day it
// was recorded) — comparing the raw timestamps would reject a same-day entry
// whenever the prior event happened after midnight, even though "today" is
// never earlier than "today".
func ValidateOccurredOn(occurredOn, lastKnownDate, now time.Time) error {
	occurredDate := dateOnly(occurredOn)
	if occurredDate.After(dateOnly(now)) {
		return httpx.NewBadRequest(fmt.Sprintf(
			"date (%s) cannot be in the future", occurredOn.Format("2006-01-02")))
	}
	if !lastKnownDate.IsZero() && occurredDate.Before(dateOnly(lastKnownDate)) {
		return httpx.NewBadRequest(fmt.Sprintf(
			"date (%s) is before the most recent recorded entry on this account (%s)",
			occurredOn.Format("2006-01-02"), lastKnownDate.Format("2006-01-02")))
	}
	return nil
}

// dateOnly zeroes out the time-of-day component of t, in t's own location,
// so two timestamps on the same calendar day always compare equal
// regardless of what time of day each was recorded at.
func dateOnly(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}
