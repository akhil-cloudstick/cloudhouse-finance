package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"testing"
)

// Gold pledged to a bank is not in the branch's hands, so it can't go to auction until the bank
// releases it — and gold already committed to an auction case can't be handed to a bank.

func TestAuction_GoldAtBankBlocksAuctionSteps(t *testing.T) {
	cases := []struct {
		name          string
		pledgeStatus  string
		activePledges int64
		blocked       bool
	}{
		{"whole loan pledged to a bank", models.BankPledgeStatusPledged, 1, true},
		{"an ornament still at a bank though the loan reads released", "Released", 1, true},
		{"released from the bank", "Released", 0, false},
		{"never pledged", "Not Pledged", 0, false},
	}
	for _, c := range cases {
		err := goldAtBankRefusal(c.pledgeStatus, c.activePledges, "continuing the auction")
		if (err != nil) != c.blocked {
			t.Errorf("%s: blocked = %v, want %v (err %v)", c.name, err != nil, c.blocked, err)
		}
	}
}

func TestAuction_DefaultedLoanWithGoldAtBankIsNotAnAuctionCandidate(t *testing.T) {
	pledged := &models.Loan{Status: models.StatusActive, IsDefaulted: true, BankPledgeStatus: models.BankPledgeStatusPledged}
	if AvailableForAuction(pledged) {
		t.Error("a defaulted loan whose gold is pledged to a bank must not be available for auction")
	}
	if isAuctionCase(pledged) {
		t.Error("a defaulted loan whose gold is pledged to a bank must not be listed as an auction case")
	}

	released := &models.Loan{Status: models.StatusActive, IsDefaulted: true, BankPledgeStatus: "Released"}
	if !AvailableForAuction(released) || !isAuctionCase(released) {
		t.Error("once the bank releases the gold, the defaulted loan is an auction candidate again")
	}

	// A case opened before the gold went to the bank stays listed, so staff can see it and release the gold.
	open := &models.Loan{Status: models.StatusAuctionEligible, IsDefaulted: true, BankPledgeStatus: models.BankPledgeStatusPledged}
	if !isAuctionCase(open) {
		t.Error("an auction case already in progress must stay listed")
	}
}

func TestBankPledge_RefusedWhileAuctionCaseOpen(t *testing.T) {
	for _, stage := range []string{models.AuctionStageEligible, models.AuctionStageNotice, models.AuctionStageScheduled, models.AuctionStageAuctioned} {
		if auctionCaseBlocksBankPledge(stage) == nil {
			t.Errorf("stage %s: pledging the gold to a bank must be refused while the auction case is open", stage)
		}
	}
	for _, stage := range []string{models.AuctionStageSettled, models.AuctionStageWithdrawn} {
		if err := auctionCaseBlocksBankPledge(stage); err != nil {
			t.Errorf("stage %s: a closed auction case must not block a bank pledge, got %v", stage, err)
		}
	}
}
