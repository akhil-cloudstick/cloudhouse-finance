package loan

import "testing"

// The bank re-pledge eligibility matrix — one OPEN pledge at a time, plus
// the custody rule that the branch must still hold the gold to hand it over.
// Service.RecordBankPledge needs a
// database, so the decision itself lives in bankPledgeRefusal and is
// exercised here directly: every combination of loan status and
// bank-pledge status that the service can be handed, with the exact error it
// must refuse with (a bare "refused" assertion would let ErrLoanNotPledgeable
// and ErrBankPledgeStillActive swap places unnoticed — they mean different
// things to the caller).
func TestBankPledgeRefusal_StatusMatrix(t *testing.T) {
	cases := []struct {
		name             string
		status           string
		bankPledgeStatus string
		want             error
	}{
		// The only shape that may proceed: gold in custody, never pledged.
		{"active loan, never pledged", StatusActive, BankPledgeStatusNotPledged, nil},
		{"overdue loan, never pledged", StatusOverdue, BankPledgeStatusNotPledged, nil},

		// Custody rule — the branch no longer holds the gold, or never did.
		{"closed loan", StatusClosed, BankPledgeStatusNotPledged, ErrLoanNotPledgeable},
		{"closure requested", StatusClosureRequested, BankPledgeStatusNotPledged, ErrLoanNotPledgeable},
		{"auctioned", StatusAuctioned, BankPledgeStatusNotPledged, ErrLoanNotPledgeable},
		{"auctioned, balance due", StatusAuctionedBalanceDue, BankPledgeStatusNotPledged, ErrLoanNotPledgeable},
		{"not yet disbursed", StatusPendingApproval, BankPledgeStatusNotPledged, ErrLoanNotPledgeable},

		// Only an OPEN pledge blocks a new one.
		{"pledge still open", StatusActive, BankPledgeStatusPledged, ErrBankPledgeStillActive},
		// Released means the gold came BACK from the bank, so the loan may be
		// pledged again — the once-per-lifetime rule was dropped deliberately
		// (see bankPledgeRefusal).
		{"gold returned from the bank, pledgeable again", StatusActive, BankPledgeStatusReleased, nil},

		// Both rules broken at once: custody is reported first, since it is
		// the more fundamental refusal and the more useful message.
		{"closed and already pledged", StatusClosed, BankPledgeStatusPledged, ErrLoanNotPledgeable},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := bankPledgeRefusal(tc.status, tc.bankPledgeStatus)
			if got != tc.want {
				t.Fatalf("bankPledgeRefusal(%q, %q) = %v, want %v",
					tc.status, tc.bankPledgeStatus, got, tc.want)
			}
		})
	}
}

// The ineligible list and CanAcceptBankPledge must not drift apart: the
// frontend keeps a hand-maintained copy of this list
// (loanService.ts's BANK_PLEDGE_INELIGIBLE_STATUSES), so a status silently
// dropped from the Go list would go unnoticed on both sides.
func TestCanAcceptBankPledge_RefusesEveryIneligibleStatus(t *testing.T) {
	for _, s := range bankPledgeIneligibleStatuses {
		if CanAcceptBankPledge(s) {
			t.Errorf("status %q is in bankPledgeIneligibleStatuses but CanAcceptBankPledge allowed it", s)
		}
	}
	if !CanAcceptBankPledge(StatusActive) {
		t.Error("an Active loan must be pledgeable")
	}
}
