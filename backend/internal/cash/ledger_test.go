package cash

import "testing"

func TestExpandSplitPayment(t *testing.T) {
	bank := uint(3)
	base := ledgerSourceRow{Kind: "loan_payment", ID: 9, Method: "Split", Amount: 1000, RunningBalance: 4000, BankID: &bank, BankName: "SBI"}

	rows := expandSplitPayment(base, splitParts{Cash: 600, Upi: 400})
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	if rows[0].Method != "Cash" || rows[0].Amount != 600 || rows[0].RunningBalance != 4400 || rows[0].BankID != nil {
		t.Errorf("cash part = %+v", rows[0])
	}
	if rows[1].Method != "UPI" || rows[1].Amount != 400 || rows[1].RunningBalance != 4000 || rows[1].BankID == nil {
		t.Errorf("upi part = %+v", rows[1])
	}

	if got := onlyMode(expandSplitPayment(base, splitParts{Cash: 600, Upi: 400}), "UPI"); len(got) != 1 || got[0].Amount != 400 {
		t.Errorf("onlyMode(UPI) = %+v", got)
	}
	if got := withoutCashParts(expandSplitPayment(base, splitParts{Cash: 600, Upi: 400})); len(got) != 1 || got[0].Method != "UPI" {
		t.Errorf("withoutCashParts = %+v", got)
	}

	single := base
	single.Method = "Cash"
	if got := expandSplitPayment(single, splitParts{Cash: 1000}); len(got) != 1 || got[0].Amount != 1000 || got[0].BankID == nil {
		t.Errorf("single-mode payment changed: %+v", got)
	}
}
