package controllers

import (
	"strings"
	"testing"
	"time"

	"cloudhouse/backend/modules/Loan/models"
)

func f64(v float64) *float64 { return &v }
func str(v string) *string   { return &v }

func activePledge() models.BankPledgeRecord {
	return models.BankPledgeRecord{
		BankName: "SBI", PledgedAmount: 1000, PledgeDate: time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC),
		CashTreatment: models.BankPledgeCashTreatmentCashIn, CashAmount: 1000, Status: models.BankPledgeStatusRecordActive,
	}
}

func releasedPledge() models.BankPledgeRecord {
	p := activePledge()
	d := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	p.Status, p.ReleaseDate = "Released", &d
	p.ReleaseCashAmount = 1000
	return p
}

func TestApplyBankPledgeEdit_AmountChangeNeedsBreakdownWhenMixed(t *testing.T) {
	p := activePledge()
	p.CashAmount, p.UpiAmount = 600, 400
	bank := uint(3)
	p.ReceivedBankID = &bank
	if _, err := applyBankPledgeEdit(p, EditBankPledgeInput{PledgedAmount: f64(1500)}, nil, nil); err == nil {
		t.Fatal("a mixed breakdown must be re-entered when the amount changes")
	}
	n, err := applyBankPledgeEdit(p, EditBankPledgeInput{PledgedAmount: f64(1500), CashAmount: f64(1000), UpiAmount: f64(500), ReceivedBankID: &bank}, nil, nil)
	if err != nil || n.CashAmount != 1000 || n.UpiAmount != 500 || n.ReceivedBankID == nil {
		t.Fatalf("got %+v err %v", n, err)
	}
}

func TestApplyBankPledgeEdit_AllCashFollowsAmount(t *testing.T) {
	n, err := applyBankPledgeEdit(activePledge(), EditBankPledgeInput{PledgedAmount: f64(2500)}, nil, nil)
	if err != nil || n.CashAmount != 2500 {
		t.Fatalf("got %+v err %v", n, err)
	}
}

func TestApplyBankPledgeEdit_RecordOnlyClearsSplitAndRelease(t *testing.T) {
	n, err := applyBankPledgeEdit(releasedPledge(), EditBankPledgeInput{CashTreatment: str(models.BankPledgeCashTreatmentRecordOnly)}, nil, nil)
	if err != nil || n.CashAmount != 0 || n.ReleaseCashAmount != 0 {
		t.Fatalf("got %+v err %v", n, err)
	}
}

func TestApplyBankPledgeEdit_Validation(t *testing.T) {
	cases := map[string]EditBankPledgeInput{
		"zero amount":    {PledgedAmount: f64(0)},
		"empty bank":     {BankName: str("  ")},
		"bad treatment":  {CashTreatment: str("Whatever")},
		"negative rate":  {BankInterestRate: f64(-1)},
		"split mismatch": {CashAmount: f64(10), UpiAmount: f64(5)},
	}
	for name, in := range cases {
		if _, err := applyBankPledgeEdit(activePledge(), in, nil, nil); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestApplyBankPledgeEdit_VoidedRefused(t *testing.T) {
	p := activePledge()
	p.Status = "Voided"
	if _, err := applyBankPledgeEdit(p, EditBankPledgeInput{}, nil, nil); err == nil {
		t.Fatal("a voided pledge cannot be edited")
	}
}

func TestApplyBankPledgeEdit_ReleaseDateNotBeforePledge(t *testing.T) {
	early := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, err := applyBankPledgeEdit(releasedPledge(), EditBankPledgeInput{ReleaseDate: &early}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "release date") {
		t.Fatalf("got %v", err)
	}
}

func TestApplyBankPledgeEdit_LegacyReleaseSplitFromLedger(t *testing.T) {
	p := releasedPledge()
	p.ReleaseCashAmount = 0
	bank := uint(9)
	n, err := applyBankPledgeEdit(p, EditBankPledgeInput{}, &[4]float64{400, 600, 0, 0}, &bank)
	if err != nil || n.ReleaseCashAmount != 400 || n.ReleaseUpiAmount != 600 || n.ReleaseBankID == nil {
		t.Fatalf("got %+v err %v", n, err)
	}
}

func TestApplyBankPledgeEdit_SwitchToCashInOnReleased(t *testing.T) {
	p := releasedPledge()
	p.CashTreatment, p.CashAmount, p.ReleaseCashAmount = models.BankPledgeCashTreatmentRecordOnly, 0, 0
	n, err := applyBankPledgeEdit(p, EditBankPledgeInput{CashTreatment: str(models.BankPledgeCashTreatmentCashIn)}, nil, nil)
	if err != nil || n.CashAmount != 1000 || n.ReleaseCashAmount != 1000 {
		t.Fatalf("got %+v err %v", n, err)
	}
}

func TestBankPledgeLoanStatus(t *testing.T) {
	if bankPledgeLoanStatus(1, 1) != models.BankPledgeStatusPledged || bankPledgeLoanStatus(0, 2) != "Released" || bankPledgeLoanStatus(0, 0) != "Not Pledged" {
		t.Fatal("unexpected status")
	}
}
