package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
	"testing"
	"time"
)

func schemeMonthlySimple() commonModels.Scheme {
	return commonModels.Scheme{
		InterestRate:   24,
		PenalRate:      12,
		InterestMethod: "Monthly simple interest",
	}
}

func loanOwing(principal, accruedInterest, accruedPenal, fee float64) *models.Loan {
	return &models.Loan{
		OutstandingAmount:        principal,
		AccruedInterest:          accruedInterest,
		AccruedPenalInterest:     accruedPenal,
		OutstandingProcessingFee: fee,
	}
}

func TestAllocatePayment_AuctionSaleAllowsOvershootWithoutError(t *testing.T) {
	l := loanOwing(50_000, 4_000, 1_000, 500)
	totalOwed := 55_500.0
	fee, penal, interest, principal, err := allocatePayment(l, models.PaymentTypeAuctionSale, 80_000, nil)
	if err != nil {
		t.Fatalf("overshooting auction proceeds must not error, got %v", err)
	}
	if got := fee + penal + interest + principal; got != totalOwed {
		t.Fatalf("allocation should cap at the %.2f owed, allocated %.2f", totalOwed, got)
	}
	if fee != 500 || penal != 1_000 || interest != 4_000 || principal != 50_000 {
		t.Fatalf("expected every bucket cleared exactly, got fee=%.2f penal=%.2f interest=%.2f principal=%.2f",
			fee, penal, interest, principal)
	}
}

func TestAllocatePayment_AuctionSaleFollowsWaterfallOnShortfall(t *testing.T) {
	l := loanOwing(50_000, 4_000, 1_000, 500)
	fee, penal, interest, principal, err := allocatePayment(l, models.PaymentTypeAuctionSale, 6_000, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fee != 500 || penal != 1_000 || interest != 4_000 {
		t.Fatalf("fee/penal/interest should be cleared first, got fee=%.2f penal=%.2f interest=%.2f", fee, penal, interest)
	}
	if principal != 500 {
		t.Fatalf("only the remaining 500 should reach principal, got %.2f", principal)
	}
	if remaining := l.OutstandingAmount - principal; remaining != 49_500 {
		t.Fatalf("expected 49500 still owed after a partial recovery, got %.2f", remaining)
	}
}

func TestAllocatePayment_AuctionWriteOffReachesPrincipalUnlikeWaiver(t *testing.T) {
	owed := 20_000.0
	_, _, _, waiverPrincipal, err := allocatePayment(loanOwing(owed, 0, 0, 0), models.PaymentTypeWaiver, owed, nil)
	if err == nil && waiverPrincipal != 0 {
		t.Fatalf("Waiver must never touch principal, it allocated %.2f", waiverPrincipal)
	}
	_, _, _, principal, err := allocatePayment(loanOwing(owed, 0, 0, 0), models.PaymentTypeAuctionWriteOff, owed, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if principal != owed {
		t.Fatalf("write-off should clear the full %.2f principal, cleared %.2f", owed, principal)
	}
}

func TestAllocatePayment_AuctionWriteOffCannotOvershoot(t *testing.T) {
	fee, penal, interest, principal, err := allocatePayment(loanOwing(1_000, 0, 0, 0), models.PaymentTypeAuctionWriteOff, 99_999, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if total := fee + penal + interest + principal; total != 1_000 {
		t.Fatalf("write-off should cap at the 1000 owed, allocated %.2f", total)
	}
}

func TestIsCashPaymentType_ExcludesAuctionTypes(t *testing.T) {
	for _, tp := range []string{models.PaymentTypeAuctionSale, models.PaymentTypeAuctionWriteOff} {
		if isCashPaymentType(tp) {
			t.Errorf("%q must not be cash-bearing — RecordAuctionSale books its cash movement directly", tp)
		}
	}
	for _, tp := range []string{models.PaymentTypeInterest, models.PaymentTypePrincipal, models.PaymentTypePartial, models.PaymentTypeFullSettlement} {
		if !isCashPaymentType(tp) {
			t.Errorf("%q should still be cash-bearing", tp)
		}
	}
}

func TestIsActiveAuctionStage(t *testing.T) {
	active := []string{models.AuctionStageEligible, models.AuctionStageNotice, models.AuctionStageScheduled, models.AuctionStageAuctioned}
	for _, st := range active {
		if !IsActiveAuctionStage(st) {
			t.Errorf("%q should count as active", st)
		}
	}
	for _, st := range []string{models.AuctionStageSettled, models.AuctionStageWithdrawn} {
		if IsActiveAuctionStage(st) {
			t.Errorf("%q is terminal and must not count as active", st)
		}
	}
}

func TestIsPreSaleAuctionStage_ExcludesPostSaleStages(t *testing.T) {
	preSale := []string{models.AuctionStageEligible, models.AuctionStageNotice, models.AuctionStageScheduled}
	for _, st := range preSale {
		if !IsPreSaleAuctionStage(st) {
			t.Errorf("%q is before the sale — a payment should still be able to withdraw the case", st)
		}
	}
	postSale := []string{models.AuctionStageAuctioned, models.AuctionStageSettled, models.AuctionStageWithdrawn}
	for _, st := range postSale {
		if IsPreSaleAuctionStage(st) {
			t.Errorf("%q is at or past the sale — a payment must not withdraw this case (it would orphan an undisposed surplus)", st)
		}
	}
}

func TestNormalStatusFor(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		due  time.Time
		want string
	}{
		{"overdue", now.AddDate(0, 0, -120), models.StatusOverdue},
		{"due tomorrow", now.AddDate(0, 0, 1), models.StatusDueSoon},
		{"due inside the due-soon window", now.AddDate(0, 0, dueSoonWindowDays), models.StatusDueSoon},
		{"comfortably in future", now.AddDate(0, 2, 0), models.StatusActive},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalStatusFor(&models.Loan{DueDate: tc.due}, now); got != tc.want {
				t.Fatalf("due %s: expected %q, got %q", tc.due.Format("2006-01-02"), tc.want, got)
			}
		})
	}
}

func TestProjectAccrual_FreezesBalanceDueAndAccruesAfterPursueDecision(t *testing.T) {
	sch := schemeMonthlySimple()
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	asOf := from.AddDate(0, 3, 0)
	frozen := &models.Loan{
		Status:               models.StatusAuctionedBalanceDue,
		OutstandingAmount:    20_000,
		LastAccrualDate:      from,
		DueDate:              from,
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}
	if i, p, _ := projectAccrual(frozen, asOf, nil); i != 0 || p != 0 {
		t.Fatalf("a pending shortfall must not accrue, got interest=%.2f penal=%.2f", i, p)
	}
	pursued := *frozen
	pursued.Status = models.StatusOverdue
	i, p, _ := projectAccrual(&pursued, asOf, nil)
	if i <= 0 {
		t.Fatalf("a pursued balance should accrue interest once Overdue, got %.2f", i)
	}
	if p <= 0 {
		t.Fatalf("a pursued balance past its due date should accrue penal interest, got %.2f", p)
	}
}

func TestRoundMoney(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{0.1 + 0.2, 0.30},
		{1234.5678, 1234.57},
		{1234.5641, 1234.56},
		{-45.678, -45.68},
		{0, 0},
	}
	for _, tc := range cases {
		if got := common.RoundMoney(tc.in); got != tc.want {
			t.Errorf("RoundMoney(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
	if common.RoundMoney(0.1+0.2) != 0.3 {
		t.Error("0.1+0.2 must round to exactly 0.3")
	}
}

func TestIsUniqueViolation(t *testing.T) {
	violations := []error{
		errString(`ERROR: duplicate key value violates unique constraint "idx_single_active_auction_per_loan"`),
		errString("UNIQUE constraint failed: auction_records.loan_id"),
	}
	for _, err := range violations {
		if !isUniqueViolation(err) {
			t.Errorf("should be recognised as a unique violation: %v", err)
		}
	}
	if isUniqueViolation(nil) {
		t.Error("nil is not a violation")
	}
	if isUniqueViolation(errString("connection refused")) {
		t.Error("an unrelated error must not be mistaken for a unique violation")
	}
}

type errString string

func (e errString) Error() string { return string(e) }
