package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"testing"
)

func multipleInput(tiers ...commonModels.RateTier) SchemeCreateInput {
	return SchemeCreateInput{InterestMethod: commonModels.InterestMethodMultiple, RateTiers: tiers, DurationMonths: 12, LTVPercent: 75}
}

func TestValidateTiers(t *testing.T) {
	cases := []struct {
		name  string
		in    SchemeCreateInput
		valid bool
	}{
		{"single-rate method skips tiers", SchemeCreateInput{InterestMethod: "Monthly simple interest"}, true},
		{"valid ladder", multipleInput(commonModels.RateTier{Days: 90, Rate: 12}, commonModels.RateTier{Days: 60, Rate: 18}, commonModels.RateTier{Rate: 24}), true},
		{"one row", multipleInput(commonModels.RateTier{Rate: 12}), false},
		{"zero rate", multipleInput(commonModels.RateTier{Days: 90, Rate: 0}, commonModels.RateTier{Rate: 18}), false},
		{"zero days on non-last row", multipleInput(commonModels.RateTier{Days: 0, Rate: 12}, commonModels.RateTier{Rate: 18}), false},
		{"last row days ignored", multipleInput(commonModels.RateTier{Days: 90, Rate: 12}, commonModels.RateTier{Days: 0, Rate: 18}), true},
	}
	for _, c := range cases {
		if err := validateTiers(c.in); (err == nil) != c.valid {
			t.Errorf("%s: valid=%v, got err=%v", c.name, c.valid, err)
		}
	}
	neg := multipleInput(commonModels.RateTier{Days: 90, Rate: 12}, commonModels.RateTier{Rate: 18})
	neg.MinimumDays = -1
	if validateTiers(neg) == nil {
		t.Error("negative minimum days should be rejected")
	}
}

func TestNormalizeTiers(t *testing.T) {
	in := multipleInput(commonModels.RateTier{Days: 90, Rate: 12}, commonModels.RateTier{Days: 45, Rate: 24})
	normalizeTiers(&in)
	if in.RateTiers[1].Days != 0 {
		t.Errorf("last row days should be stored as 0, got %d", in.RateTiers[1].Days)
	}
	if in.InterestRate != 12 {
		t.Errorf("scheme rate should be the first tier's rate, got %v", in.InterestRate)
	}

	other := SchemeCreateInput{InterestMethod: "Flat monthly", RateTiers: []commonModels.RateTier{{Days: 1, Rate: 1}}, MinimumDays: 30}
	normalizeTiers(&other)
	if other.RateTiers != nil || other.MinimumDays != 0 {
		t.Error("tiers and minimum days should be cleared for single-rate methods")
	}
}

func TestSchemeValidateRequiresRateForSingleRate(t *testing.T) {
	in := SchemeCreateInput{InterestMethod: "Monthly simple interest", DurationMonths: 12, LTVPercent: 75}
	if schemeValidate(in) == nil {
		t.Error("a single-rate scheme without a rate should be rejected")
	}
	in.InterestRate = 12
	if err := schemeValidate(in); err != nil {
		t.Errorf("valid single-rate scheme rejected: %v", err)
	}
}
