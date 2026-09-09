package demoseed

import (
	"context"
	"fmt"
	"math"

	"cloudhouse/backend/internal/loan"
)

// paymentPlan is one receipt against a loan.
//
// Amounts are FRACTIONS of what the loan actually owes in the relevant
// bucket, not rupee figures, and that is not a stylistic choice.
// loan.Service.RecordPayment allocates a payment down a waterfall and rejects
// it with ErrExceedsOutstanding if the amount is more than the type can
// absorb — an "Interest" payment cannot exceed outstanding interest plus
// penal interest, and a "Full Settlement" must cover the whole balance
// exactly. Those balances come from interest accrued over the loan's elapsed
// term, so a hardcoded 8,500 is right only for one particular loan on one
// particular day. Asking the loan what it owes and paying a share of it is
// correct on every loan, every day.
type paymentPlan struct {
	loanIdx int
	kind    string
	// fraction of the bucket this payment type draws from. 1.0 clears it.
	fraction    float64
	daysAgo     int
	description string
}

// paymentPlans is the receipt history.
//
// NOTHING HERE MAY TARGET AN AUCTION-POOL LOAN, and that is not a style
// preference. loan.Service.MarkAuctionEligible requires the loan to be
// defaulted, and enrichStatusFlags only sets that flag when the loan is more
// than ninety days overdue AND still carries arrears. Recording any payment
// against one of the eight auction-pool loans clears enough of the arrears
// that the flag never sets, and the entire auctions step then fails with
// ErrLoanNotDefaulted. seedPayments asserts this rather than trusting it.
var paymentPlans = []paymentPlan{
	// Interest servicing on the active book. Partial, so the loans still
	// show arrears afterwards.
	{6, loan.PaymentTypeInterest, 0.6, 25, "Monthly interest"},
	{7, loan.PaymentTypeInterest, 0.5, 20, "Monthly interest"},
	{8, loan.PaymentTypeInterest, 0.7, 15, "Monthly interest"},
	{9, loan.PaymentTypeInterest, 0.4, 30, "Monthly interest"},
	{10, loan.PaymentTypeInterest, 0.8, 22, "Monthly interest"},
	{11, loan.PaymentTypeInterest, 0.5, 18, "Monthly interest"},
	{12, loan.PaymentTypeInterest, 0.6, 12, "Monthly interest"},
	{13, loan.PaymentTypeInterest, 0.9, 40, "Monthly interest"},
	{14, loan.PaymentTypeInterest, 0.5, 28, "Monthly interest"},
	{15, loan.PaymentTypeInterest, 0.6, 26, "Monthly interest"},
	{16, loan.PaymentTypeInterest, 0.7, 24, "Monthly interest"},

	// Part payments against principal.
	{7, loan.PaymentTypePrincipal, 0.2, 10, "Part principal repayment"},
	{9, loan.PaymentTypePrincipal, 0.25, 14, "Part principal repayment"},
	{11, loan.PaymentTypePrincipal, 0.15, 8, "Part principal repayment"},
	{12, loan.PaymentTypePrincipal, 0.2, 6, "Part principal repayment"},
	{13, loan.PaymentTypePrincipal, 0.3, 16, "Part principal repayment"},
	{15, loan.PaymentTypePrincipal, 0.1, 9, "Part principal repayment"},

	// Mixed part payments on the overdue loans.
	{17, loan.PaymentTypePartial, 0.15, 5, "Part payment towards dues"},
	{18, loan.PaymentTypePartial, 0.2, 7, "Part payment towards dues"},
	{19, loan.PaymentTypePartial, 0.1, 11, "Part payment towards dues"},

	// Non-cash adjustments, so the payment-type filter has every kind.
	{17, loan.PaymentTypeWaiver, 0.3, 3, "Penal interest waived by management"},
	{18, loan.PaymentTypeWaiver, 0.4, 4, "Penal interest waived by management"},
	{19, loan.PaymentTypeDiscount, 0.2, 2, "Goodwill discount"},
	{13, loan.PaymentTypeDiscount, 0.1, 5, "Goodwill discount"},

	// Full settlement closes the last loan in the book. Must be the whole
	// balance — a Full Settlement for less is refused.
	{29, loan.PaymentTypeFullSettlement, 1.0, 1, "Loan closed in full"},
}

// seedPayments records the receipt history against the loan book.
func seedPayments(ctx context.Context, d *Deps, st *state, rep *Report) error {
	actor := st.keep.adminID
	n := 0

	for _, p := range paymentPlans {
		if p.loanIdx >= len(st.loanIDs) {
			continue
		}
		// A payment on an auction-pool loan would silently break the auctions
		// step (see paymentPlans' comment), so refuse loudly instead.
		if isAuctionPool(p.loanIdx) {
			return fmt.Errorf(
				"payment plan targets auction-pool loan index %d: this would clear its arrears and make the auctions step fail with ErrLoanNotDefaulted",
				p.loanIdx)
		}

		id := st.loanIDs[p.loanIdx]

		// Get (not the repository) because it accrues interest up to now and
		// populates the computed Outstanding* fields the amount is derived
		// from. Re-read on every payment: the previous one moved the balances.
		l, err := d.loanSvc.Get(ctx, id, nil)
		if err != nil {
			return fmt.Errorf("read loan index %d before payment: %w", p.loanIdx, err)
		}

		amount := payableAmount(l, p.kind, p.fraction)
		// Nothing owed in that bucket yet — a young loan has not accrued
		// interest worth paying. Skipping keeps the dataset shape stable
		// instead of failing the whole reset over a rounding edge.
		if amount < 1 {
			continue
		}

		if _, err := d.loanSvc.RecordPayment(ctx, id, loan.PaymentInput{
			Amount:               amount,
			Type:                 p.kind,
			PaidOn:               st.clk.daysAgo(p.daysAgo),
			ReceivedByEmployeeID: &actor,
			Method:               "Cash",
			Description:          p.description,
		}); err != nil {
			return fmt.Errorf("record %s payment of %.2f on loan index %d: %w", p.kind, amount, p.loanIdx, err)
		}
		n++
	}

	rep.created("loan payments", n)
	return nil
}

// payableAmount works out what this payment type may draw, and takes the
// planned share of it.
//
// The bucket each type draws from mirrors allocatePayment's waterfall in
// internal/loan. It is a deliberate, narrow duplication: the alternative is
// hardcoded rupee amounts, which are wrong the moment a date or a rate in the
// fixtures changes. Only the ceiling is mirrored here, never the allocation
// itself — the service still does all the real work.
func payableAmount(l *loan.Loan, kind string, fraction float64) float64 {
	var ceiling float64
	switch kind {
	case loan.PaymentTypeInterest, loan.PaymentTypeWaiver, loan.PaymentTypeDiscount:
		// Interest and the two non-cash concessions come out of the accrued
		// interest and penal interest.
		ceiling = l.OutstandingInterest + l.OutstandingPenalInterest
	case loan.PaymentTypePenalInterest:
		ceiling = l.OutstandingPenalInterest
	case loan.PaymentTypePrincipal:
		ceiling = l.OutstandingAmount
	case loan.PaymentTypeFullSettlement:
		// Must be the entire balance: a Full Settlement short of the total is
		// refused outright.
		ceiling = l.OutstandingAmount + l.OutstandingInterest +
			l.OutstandingPenalInterest + l.OutstandingProcessingFee
	default:
		// Partial and Adjustment run the full waterfall, so the whole balance
		// is available.
		ceiling = l.OutstandingAmount + l.OutstandingInterest +
			l.OutstandingPenalInterest + l.OutstandingProcessingFee
	}

	if ceiling <= 0 {
		return 0
	}
	amount := ceiling * fraction
	// A Full Settlement has to cover the balance exactly, so it is never
	// rounded down. Everything else rounds to whole rupees, which is how a
	// branch actually takes cash and keeps the figures on screen tidy.
	if fraction >= 1 {
		return math.Round(ceiling*100) / 100
	}
	return math.Floor(amount)
}
