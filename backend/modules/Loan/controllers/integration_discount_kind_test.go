package controllers

// The discount type (customer / interest / penal interest) against the scratch database: what each one takes off,
// what it refuses, that a recalculation reproduces it, and that an edit keeps and honours it.

import (
	"cloudhouse/backend/config"
	"strings"
	"testing"

	"cloudhouse/backend/modules/Loan/models"
)

func (l *ledgerLoan) discount(day int, amount float64, kind string) (uint, error) {
	l.t.Helper()
	_, err := SaveLoanPayment(l.ctx, l.id, PaymentInput{
		Amount: amount, Type: models.PaymentTypeDiscount, PaidOn: l.when(day), CheckDateWindow: true,
		Method: "Cash", Description: "Discount: test", DiscountKind: kind,
	})
	if err != nil {
		return 0, err
	}
	l.settleAsOf(day, true)
	var id uint
	if err := config.BaseDB.Raw(`SELECT id FROM loan_payments WHERE loan_id = ? AND type = 'Discount' ORDER BY id DESC LIMIT 1`, l.id).Row().Scan(&id); err != nil {
		l.t.Fatal(err)
	}
	return id, nil
}

func TestIntegrationDiscountKind(t *testing.T) {
	l := newLedgerLoan(t, ledgerAge)

	// an interest discount takes only interest, and is saved with its kind
	id, err := l.discount(40, 50, DiscountKindInterest)
	if err != nil {
		t.Fatalf("interest discount: %v", err)
	}
	var row models.LoanPayment
	if err := config.BaseDB.WithContext(l.ctx).First(&row, id).Error; err != nil {
		t.Fatal(err)
	}
	if row.DiscountKind != DiscountKindInterest || !closeTo(row.InterestApplied, 50) || row.PenalInterestApplied != 0 || row.PrincipalApplied != 0 {
		t.Fatalf("interest discount row = kind %q interest %.2f penal %.2f principal %.2f, want interest/50/0/0",
			row.DiscountKind, row.InterestApplied, row.PenalInterestApplied, row.PrincipalApplied)
	}

	// a penal-interest discount on a loan that owes none is refused, and saves nothing
	before := snapshotLoan(t, l.id)
	if _, err := l.discount(45, 10, DiscountKindPenalInterest); err == nil || !strings.Contains(err.Error(), "penal interest owed") {
		t.Fatalf("penal discount with no penal interest owed: got %v, want a refusal naming the penal interest owed", err)
	}
	if after := snapshotLoan(t, l.id); after != before {
		t.Fatalf("a refused discount changed the loan:\nbefore %s\nafter  %s", before, after)
	}

	// an interest discount larger than the interest owed is refused too
	if _, err := l.discount(46, 100000, DiscountKindInterest); err == nil || !strings.Contains(err.Error(), "interest owed") {
		t.Fatalf("oversized interest discount: got %v", err)
	}

	// an unknown type is refused
	if _, err := l.discount(46, 10, "principal"); err == nil || !strings.Contains(err.Error(), "discount type") {
		t.Fatalf("unknown discount type: got %v", err)
	}

	// a customer discount keeps the old waterfall (penal, interest, then principal)
	cid, err := l.discount(50, 30, DiscountKindCustomer)
	if err != nil {
		t.Fatalf("customer discount: %v", err)
	}
	var crow models.LoanPayment
	if err := config.BaseDB.WithContext(l.ctx).First(&crow, cid).Error; err != nil {
		t.Fatal(err)
	}
	if !closeTo(crow.InterestApplied+crow.PenalInterestApplied+crow.PrincipalApplied, 30) {
		t.Fatalf("customer discount of 30 applied %.2f in total", crow.InterestApplied+crow.PenalInterestApplied+crow.PrincipalApplied)
	}

	// the whole history, with the kinds saved, is reproduced by a full recalculation
	fullReplayHolds(t, "discount kinds", l)

	// an edit keeps the kind, honours it, and refuses an amount that no longer fits it
	if _, err := l.editPay(id, &EditPaymentInput{Amount: f64(60)}, false); err != nil {
		t.Fatalf("edit the interest discount to 60: %v", err)
	}
	var edited models.LoanPayment
	if err := config.BaseDB.WithContext(l.ctx).First(&edited, id).Error; err != nil {
		t.Fatal(err)
	}
	if edited.DiscountKind != DiscountKindInterest || !closeTo(edited.InterestApplied, 60) || edited.PrincipalApplied != 0 {
		t.Fatalf("edited discount = kind %q interest %.2f principal %.2f, want interest/60/0", edited.DiscountKind, edited.InterestApplied, edited.PrincipalApplied)
	}
	fullReplayHolds(t, "after editing the discount", l)

	before = snapshotLoan(t, l.id)
	if _, err := l.editPay(id, &EditPaymentInput{Amount: f64(100000)}, false); err == nil {
		t.Fatal("an interest discount edited above the interest owed must be refused")
	}
	if after := snapshotLoan(t, l.id); after != before {
		t.Fatal("a refused edit changed the loan")
	}

	// switching the type of an existing discount is an edit like any other
	kind := DiscountKindCustomer
	if _, err := l.editPay(id, &EditPaymentInput{DiscountKind: &kind}, false); err != nil {
		t.Fatalf("change the discount to a customer discount: %v", err)
	}
	if err := config.BaseDB.WithContext(l.ctx).First(&edited, id).Error; err != nil || edited.DiscountKind != DiscountKindCustomer {
		t.Fatalf("after switching to customer the row kind = %q (%v)", edited.DiscountKind, err)
	}
	fullReplayHolds(t, "after switching the kind", l)
}
