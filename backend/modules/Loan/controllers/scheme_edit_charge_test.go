package controllers

import (
	"math"
	"testing"

	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
)

// editWithScheme runs the same steps disbursedLoanEdit's Prepare and editLoanDisbursement run for a scheme + amount
// edit: snapshot the new scheme, work the charge out on the new sanctioned amount, then compute the payout figures.
func editWithScheme(l *models.Loan, sch *commonModels.Scheme, sanctioned float64) (disbursementFigures, error) {
	applySchemeSnapshot(l, sch)
	l.ServiceChargeAmount = computeServiceChargeAmount(l.ServiceChargeType, l.ServiceChargeValue, sanctioned)
	in := &EditDisbursementInput{SanctionedAmount: &sanctioned}
	return computeDisbursementFigures(l, in, l.PrincipalAmount)
}

func nearMoney(a, b float64) bool { return math.Abs(a-b) < 0.005 }

func TestSchemeEdit_OldChargeDroppedWhenNewSchemeHasNone(t *testing.T) {
	l := &models.Loan{PrincipalAmount: 50000, ServiceChargeType: commonModels.ServiceChargeTypeFlat, ServiceChargeValue: 1000, ServiceChargeAmount: 1000}
	f, err := editWithScheme(l, &commonModels.Scheme{ServiceChargeType: commonModels.ServiceChargeTypeNone}, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if !nearMoney(f.ServiceCharge, 0) || !nearMoney(f.Disbursed, 60000) || !nearMoney(l.ServiceChargeAmount, 0) {
		t.Fatalf("got charge %v disbursed %v loan charge %v", f.ServiceCharge, f.Disbursed, l.ServiceChargeAmount)
	}
}

func TestSchemeEdit_NewSchemeChargeOnNewAmount(t *testing.T) {
	l := &models.Loan{PrincipalAmount: 50000, ServiceChargeType: commonModels.ServiceChargeTypeNone}
	sch := &commonModels.Scheme{ServiceChargeType: commonModels.ServiceChargeTypePercent, ServiceChargeValue: 2, ServiceChargeMode: commonModels.ServiceChargeModeWithheldFromPayout}
	f, err := editWithScheme(l, sch, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if !nearMoney(f.ServiceCharge, 1200) || !nearMoney(f.Disbursed, 58800) {
		t.Fatalf("got charge %v disbursed %v", f.ServiceCharge, f.Disbursed)
	}
}

func TestSchemeEdit_ChargeModeWithheldVsAddedToPrincipal(t *testing.T) {
	sch := func(mode string) *commonModels.Scheme {
		return &commonModels.Scheme{ServiceChargeType: commonModels.ServiceChargeTypeFlat, ServiceChargeValue: 500, ServiceChargeMode: mode}
	}
	// withheld: the principal is the sanctioned amount and the customer is paid 500 less
	l := &models.Loan{PrincipalAmount: 40000}
	f, err := editWithScheme(l, sch(commonModels.ServiceChargeModeWithheldFromPayout), 40000)
	if err != nil {
		t.Fatal(err)
	}
	if !nearMoney(f.Disbursed, 39500) || l.ServiceChargeMode != commonModels.ServiceChargeModeWithheldFromPayout {
		t.Fatalf("withheld: disbursed %v mode %v", f.Disbursed, l.ServiceChargeMode)
	}
	// added to principal: the customer's loan amount is the sanctioned less the charge, and it counts against the LTV cap
	l = &models.Loan{PrincipalAmount: 40000, EligibleLoanAmount: 39500}
	f, err = editWithScheme(l, sch(commonModels.ServiceChargeModeAddedToPrincipal), 40000)
	if err != nil {
		t.Fatal(err)
	}
	if l.ServiceChargeMode != commonModels.ServiceChargeModeAddedToPrincipal || !nearMoney(f.ServiceCharge, 500) {
		t.Fatalf("added: mode %v charge %v", l.ServiceChargeMode, f.ServiceCharge)
	}
	l.SchemeLTVPercent = 75
	if err := checkEligible(l, f); err != nil {
		t.Fatalf("40000 sanctioned with 500 added should fit eligible 39500: %v", err)
	}
}
