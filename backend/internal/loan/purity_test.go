package loan

import (
	"testing"

	"ambikagold/backend/internal/goldrate"
)

// A 22K/18K ornament valuation must read whatever GoldRate.K22/K18
// actually store — including an independently-published (Manual mode)
// figure that does NOT match K24×ratio — while every other purity keeps
// deriving off K24 exactly as before. See purity.go's rateForPurity.
func TestRateForPurity_ExactKaratReadsStoredColumnDirectly(t *testing.T) {
	gr := &goldrate.GoldRate{K24: 7000, K22: 6850, K18: 5000} // 6850 deliberately does NOT equal 7000*22/24 (~6417)

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

// A row predating this feature (or one where 22K/18K have simply never
// been independently touched) has K22/K18 sitting at their zero default —
// that must never be quoted as a real rate; it has to fall back to the
// K24-derived figure instead.
func TestRateForPurity_FallsBackToDerivedWhenKaratColumnIsZero(t *testing.T) {
	gr := &goldrate.GoldRate{K24: 7200, K22: 0, K18: 0}

	got, err := rateForPurity(gr, "22K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	nearly(t, got, 6600, "22K derived fallback") // round(7200*22/24) = 6600

	got, err = rateForPurity(gr, "18K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	nearly(t, got, 5400, "18K derived fallback") // round(7200*18/24) = 5400
}

// Non-standard purities (16K, a custom fineness%) always derive off K24 —
// the exact-karat direct-read branch must never apply to anything other
// than literally 24K/22K/18K.
func TestRateForPurity_NonStandardPurityAlwaysDerivesOffK24(t *testing.T) {
	gr := &goldrate.GoldRate{K24: 7200, K22: 6850, K18: 5000} // independently-published, must be ignored here

	got, err := rateForPurity(gr, "16K")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	nearly(t, got, 4800, "16K derived") // round(7200*16/24) = 4800

	got, err = rateForPurity(gr, "91.6%")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	nearly(t, got, 6595, "91.6%% derived") // round(7200*0.916) = 6595
}
