package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"testing"
)

func TestRateForPurity_ExactKaratReadsStoredColumnDirectly(t *testing.T) {
	gr := &commonModels.GoldRate{K24: 7000, K22: 6850, K18: 5000} // 6850 deliberately does NOT equal 7000*22/24 (~6417)
	got, err := rateForPurity(gr, "22K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 6850 {
		t.Fatalf("22K must read the independently-published K22 column, got %.2f, want 6850", got)
	}
	got, err = rateForPurity(gr, "18K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 5000 {
		t.Fatalf("18K must read the independently-published K18 column, got %.2f, want 5000", got)
	}
	got, err = rateForPurity(gr, "24K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 7000 {
		t.Fatalf("24K must read K24 directly, got %.2f, want 7000", got)
	}
}

func TestRateForPurity_FallsBackToDerivedWhenKaratColumnIsZero(t *testing.T) {
	gr := &commonModels.GoldRate{K24: 7200, K22: 0, K18: 0}
	got, err := rateForPurity(gr, "22K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	nearly(t, got, 6600, "22K derived fallback")
	got, err = rateForPurity(gr, "18K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	nearly(t, got, 5400, "18K derived fallback")
}

func TestRateForPurity_NonStandardPurityAlwaysDerivesOffK24(t *testing.T) {
	gr := &commonModels.GoldRate{K24: 7200, K22: 6850, K18: 5000} // independently-published, must be ignored here
	got, err := rateForPurity(gr, "16K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	nearly(t, got, 4800, "16K derived")
	got, err = rateForPurity(gr, "91.6%")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	nearly(t, got, 6595, "91.6%% derived")
}
