package controllers

import (
	common "cloudhouse/backend/common/controllers"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"math"
	"time"

	"gorm.io/gorm"
)

// When a ledger edit leaves a LATER payment larger than what the loan then owes, the payment is not refused: it is
// lowered to what it can still be and listed for the staff member, who can lower it further (0 removes it) before
// saving. Only payments after the edited entry are ever touched, and only ever lowered.

// LoanFollowingEntry is a later payment an edit would change.
type LoanFollowingEntry struct {
	ID        uint      `json:"id"`
	PaidOn    time.Time `json:"paid_on"`
	Type      string    `json:"type"`
	Reference string    `json:"reference"`
	Current   float64   `json:"current"`
	Suggested float64   `json:"suggested"`
	// NeedsChange is set when the payment no longer fits and was lowered to what is left; the others are listed so
	// the staff member can look at them, unchanged.
	NeedsChange bool `json:"needs_change"`
}

// LoanFollowingAdjust is the amount the staff member chose for one later payment.
type LoanFollowingAdjust struct {
	ID     uint    `json:"id"`
	Amount float64 `json:"amount"`
}

// replayFit is carried through the recalculation (in its context) to switch the "lower what no longer fits" behaviour on.
type replayFit struct {
	editedID uint
	adjust   map[uint]float64
	// strict is set when the edit is really being saved: nothing is lowered on its own then, a payment that does not
	// fit and was not given a smaller amount stops the save.
	strict  bool
	changed []LoanFollowingEntry // the payments whose amount differs
	listed  []LoanFollowingEntry // every repayment after the edit, changed or not
}

type replayFitKey struct{}

func newReplayFit(editedID uint, adjust []LoanFollowingAdjust) *replayFit {
	f := &replayFit{editedID: editedID, adjust: map[uint]float64{}}
	for _, a := range adjust {
		f.adjust[a.ID] = a.Amount
	}
	return f
}

func withReplayFit(ctx context.Context, f *replayFit) context.Context {
	return context.WithValue(ctx, replayFitKey{}, f)
}

func replayFitOf(ctx context.Context) *replayFit {
	f, _ := ctx.Value(replayFitKey{}).(*replayFit)
	return f
}

// eligible is true for a repayment other than the edited one. The interest taken out of a top-up's payout belongs to
// that top-up and is never lowered on its own.
func (f *replayFit) eligible(p *models.LoanPayment) bool {
	return f != nil && p.ID != f.editedID && isCashPaymentType(p.Type) && p.Description != topUpSettlementDescription
}

// followingPlan is what saving the lowered payments takes, worked out before anything is written.
type followingPlan struct {
	groups  map[uint]string
	removed map[uint]bool
}

// prepareFollowing finds the cash-book groups of the lowered payments and takes the ones brought down to nothing out
// of the list that is saved. saved is every payment as it was before the edit changed the rows in place.
func prepareFollowing(ctx context.Context, tx *gorm.DB, l *models.Loan, fit *replayFit, saved map[uint]models.LoanPayment, edited []models.LoanPayment) (*followingPlan, []models.LoanPayment, error) {
	groups, err := fit.captureGroups(ctx, tx, l, saved)
	if err != nil {
		return nil, nil, err
	}
	removed := fit.removed(edited)
	if len(removed) > 0 {
		kept := make([]models.LoanPayment, 0, len(edited))
		for _, r := range edited {
			if !removed[r.ID] {
				kept = append(kept, r)
			}
		}
		edited = kept
	}
	return &followingPlan{groups: groups, removed: removed}, edited, nil
}

// finish runs after the recalculated rows are saved: payments brought down to nothing are deleted and the cash-book
// lines of the lowered ones are rewritten.
func (p *followingPlan) finish(ctx context.Context, tx *gorm.DB, l *models.Loan, edited []models.LoanPayment) error {
	for id := range p.removed {
		if err := tx.WithContext(ctx).Delete(&models.LoanPayment{}, id).Error; err != nil {
			return err
		}
	}
	return rewriteFollowingCash(ctx, tx, l, edited, p.groups)
}

// maxPayableFor is the most a payment of this type can be against the loan as it stands (what allocatePayment accepts).
func maxPayableFor(l *models.Loan, paymentType string, interestOverride *float64) float64 {
	fee := math.Max(0, l.OutstandingProcessingFee)
	penal := math.Max(0, l.AccruedPenalInterest-l.PenalInterestPaid)
	interest := l.AccruedInterest - l.InterestPaid
	if interestOverride != nil {
		interest = *interestOverride
	}
	interest = math.Max(0, interest)
	principal := math.Max(0, l.OutstandingAmount)
	switch paymentType {
	case models.PaymentTypeInterest:
		return common.RoundMoney(fee + penal + interest)
	case models.PaymentTypePenalInterest:
		return common.RoundMoney(fee + penal)
	case models.PaymentTypePrincipal:
		return common.RoundMoney(fee + principal)
	default: // Partial and Full Settlement
		return common.RoundMoney(fee + penal + interest + principal)
	}
}

// lowerLoanPayment brings a payment down to a smaller amount, taking the difference off its cash part first, then UPI,
// bank transfer and cheque, so its breakdown still adds up.
func lowerLoanPayment(p *models.LoanPayment, amount float64) {
	reduce := common.RoundMoney(p.Amount - amount)
	take := func(v *float64) {
		d := math.Min(*v, reduce)
		*v = common.RoundMoney(*v - d)
		reduce = common.RoundMoney(reduce - d)
	}
	take(&p.CashAmount)
	take(&p.UpiAmount)
	take(&p.BankTransferAmount)
	take(&p.ChequeAmount)
	p.Amount = amount
	if p.UpiAmount+p.BankTransferAmount+p.ChequeAmount == 0 {
		p.BankID = nil
	}
	p.Method = methodOrDerived("", p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount)
}

// fit applies the amount the staff member chose for a later payment, then lowers it to what the loan can still take.
func (f *replayFit) fit(l *models.Loan, p *models.LoanPayment) error {
	original := p.Amount
	when := p.PaidOn.Format("02-01-2006")
	chosen := false
	forced := false
	if v, ok := f.adjust[p.ID]; ok {
		if v < -0.004 || v > p.Amount+0.004 {
			return common.NewBadRequest(fmt.Sprintf("the payment on %s can only be lowered, not raised", when))
		}
		if v < p.Amount-0.004 {
			lowerLoanPayment(p, common.RoundMoney(v))
		}
		chosen = true
	}
	if max := maxPayableFor(l, p.Type, p.InterestOverride); p.Amount > max+0.01 {
		if chosen || f.strict {
			return common.NewBadRequest(fmt.Sprintf("the payment on %s can be at most ₹%.2f — lower it in the list of payments after this one", when, max))
		}
		lowerLoanPayment(p, max)
		forced = true
	}
	entry := LoanFollowingEntry{ID: p.ID, PaidOn: p.PaidOn, Type: p.Type, Reference: p.Reference, Current: original, Suggested: p.Amount, NeedsChange: forced}
	f.listed = append(f.listed, entry)
	if math.Abs(p.Amount-original) > 0.004 {
		f.changed = append(f.changed, entry)
	}
	return nil
}

// removed is the ids of the later payments brought down to nothing.
func (f *replayFit) removed(edited []models.LoanPayment) map[uint]bool {
	out := map[uint]bool{}
	for _, c := range f.changed {
		if i := findRow(edited, c.ID); i >= 0 && edited[i].Amount <= 0.004 {
			out[c.ID] = true
		}
	}
	return out
}

// captureGroups finds, before anything is saved, the cash-book group each changed payment was booked under.
func (f *replayFit) captureGroups(ctx context.Context, tx *gorm.DB, l *models.Loan, original map[uint]models.LoanPayment) (map[uint]string, error) {
	groups := map[uint]string{}
	for _, c := range f.changed {
		o := original[c.ID]
		g, err := paymentCashGroup(ctx, tx, l, &o)
		if err != nil {
			return nil, err
		}
		groups[c.ID] = g
	}
	return groups, nil
}

// rewriteFollowingCash replaces the cash-book lines of every lowered payment with lines for its new amount; a removed
// payment just loses them.
func rewriteFollowingCash(ctx context.Context, tx *gorm.DB, l *models.Loan, edited []models.LoanPayment, groups map[uint]string) error {
	txCtx := cashbook.WithTx(ctx, tx)
	for id, g := range groups {
		if err := cashbook.DeleteCollectionByGroup(txCtx, g); err != nil {
			return err
		}
		i := findRow(edited, id)
		if i < 0 || edited[i].Amount <= 0.004 {
			continue
		}
		p := &edited[i]
		_, groupID, err := cashbook.RecordLoanPaymentCashIn(txCtx, l.ID, l.LoanNumber, p.Amount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, l.BranchID, p.PaidOn, p.Type, l.CustomerID, p.BankID)
		if err != nil {
			return fmt.Errorf("could not record the lowered payment in Cash-in-Hand: %w", err)
		}
		if err := tx.WithContext(ctx).Model(&models.LoanPayment{}).Where("id = ?", p.ID).Update("cash_transaction_group_id", groupID).Error; err != nil {
			return err
		}
	}
	return nil
}
