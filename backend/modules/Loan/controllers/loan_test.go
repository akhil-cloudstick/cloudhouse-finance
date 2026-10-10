package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"testing"
)

func TestComputeServiceChargeAmount_Flat(t *testing.T) {
	got := computeServiceChargeAmount(commonModels.ServiceChargeTypeFlat, 500, 50_000)
	if got != 500 {
		t.Fatalf("flat charge should equal the configured value regardless of principal, got %.2f", got)
	}
	// Larger principal, same flat value — must not scale.
	got = computeServiceChargeAmount(commonModels.ServiceChargeTypeFlat, 500, 200_000)
	if got != 500 {
		t.Fatalf("flat charge must not scale with principal, got %.2f", got)
	}
}

func TestComputeServiceChargeAmount_Percent(t *testing.T) {
	got := computeServiceChargeAmount(commonModels.ServiceChargeTypePercent, 2, 50_000)
	if got != 1_000 {
		t.Fatalf("2%% of 50000 should be 1000, got %.2f", got)
	}
	got = computeServiceChargeAmount(commonModels.ServiceChargeTypePercent, 1.5, 100_000)
	if got != 1_500 {
		t.Fatalf("1.5%% of 100000 should be 1500, got %.2f", got)
	}
}

func TestComputeServiceChargeAmount_None(t *testing.T) {
	if got := computeServiceChargeAmount(commonModels.ServiceChargeTypeNone, 500, 50_000); got != 0 {
		t.Fatalf("None charge type must compute to zero regardless of Value, got %.2f", got)
	}
	if got := computeServiceChargeAmount("", 500, 50_000); got != 0 {
		t.Fatalf("empty/unrecognized charge type must compute to zero, got %.2f", got)
	}
}
