package controllers

import (
	"cloudhouse/backend/modules/Investment/models"
	"testing"
	"time"
)

func liveInv(rate float64) *models.Investment {
	return &models.Investment{
		Engine: models.EngineLive, Status: models.StatusActive, InterestRateType: models.InterestRateTypeSimple,
		InterestRatePercent: rate, PayoutFrequency: models.PayoutFrequencyMonthly,
		MaturityDate: day(3650),
	}
}

func sampleTxs() []models.InvestmentTransaction {
	return []models.InvestmentTransaction{
		{ID: 1, Type: "Deposit", Amount: 50000, PrincipalAmount: 50000, OccurredOn: day(30)},
		{ID: 2, Type: "Withdrawal", Amount: 20000, PrincipalAmount: 20000, OccurredOn: day(60)},
	}
}

func TestReplayLive_ChainsPrincipalAndRewritesRows(t *testing.T) {
	inv := liveInv(12)
	txs := sampleTxs()
	if err := replayLive(inv, 100000, day(0), txs, day(90)); err != nil {
		t.Fatal(err)
	}
	approxEqual(t, txs[0].PrincipalBefore, 100000, "first before")
	approxEqual(t, txs[0].PrincipalAfter, 150000, "first after")
	approxEqual(t, txs[1].PrincipalBefore, 150000, "second before")
	approxEqual(t, txs[1].PrincipalAfter, 130000, "second after")
	approxEqual(t, inv.OutstandingPrincipal, 130000, "outstanding")
	approxEqual(t, inv.PrincipalAmount, 130000, "invested")
	if inv.AccruedInterest <= 0 {
		t.Fatal("expected interest to accrue")
	}
	if diff := checkPrincipalChain(100000, txs, inv); diff != "" {
		t.Fatalf("replayed rows should chain: %s", diff)
	}
}

func TestReplayLive_RefusesWithdrawalLargerThanOutstanding(t *testing.T) {
	inv := liveInv(12)
	txs := sampleTxs()
	// removing the deposit leaves 100000 outstanding, so a 20000 withdrawal still fits; raising it does not
	txs[1].PrincipalAmount, txs[1].Amount = 150000, 150000
	if err := replayLive(inv, 100000, day(0), txs[1:], day(90)); err == nil {
		t.Fatal("expected a withdrawal larger than the principal to be refused")
	}
}

func TestReplayLive_RefusesEntryBeforeStart(t *testing.T) {
	inv := liveInv(12)
	txs := sampleTxs()
	if err := replayLive(inv, 100000, day(45), txs, day(90)); err == nil {
		t.Fatal("expected an entry dated before the start to be refused")
	}
}

func TestReplayLive_DeletingDepositChangesLaterPrincipal(t *testing.T) {
	inv := liveInv(12)
	txs := sampleTxs()[1:]
	if err := replayLive(inv, 100000, day(0), txs, day(90)); err != nil {
		t.Fatal(err)
	}
	approxEqual(t, txs[0].PrincipalBefore, 100000, "withdrawal before")
	approxEqual(t, inv.OutstandingPrincipal, 80000, "outstanding")
}

func TestCheckPrincipalChain_DetectsBrokenHistory(t *testing.T) {
	inv := liveInv(12)
	txs := sampleTxs()
	if err := replayLive(inv, 100000, day(0), txs, day(90)); err != nil {
		t.Fatal(err)
	}
	txs[1].PrincipalBefore = 140000
	if checkPrincipalChain(100000, txs, inv) == "" {
		t.Fatal("expected a broken chain to be reported")
	}
	txs[1].PrincipalBefore = 150000
	inv.OutstandingPrincipal = 1
	if checkPrincipalChain(100000, txs, inv) == "" {
		t.Fatal("expected a mismatching current principal to be reported")
	}
}

func TestResolveSplit(t *testing.T) {
	old := [4]float64{100, 50, 0, 0}
	if got := resolveSplit(old, [4]*float64{}); got != old {
		t.Fatalf("no input should keep the saved split, got %v", got)
	}
	c := 75.0
	got := resolveSplit(old, [4]*float64{&c, nil, nil, nil})
	if got != [4]float64{75, 0, 0, 0} {
		t.Fatalf("sent split should replace the saved one, got %v", got)
	}
}

func TestKeepTimeIfSameDay(t *testing.T) {
	old := time.Date(2026, 1, 5, 14, 30, 0, 0, time.UTC)
	if got := keepTimeIfSameDay(old, time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)); !got.Equal(old) {
		t.Fatal("same day should keep the saved timestamp")
	}
	nd := time.Date(2026, 1, 6, 0, 0, 0, 0, time.UTC)
	if got := keepTimeIfSameDay(old, nd); !got.Equal(nd) {
		t.Fatal("a different day should use the edited date")
	}
}

func TestParseEntryID(t *testing.T) {
	cases := []struct {
		in   string
		kind string
		id   uint
		ok   bool
	}{{"tx-5", "tx", 5, true}, {"payout-12", "payout", 12, true}, {"open-7", "open", 7, true}, {"open-7-1", "open", 7, true}, {"x-1", "", 0, false}, {"tx-0", "", 0, false}, {"tx-a", "", 0, false}}
	for _, c := range cases {
		k, id, err := parseEntryID(c.in)
		if (err == nil) != c.ok || k != c.kind || id != c.id {
			t.Errorf("parseEntryID(%q) = %q,%d,%v", c.in, k, id, err)
		}
	}
}
