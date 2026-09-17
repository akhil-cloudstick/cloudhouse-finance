package loan

import (
	"testing"
	"time"

	"cloudhouse/backend/internal/authz"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/scheme"
)

// schemeMonthlySimple is a plain monthly-simple-interest scheme with a penal
// rate, so accrual tests exercise both interest and penal interest.
func schemeMonthlySimple() scheme.Scheme {
	return scheme.Scheme{
		InterestRate:   24,
		PenalRate:      12,
		InterestMethod: "Monthly simple interest",
	}
}

// loanOwing builds a loan owing exactly the given amounts in each bucket, so
// allocation tests can state the starting position in one line.
func loanOwing(principal, accruedInterest, accruedPenal, fee float64) *Loan {
	return &Loan{
		OutstandingAmount:        principal,
		AccruedInterest:          accruedInterest,
		AccruedPenalInterest:     accruedPenal,
		OutstandingProcessingFee: fee,
	}
}

// An auction can fetch more than the debt — the gold is worth what it is worth,
// not what is owed. The allocation must cap each bucket and simply leave the
// excess unallocated for RecordAuctionSale to book as the customer's surplus.
// Rejecting it as "exceeds outstanding" (as Partial would) would make a
// profitable auction impossible to record.
func TestAllocatePayment_AuctionSaleAllowsOvershootWithoutError(t *testing.T) {
	l := loanOwing(50_000, 4_000, 1_000, 500)
	totalOwed := 55_500.0

	fee, penal, interest, principal, err := allocatePayment(l, PaymentTypeAuctionSale, 80_000, nil)
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

// The waterfall order is what makes a shortfall figure trustworthy: charges and
// penalties must be cleared before principal, or a partial recovery would look
// like it reduced the debt more than it did.
func TestAllocatePayment_AuctionSaleFollowsWaterfallOnShortfall(t *testing.T) {
	l := loanOwing(50_000, 4_000, 1_000, 500)

	fee, penal, interest, principal, err := allocatePayment(l, PaymentTypeAuctionSale, 6_000, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fee != 500 || penal != 1_000 || interest != 4_000 {
		t.Fatalf("fee/penal/interest should be cleared first, got fee=%.2f penal=%.2f interest=%.2f", fee, penal, interest)
	}
	if principal != 500 {
		t.Fatalf("only the remaining 500 should reach principal, got %.2f", principal)
	}
	// The loan must still owe the untouched principal — this is the shortfall
	// that gets escalated rather than silently written off.
	if remaining := l.OutstandingAmount - principal; remaining != 49_500 {
		t.Fatalf("expected 49500 still owed after a partial recovery, got %.2f", remaining)
	}
}

// A write-off must be able to reach principal. Waiver deliberately cannot —
// it only forgives interest — so reusing Waiver here would leave the principal
// of an already-auctioned loan stuck on the books forever.
func TestAllocatePayment_AuctionWriteOffReachesPrincipalUnlikeWaiver(t *testing.T) {
	owed := 20_000.0

	_, _, _, waiverPrincipal, err := allocatePayment(loanOwing(owed, 0, 0, 0), PaymentTypeWaiver, owed, nil)
	if err == nil && waiverPrincipal != 0 {
		t.Fatalf("Waiver must never touch principal, it allocated %.2f", waiverPrincipal)
	}

	_, _, _, principal, err := allocatePayment(loanOwing(owed, 0, 0, 0), PaymentTypeAuctionWriteOff, owed, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if principal != owed {
		t.Fatalf("write-off should clear the full %.2f principal, cleared %.2f", owed, principal)
	}
}

// Writing off must never push a balance negative, which would turn a forgiven
// debt into an apparent credit owed back to the customer.
func TestAllocatePayment_AuctionWriteOffCannotOvershoot(t *testing.T) {
	fee, penal, interest, principal, err := allocatePayment(loanOwing(1_000, 0, 0, 0), PaymentTypeAuctionWriteOff, 99_999, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if total := fee + penal + interest + principal; total != 1_000 {
		t.Fatalf("write-off should cap at the 1000 owed, allocated %.2f", total)
	}
}

// Auction money is booked explicitly by RecordAuctionSale. If these types were
// also treated as cash-bearing by the generic payment path, the same rupees
// would be counted into the till twice.
func TestIsCashPaymentType_ExcludesAuctionTypes(t *testing.T) {
	for _, tp := range []string{PaymentTypeAuctionSale, PaymentTypeAuctionWriteOff} {
		if isCashPaymentType(tp) {
			t.Errorf("%q must not be cash-bearing — RecordAuctionSale books its cash movement directly", tp)
		}
	}
	// Guard against the exclusion being over-broad.
	for _, tp := range []string{PaymentTypeInterest, PaymentTypePrincipal, PaymentTypePartial, PaymentTypeFullSettlement} {
		if !isCashPaymentType(tp) {
			t.Errorf("%q should still be cash-bearing", tp)
		}
	}
}

// Only the two terminal stages conclude a case. This predicate is what decides
// whether a loan may open a fresh auction, so a wrong answer either blocks a
// legitimate re-auction or allows two live auctions over the same gold.
func TestIsActiveAuctionStage(t *testing.T) {
	active := []string{AuctionStageEligible, AuctionStageNotice, AuctionStageScheduled, AuctionStageAuctioned}
	for _, st := range active {
		if !IsActiveAuctionStage(st) {
			t.Errorf("%q should count as active", st)
		}
	}
	for _, st := range []string{AuctionStageSettled, AuctionStageWithdrawn} {
		if IsActiveAuctionStage(st) {
			t.Errorf("%q is terminal and must not count as active", st)
		}
	}
}

// A loan pulled out of the auction pipeline has to rejoin ordinary collection
// on the status its due date actually warrants — landing on Active when it is
// months overdue would hide it from every overdue report.
func TestNormalStatusFor(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		due  time.Time
		want string
	}{
		{"overdue", now.AddDate(0, 0, -120), StatusOverdue},
		{"due tomorrow", now.AddDate(0, 0, 1), StatusDueSoon},
		{"due inside the due-soon window", now.AddDate(0, 0, dueSoonWindowDays), StatusDueSoon},
		{"comfortably in future", now.AddDate(0, 2, 0), StatusActive},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalStatusFor(&Loan{DueDate: tc.due}, now); got != tc.want {
				t.Fatalf("due %s: expected %q, got %q", tc.due.Format("2006-01-02"), tc.want, got)
			}
		})
	}
}

// A shortfall balance must sit frozen while management decides its fate, so the
// figure they judge does not move underneath them. Accrual is gated on loan
// status, so this test pins the status list that projectAccrual honours.
func TestProjectAccrual_FreezesBalanceDueAndAccruesAfterPursueDecision(t *testing.T) {
	sch := schemeMonthlySimple()
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	asOf := from.AddDate(0, 3, 0)

	frozen := &Loan{
		Status:               StatusAuctionedBalanceDue,
		OutstandingAmount:    20_000,
		LastAccrualDate:      from,
		DueDate:              from,
		SchemeInterestRate:   sch.InterestRate,
		SchemeInterestMethod: sch.InterestMethod,
		SchemePenalRate:      sch.PenalRate,
	}
	if i, p, _ := projectAccrual(frozen, asOf); i != 0 || p != 0 {
		t.Fatalf("a pending shortfall must not accrue, got interest=%.2f penal=%.2f", i, p)
	}

	// Choosing PursueBalance returns the loan to Overdue, which is what resumes
	// accrual through the ordinary path — no separate accrual rule needed.
	pursued := *frozen
	pursued.Status = StatusOverdue
	i, p, _ := projectAccrual(&pursued, asOf)
	if i <= 0 {
		t.Fatalf("a pursued balance should accrue interest once Overdue, got %.2f", i)
	}
	if p <= 0 {
		t.Fatalf("a pursued balance past its due date should accrue penal interest, got %.2f", p)
	}
}

// Money written to the ledger must not carry floating-point noise, or a
// fully-repaid loan can sit a fraction of a paisa short of closed forever.
func TestRoundMoney(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{0.1 + 0.2, 0.30},
		{1234.5678, 1234.57},
		{1234.5641, 1234.56},
		{-45.678, -45.68},
		{0, 0},
	}
	for _, tc := range cases {
		if got := platform.RoundMoney(tc.in); got != tc.want {
			t.Errorf("RoundMoney(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
	// The classic case the helper exists for.
	if platform.RoundMoney(0.1+0.2) != 0.3 {
		t.Error("0.1+0.2 must round to exactly 0.3")
	}
}

// A part-payment escalation may only be resolved keep/remove, and a shortfall
// only write-off/pursue. Without per-kind default authority a shortfall could
// be closed as "keep in auction", leaving real money owed with no decision
// made.
//
// Authority for these two decisions used to be two hardcoded Go maps
// (shortfallAuthorityRoles/partialRepaymentAuthorityRoles) checked directly
// against the acting employee's role string. It's now a real, admin-editable
// permission (authz.Repository.IsAllowed — see
// Service.ResolveAuctionDecision/checkStagePermission), so what this test
// can still meaningfully assert is the DEFAULT grant baked into
// authz.Restrictions — an admin is free to rebalance who holds these
// permissions from the Roles & Permissions screen from here on, but the
// out-of-the-box behavior on a fresh install should still match the
// invariants this test always checked.
func TestDecisionAuthority_ShortfallExcludesAuctionAdministrator(t *testing.T) {
	shortfallRoles := restrictionRoles(t, "can decide auction shortfall")
	if shortfallRoles["Auction Administrator"] {
		t.Error("Auction Administrator raises a shortfall escalation but must not decide it by default")
	}
	for _, role := range []string{"Branch Manager", "Management", "Administrator"} {
		if !shortfallRoles[role] {
			t.Errorf("%q must be able to decide a shortfall by default", role)
		}
	}
	// Either the Auction Administrator or the Branch Manager may settle a
	// part-payment question, so gold is never stuck awaiting two signatures.
	partialRoles := restrictionRoles(t, "can decide auction partial repayment")
	for _, role := range []string{"Auction Administrator", "Branch Manager"} {
		if !partialRoles[role] {
			t.Errorf("%q must be able to decide a part-payment question by default", role)
		}
	}
	for _, role := range []string{"Cashier", "Loan Operator", "Auditor", "Collection Staff", "Accountant"} {
		if partialRoles[role] || shortfallRoles[role] {
			t.Errorf("%q must not be able to decide an auction escalation by default", role)
		}
	}
}

// restrictionRoles looks up permissionName's default-allowed role set from
// authz.Restrictions (the same table internal/migrate seeds role_permissions
// from on boot), failing the test outright if the catalogue entry was
// renamed/removed rather than silently passing on an empty set.
func restrictionRoles(t *testing.T, permissionName string) map[string]bool {
	t.Helper()
	for _, r := range authz.Restrictions {
		if r.PermissionName == permissionName {
			allowed := make(map[string]bool, len(r.AllowedRoles))
			for _, role := range r.AllowedRoles {
				allowed[role] = true
			}
			return allowed
		}
	}
	t.Fatalf("no authz.Restrictions entry for %q", permissionName)
	return nil
}

// isUniqueViolation is what turns a database race into a clean
// "already started" API response rather than a 500.
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
