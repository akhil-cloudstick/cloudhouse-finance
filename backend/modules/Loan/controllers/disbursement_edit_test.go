package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
	"testing"
)

func TestComputeDisbursementFigures(t *testing.T) {
	flat := &models.Loan{ServiceChargeType: commonModels.ServiceChargeTypeFlat, ServiceChargeValue: 500, ServiceChargeAmount: 500}
	amt := 20000.0
	f, err := computeDisbursementFigures(flat, &EditDisbursementInput{SanctionedAmount: &amt}, 10000)
	if err != nil || f.Sanctioned != 20000 || f.ServiceCharge != 500 || f.Disbursed != 19500 {
		t.Fatalf("flat: %+v %v", f, err)
	}
	pct := &models.Loan{ServiceChargeType: commonModels.ServiceChargeTypePercent, ServiceChargeValue: 1, ServiceChargeAmount: 100}
	f, err = computeDisbursementFigures(pct, &EditDisbursementInput{SanctionedAmount: &amt}, 10000)
	if err != nil || f.ServiceCharge != 200 || f.Disbursed != 19800 {
		t.Fatalf("percent follows amount: %+v %v", f, err)
	}
	chg := 300.0
	f, _ = computeDisbursementFigures(pct, &EditDisbursementInput{ServiceCharge: &chg}, 10000)
	if f.ServiceCharge != 300 || f.Disbursed != 9700 {
		t.Fatalf("override: %+v", f)
	}
	big := 10000.0
	if _, err := computeDisbursementFigures(flat, &EditDisbursementInput{ServiceCharge: &big}, 10000); err == nil {
		t.Fatal("charge equal to amount must be refused")
	}
}

func TestCheckEligible(t *testing.T) {
	l := &models.Loan{EligibleLoanAmount: 10000}
	if err := checkEligible(l, disbursementFigures{Sanctioned: 10000}); err != nil {
		t.Fatal(err)
	}
	if err := checkEligible(l, disbursementFigures{Sanctioned: 10100}); err == nil {
		t.Fatal("over eligible must be refused")
	}
	l.ServiceChargeMode = commonModels.ServiceChargeModeAddedToPrincipal
	if err := checkEligible(l, disbursementFigures{Sanctioned: 10500, ServiceCharge: 500}); err != nil {
		t.Fatal(err)
	}
}
