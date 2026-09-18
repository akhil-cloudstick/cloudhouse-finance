package loan

import (
	"testing"

	"cloudhouse/backend/internal/scheme"
)

// A flat charge is used verbatim regardless of principal — the whole point
// of "flat" is that it does NOT scale with the loan size.
func TestComputeServiceChargeAmount_Flat(t *testing.T) {
	got := computeServiceChargeAmount(scheme.ServiceChargeTypeFlat, 500, 50_000)
	if got != 500 {
		t.Fatalf("flat charge should equal the configured value regardless of principal, got %.2f", got)
	}
	// Larger principal, same flat value — must not scale.
	got = computeServiceChargeAmount(scheme.ServiceChargeTypeFlat, 500, 200_000)
	if got != 500 {
		t.Fatalf("flat charge must not scale with principal, got %.2f", got)
	}
}

// A percentage charge scales with principal — this is the whole point of
// choosing "percent" over "flat" for a scheme.
func TestComputeServiceChargeAmount_Percent(t *testing.T) {
	got := computeServiceChargeAmount(scheme.ServiceChargeTypePercent, 2, 50_000)
	if got != 1_000 {
		t.Fatalf("2%% of 50000 should be 1000, got %.2f", got)
	}
	got = computeServiceChargeAmount(scheme.ServiceChargeTypePercent, 1.5, 100_000)
	if got != 1_500 {
		t.Fatalf("1.5%% of 100000 should be 1500, got %.2f", got)
	}
}

// A scheme with no charge configured (the default for every existing
// scheme predating this feature) must compute to exactly zero — no charge
// silently appears on loans opened under it.
func TestComputeServiceChargeAmount_None(t *testing.T) {
	if got := computeServiceChargeAmount(scheme.ServiceChargeTypeNone, 500, 50_000); got != 0 {
		t.Fatalf("None charge type must compute to zero regardless of Value, got %.2f", got)
	}
	// An unrecognized/empty type (e.g. a legacy row) must also default to
	// zero rather than being mistaken for one of the two real charge types.
	if got := computeServiceChargeAmount("", 500, 50_000); got != 0 {
		t.Fatalf("empty/unrecognized charge type must compute to zero, got %.2f", got)
	}
}
