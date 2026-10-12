package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"testing"
	"time"
)

func ledgerTestDay(d string) time.Time {
	t, _ := time.Parse("2006-01-02", d)
	return t
}

func TestBuildLoanLedgerSplitsBalancesAndOrder(t *testing.T) {
	disbursed := ledgerTestDay("2026-10-02")
	l := &models.Loan{SanctionedAmount: 100000, DisbursedAmount: 100000, DisbursementDate: &disbursed}
	payments := []models.LoanPayment{
		{ID: 1, Type: models.PaymentTypeDisbursement, Amount: 100000, PaidOn: disbursed, CashAmount: 50000, UpiAmount: 50000},
		{ID: 2, Type: models.PaymentTypeInterest, Amount: 10000, PaidOn: ledgerTestDay("2026-10-05"), CashAmount: 10000, RunningBalance: 90000},
	}
	topUps := []models.LoanTopUp{
		{ID: 7, Amount: 20000, Status: models.TopUpStatusActive, OccurredOn: ledgerTestDay("2026-10-04"), CashAmount: 5000, UpiAmount: 15000},
		{ID: 8, Amount: 999, Status: models.TopUpStatusPending, OccurredOn: ledgerTestDay("2026-10-04"), CashAmount: 999},
	}
	got := buildLoanLedger(l, payments, topUps, nil, nil)
	want := []struct {
		key     string
		date    string
		amount  float64
		balance float64
	}{
		{"sanction-Cash", "2026-10-02", 50000, 50000},
		{"sanction-UPI", "2026-10-02", 50000, 100000},
		{"topup-7-Cash", "2026-10-04", 5000, 105000},
		{"topup-7-UPI", "2026-10-04", 15000, 120000},
		{"payment-2", "2026-10-05", 10000, 90000},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d rows, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		g := got[i]
		if g.Key != w.key || g.Date != w.date || g.Amount != w.amount || g.Balance == nil || *g.Balance != w.balance {
			t.Errorf("row %d = {%s %s %v %v}, want %+v", i, g.Key, g.Date, g.Amount, g.Balance, w)
		}
	}
}

func TestBuildLoanLedgerAuctionRows(t *testing.T) {
	disbursed := ledgerTestDay("2026-01-01")
	l := &models.Loan{SanctionedAmount: 50000, DisbursedAmount: 50000, DisbursementDate: &disbursed}
	sold := ledgerTestDay("2026-06-01")
	payments := []models.LoanPayment{{ID: 3, Type: models.PaymentTypeAuctionSale, Amount: 40000, PaidOn: sold, Reference: "AUC-1", RunningBalance: 0}}
	auctions := []models.AuctionRecord{{ID: 9, AuctionReferenceNumber: "AUC-1", SaleAmount: 45000, SurplusPayableAmount: 5000, AuctionEligibleDate: sold}}
	got := buildLoanLedger(l, payments, nil, auctions, nil)
	if len(got) != 3 {
		t.Fatalf("got %d rows, want sanction + sale payment + surplus: %+v", len(got), got)
	}
	if got[1].Kind != "payment" || got[1].Auction == nil || got[1].Auction.ID != 9 {
		t.Errorf("auction sale payment not linked to its case: %+v", got[1])
	}
	if got[2].Kind != "auction-surplus" || got[2].Balance != nil || got[2].Amount != 5000 {
		t.Errorf("surplus row = %+v", got[2])
	}
}

func TestLedgerFocusIndex(t *testing.T) {
	rows := []LoanLedgerEntry{{Key: "sanction", Date: "2026-01-01", Amount: 100}, {Key: "payment-4", Date: "2026-02-01", Amount: 25}, {Key: "payment-5", Date: "2026-03-01", Amount: 25}}
	amount := 25.0
	if i := ledgerFocusIndex(rows, LoanLedgerQuery{FocusKey: "payment-5"}); i != 2 {
		t.Errorf("by key = %d, want 2", i)
	}
	if i := ledgerFocusIndex(rows, LoanLedgerQuery{FocusDate: "2026-03-01", FocusAmount: &amount}); i != 2 {
		t.Errorf("by date+amount = %d, want 2", i)
	}
	if i := ledgerFocusIndex(rows, LoanLedgerQuery{FocusDate: "2027-01-01", FocusAmount: &amount}); i != 1 {
		t.Errorf("by amount fallback = %d, want 1", i)
	}
	if i := ledgerFocusIndex(rows, LoanLedgerQuery{FocusKey: "missing"}); i != -1 {
		t.Errorf("missing key = %d, want -1", i)
	}
}

func TestBuildLoanLedgerTopUpThenSettledInterest(t *testing.T) {
	disbursed := ledgerTestDay("2026-10-01")
	topAt := disbursed.AddDate(0, 0, 3).Add(10 * time.Hour)
	l := &models.Loan{SanctionedAmount: 100000, DisbursedAmount: 100000, DisbursementDate: &disbursed}
	payments := []models.LoanPayment{
		{ID: 1, Type: models.PaymentTypeDisbursement, Amount: 100000, PaidOn: disbursed, CashAmount: 100000, RunningBalance: 100000},
		{ID: 2, Type: models.PaymentTypeInterest, Amount: 500, PaidOn: topAt.Add(time.Millisecond), CashAmount: 500, RunningBalance: 120000},
	}
	topUps := []models.LoanTopUp{{ID: 7, Amount: 20000, Status: models.TopUpStatusActive, OccurredOn: topAt, CashAmount: 20000}}
	got := buildLoanLedger(l, payments, topUps, nil, nil)
	keys := []string{"sanction", "topup-7", "payment-2"}
	if len(got) != len(keys) {
		t.Fatalf("got %d rows, want %d: %+v", len(got), len(keys), got)
	}
	for i, k := range keys {
		if got[i].Key != k {
			t.Errorf("row %d key = %s, want %s", i, got[i].Key, k)
		}
	}
}

func TestBuildLoanLedgerKeepsOriginalDisbursementAfterEdit(t *testing.T) {
	first := ledgerTestDay("2026-10-01")
	l := &models.Loan{}
	payments := []models.LoanPayment{
		{ID: 1, Type: models.PaymentTypeDisbursement, Amount: 100000, PaidOn: first, CashAmount: 60000, UpiAmount: 40000, RunningBalance: 100000},
		{ID: 2, Type: "Disbursement Reversal", Amount: 100000, PaidOn: first.AddDate(0, 0, 1), CashAmount: 60000, UpiAmount: 40000},
	}
	got := buildLoanLedger(l, payments, nil, nil, nil)
	keys := []string{"sanction-Cash", "sanction-UPI", "payment-2-Cash", "payment-2-UPI"}
	if len(got) != len(keys) {
		t.Fatalf("got %d rows, want %d: %+v", len(got), len(keys), got)
	}
	for i, k := range keys {
		if got[i].Key != k {
			t.Errorf("row %d key = %s, want %s", i, got[i].Key, k)
		}
	}
	if got[0].Amount != 60000 || got[0].Date != "2026-10-01" {
		t.Errorf("original payout row = %+v", got[0])
	}
	again := first.AddDate(0, 0, 2)
	l2 := &models.Loan{SanctionedAmount: 80000, DisbursedAmount: 80000, DisbursementDate: &again}
	payments = append(payments, models.LoanPayment{ID: 3, Type: models.PaymentTypeDisbursement, Amount: 80000, PaidOn: again, CashAmount: 80000, RunningBalance: 80000})
	got = buildLoanLedger(l2, payments, nil, nil, nil)
	keys = []string{"sanction-Cash", "sanction-UPI", "payment-2-Cash", "payment-2-UPI", "sanction-3"}
	if len(got) != len(keys) {
		t.Fatalf("got %d rows, want %d: %+v", len(got), len(keys), got)
	}
	for i, k := range keys {
		if got[i].Key != k {
			t.Errorf("resanction row %d key = %s, want %s", i, got[i].Key, k)
		}
	}
}

func TestScaleSplit(t *testing.T) {
	c, u, b, ch := scaleSplit(60000, 40000, 0, 0, 100000, 90000)
	if c != 54000 || u != 36000 || b != 0 || ch != 0 {
		t.Errorf("scaled = %v %v %v %v", c, u, b, ch)
	}
}

func TestBuildLoanLedgerSplitsAuctionProceedsByComponent(t *testing.T) {
	disbursed := ledgerTestDay("2026-10-02")
	l := &models.Loan{SanctionedAmount: 100000, DisbursedAmount: 100000, DisbursementDate: &disbursed}
	payments := []models.LoanPayment{
		{ID: 1, Type: models.PaymentTypeDisbursement, Amount: 100000, PaidOn: disbursed, CashAmount: 100000},
		{
			ID: 2, Type: models.PaymentTypeAuctionSale, Amount: 105000, PaidOn: ledgerTestDay("2026-10-20"), Method: "Auction",
			ProcessingFeeApplied: 1000, PenalInterestApplied: 500, InterestApplied: 3500, PrincipalApplied: 100000, RunningBalance: 0,
		},
	}
	got := buildLoanLedger(l, payments, nil, nil, nil)
	var rows []LoanLedgerEntry
	for _, e := range got {
		if e.Kind == "payment" {
			rows = append(rows, e)
		}
	}
	want := []struct {
		component string
		amount    float64
		balance   float64
	}{{"Service Charge", 1000, 104000}, {"Penal Interest", 500, 103500}, {"Interest", 3500, 100000}, {"Principal", 100000, 0}}
	if len(rows) != len(want) {
		t.Fatalf("got %d payment rows, want %d: %+v", len(rows), len(want), rows)
	}
	var credit float64
	for i, w := range want {
		r := rows[i]
		if r.Component != w.component || r.Amount != w.amount || r.Balance == nil || *r.Balance != w.balance {
			t.Errorf("row %d = %s %.2f bal %v, want %s %.2f bal %.2f", i, r.Component, r.Amount, r.Balance, w.component, w.amount, w.balance)
		}
		credit += r.Amount
	}
	if _, totalCredit := ledgerColumnTotals(rows); totalCredit != credit || credit != 105000 {
		t.Errorf("credit total = %.2f, want 105000", credit)
	}
}

func TestBuildLoanLedgerAuctionRowsKeepTheSalesModes(t *testing.T) {
	disbursed := ledgerTestDay("2026-10-02")
	l := &models.Loan{SanctionedAmount: 100000, DisbursedAmount: 100000, DisbursementDate: &disbursed}
	payments := []models.LoanPayment{
		{ID: 1, Type: models.PaymentTypeDisbursement, Amount: 100000, PaidOn: disbursed, CashAmount: 100000},
		{
			ID: 2, Type: models.PaymentTypeAuctionSale, Amount: 105000, PaidOn: ledgerTestDay("2026-10-20"),
			CashAmount: 3000, UpiAmount: 102000,
			ProcessingFeeApplied: 1000, PenalInterestApplied: 500, InterestApplied: 3500, PrincipalApplied: 100000,
		},
	}
	var got []struct {
		component, mode string
		amount          float64
	}
	for _, e := range buildLoanLedger(l, payments, nil, nil, nil) {
		if e.Kind == "payment" {
			got = append(got, struct {
				component, mode string
				amount          float64
			}{e.Component, e.Mode, e.Amount})
		}
	}
	want := []struct {
		component, mode string
		amount          float64
	}{{"Service Charge", "Cash", 1000}, {"Penal Interest", "Cash", 500}, {"Interest", "Cash", 1500}, {"Interest", "UPI", 2000}, {"Principal", "UPI", 100000}}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
