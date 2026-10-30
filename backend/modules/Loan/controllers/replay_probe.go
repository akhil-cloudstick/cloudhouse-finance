package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"log"
	"math"

	"gorm.io/gorm"
)

// firstAllocationDiff is the index of the first row whose recalculated split differs from what is saved, or -1.
func firstAllocationDiff(saved, replayed []models.LoanPayment) int {
	for i := range saved {
		a, b := saved[i], replayed[i]
		if math.Abs(a.InterestApplied-b.InterestApplied) > moneyEpsilon || math.Abs(a.PenalInterestApplied-b.PenalInterestApplied) > moneyEpsilon ||
			math.Abs(a.PrincipalApplied-b.PrincipalApplied) > moneyEpsilon || math.Abs(a.ProcessingFeeApplied-b.ProcessingFeeApplied) > moneyEpsilon {
			return i
		}
	}
	return -1
}

// probeReplay recalculates the untouched loan before an edit. It never refuses an edit: a history that does not
// reproduce exactly is only logged, and the edit goes ahead — staff review every entry after the edited one in the
// preview, so nothing is changed without being seen.
//
// One difference is explained and adopted: a payment saved with LESS interest than the loan's calculated interest and
// no stored override was one where staff typed their own interest figure (the Interest field of Record Payment). The
// figure it actually applied is the record of that choice, so it is kept as the row's override; the override is saved
// with the edit, so later recalculations reuse it.
func probeReplay(ctx context.Context, tx *gorm.DB, l *models.Loan, rows []models.LoanPayment, originalStatus string) error {
	return probeReplayFrom(ctx, tx, l, rows, originalStatus, 0)
}

// probeReplayFrom is probeReplay for an edit that recalculates only from index from: the entries before it are taken
// as saved, so only the entries from there on are compared.
func probeReplayFrom(ctx context.Context, tx *gorm.DB, l *models.Loan, rows []models.LoanPayment, originalStatus string, from int) error {
	for attempt := 0; attempt <= len(rows); attempt++ {
		saved := make([]models.LoanPayment, len(rows))
		copy(saved, rows)
		probe := *l
		probeRows := make([]models.LoanPayment, len(rows))
		copy(probeRows, rows)
		if err := replayLoanFrom(ctx, tx, &probe, probeRows, originalStatus, from); err != nil {
			log.Printf("ledger edit on loan %d: saved history does not recalculate (%v); going ahead", l.ID, err)
			return nil
		}
		idx := firstAllocationDiff(saved, probeRows)
		if idx < 0 {
			if diff := sameLoanFigures(l, &probe); diff != "" {
				log.Printf("ledger edit on loan %d: saved totals differ from the recalculation (%s); going ahead", l.ID, diff)
			}
			return nil
		}
		s, b := saved[idx], probeRows[idx]
		typedOver := s.InterestOverride == nil && s.Type != models.PaymentTypeDiscount && s.Type != models.PaymentTypeWaiver &&
			b.InterestApplied > s.InterestApplied+moneyEpsilon
		if !typedOver {
			log.Printf("ledger edit on loan %d: saved figures differ from the recalculation (%s); going ahead", l.ID, sameAllocation(saved, probeRows))
			return nil
		}
		applied := s.InterestApplied
		rows[idx].InterestOverride = &applied
	}
	return nil
}
