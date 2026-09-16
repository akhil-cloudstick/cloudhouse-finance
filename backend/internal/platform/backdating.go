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
func ValidateOccurredOn(occurredOn, lastKnownDate, now time.Time) error {
	if occurredOn.After(now) {
		return httpx.NewBadRequest(fmt.Sprintf(
			"date (%s) cannot be in the future", occurredOn.Format("2006-01-02")))
	}
	if !lastKnownDate.IsZero() && occurredOn.Before(lastKnownDate) {
		return httpx.NewBadRequest(fmt.Sprintf(
			"date (%s) is before the most recent recorded entry on this account (%s)",
			occurredOn.Format("2006-01-02"), lastKnownDate.Format("2006-01-02")))
	}
	return nil
}
