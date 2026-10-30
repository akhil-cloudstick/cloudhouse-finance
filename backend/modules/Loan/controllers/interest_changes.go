package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"math"
	"sort"
	"time"

	"gorm.io/gorm"
)

// The interest a loan is charged is worked out by the system, never typed in. When an edit recalculates the loan, the
// preview lists the interest rows it changes so staff can see them; they are not editable.

// InterestChange is one interest charge date whose amount an edit changes.
type InterestChange struct {
	On             time.Time `json:"on"`
	InterestBefore float64   `json:"interest_before"`
	InterestAfter  float64   `json:"interest_after"`
	PenalBefore    float64   `json:"penal_before"`
	PenalAfter     float64   `json:"penal_after"`
}

type accrualDay struct {
	on              time.Time
	interest, penal float64
}

// accrualSnapshot is the loan's interest rows as they stand inside the transaction, by charge day.
func accrualSnapshot(ctx context.Context, tx *gorm.DB, loanID uint) map[string]accrualDay {
	var rows []models.LoanAccrual
	out := map[string]accrualDay{}
	if err := tx.WithContext(ctx).Where("loan_id = ?", loanID).Find(&rows).Error; err != nil {
		return out
	}
	for _, r := range rows {
		key := dayOf(r.AccruedOn)
		d := out[key]
		if d.on.IsZero() {
			d.on = r.AccruedOn
		}
		d.interest += r.Interest
		d.penal += r.PenalInterest
		out[key] = d
	}
	return out
}

// interestChanges lists the charge days whose interest or penal interest differs between two snapshots, oldest first.
func interestChanges(before, after map[string]accrualDay) []InterestChange {
	keys := map[string]bool{}
	for k := range before {
		keys[k] = true
	}
	for k := range after {
		keys[k] = true
	}
	var out []InterestChange
	for k := range keys {
		b, a := before[k], after[k]
		if math.Abs(b.interest-a.interest) < 0.005 && math.Abs(b.penal-a.penal) < 0.005 {
			continue
		}
		on := a.on
		if on.IsZero() {
			on = b.on
		}
		out = append(out, InterestChange{On: on, InterestBefore: round2(b.interest), InterestAfter: round2(a.interest), PenalBefore: round2(b.penal), PenalAfter: round2(a.penal)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].On.Before(out[j].On) })
	return out
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }
