package controllers

import (
	loanModels "cloudhouse/backend/modules/Loan/models"
	"cloudhouse/backend/modules/Packet/models"
	"testing"
)

func TestPendingLoanBlocksMove(t *testing.T) {
	pending := loanModels.StatusPendingApproval
	if pendingLoanBlocksMove(pending, models.StatusLockerStored) == "" {
		t.Error("a pending loan's packet must not be moved into a locker")
	}
	if pendingLoanBlocksMove(pending, models.StatusBankPledged) == "" {
		t.Error("a pending loan's packet must not be bank pledged")
	}
	if pendingLoanBlocksMove(pending, models.StatusReleased) != "" {
		t.Error("releasing a pending loan's packet (rejection) must stay allowed")
	}
	if pendingLoanBlocksMove(loanModels.StatusActive, models.StatusLockerStored) != "" {
		t.Error("an approved loan's packet can be moved into a locker")
	}
}

func TestRepledgeAfterBankReleaseIsAllowed(t *testing.T) {
	for _, from := range []string{models.StatusLockerStored, models.StatusReturned, "Packet Generated"} {
		if !isAllowed(from, models.StatusBankPledged) {
			t.Errorf("a packet in %q must be able to move to Bank Pledged", from)
		}
	}
	if isAllowed(models.StatusReleased, models.StatusBankPledged) {
		t.Error("a released packet must not be pledged again")
	}
	if isAllowed(models.StatusBankPledged, models.StatusLockerStored) {
		t.Error("a pledged packet comes back via Returned, not straight to a locker")
	}
}
