package demoseed

import (
	"context"
	"fmt"

	"time"

	"cloudhouse/backend/internal/bank"
	"cloudhouse/backend/internal/goldrate"
	"cloudhouse/backend/internal/locker"
	"cloudhouse/backend/internal/puritystandard"
	"cloudhouse/backend/internal/scheme"
)

// seedMasters restores the reference data the transactional screens read
// from: purity standards, banks, ornament types and lockers.
func seedMasters(ctx context.Context, d *Deps, st *state, rep *Report) error {
	if err := seedPurityStandards(ctx, d, rep); err != nil {
		return err
	}

	for _, f := range bankFixtures {
		if _, _, err := d.bankSvc.FindOrCreate(ctx, bank.CreateInput{
			Name:      f.Name,
			Branch:    f.Branch,
			Ifsc:      f.Ifsc,
			AccountNo: f.AccountNo,
			Phone:     f.Phone,
		}); err != nil {
			return fmt.Errorf("create bank %q: %w", f.Name, err)
		}
	}
	rep.created("banks", len(bankFixtures))

	for _, name := range ornamentTypeFixtures {
		if _, _, err := d.ornTypeSvc.FindOrCreate(ctx, name); err != nil {
			return fmt.Errorf("create ornament type %q: %w", name, err)
		}
	}
	rep.created("ornament types", len(ornamentTypeFixtures))

	for i, f := range lockerFixtures {
		v, err := d.lockerSvc.Create(ctx, locker.CreateInput{
			Code:     f.Code,
			BranchID: st.branchIDs[i%len(st.branchIDs)],
			Capacity: f.Capacity,
		})
		if err != nil {
			return fmt.Errorf("create locker %q: %w", f.Code, err)
		}
		st.lockerIDs = append(st.lockerIDs, v.ID)
	}
	rep.created("lockers", len(lockerFixtures))

	return nil
}

// seedPurityStandards re-seeds 24K down to 10K for THIS business.
//
// It does not call puritystandard.SeedStandards, even though that function
// exists and produces the same rows. SeedStandards runs under
// AllowCrossTenant: its FindByKarat probe would match another business's row
// and skip, and anything it did create would land at tenant_id = 0 and be
// invisible to every scoped read. Looping FindOrCreate under the caller's
// tenant context does single-struct creates, so the stamp callback fires and
// the rows belong to this business. Labels are formatted identically to
// SeedStandards so the two are indistinguishable in the UI.
func seedPurityStandards(ctx context.Context, d *Deps, rep *Report) error {
	n := 0
	for karat := puritystandard.MaxKarat; karat >= puritystandard.MinKarat; karat-- {
		k := karat
		fineness := puritystandard.FinenessForKarat(k)
		if _, _, err := d.puritySvc.FindOrCreate(ctx, puritystandard.CreateInput{
			Karat:           &k,
			FinenessPercent: &fineness,
			Label:           fmt.Sprintf("%dK (%.1f%%)", k, fineness),
		}); err != nil {
			return fmt.Errorf("create purity standard %dK: %w", k, err)
		}
		n++
	}
	rep.created("purity standards", n)
	return nil
}

// seedGoldRates publishes twenty consecutive daily rates, ending TODAY.
//
// The last row is a hard prerequisite for the rest of the dataset, not
// decoration: loan.Service.Create returns ErrGoldRateNotSetToday unless a
// rate exists for the current date, so without this step every one of the
// thirty loans fails. It runs before seedSchemes and seedLoans for that
// reason, and verifies the result rather than assuming it.
func seedGoldRates(ctx context.Context, d *Deps, st *state, rep *Report) error {
	last := len(goldRateFixtures) - 1
	for i, k24 := range goldRateFixtures {
		if _, err := d.goldRateSvc.Publish(ctx, goldrate.PublishInput{
			// i == last lands on today; earlier entries walk backwards.
			Date:  st.clk.daysAgo(last - i),
			K24:   k24,
			SetBy: "Admin",
		}); err != nil {
			return fmt.Errorf("publish gold rate for %s: %w", st.clk.daysAgo(last-i).Format("2006-01-02"), err)
		}
	}
	rep.created("gold rates", len(goldRateFixtures))

	// Assert the prerequisite explicitly. If this ever fails, the error names
	// the real cause here instead of surfacing thirty identical
	// ErrGoldRateNotSetToday failures two steps later.
	latest, err := d.goldRateSvc.Latest(ctx)
	if err != nil {
		return fmt.Errorf("read back today's gold rate: %w", err)
	}
	if !sameDay(latest.Date, st.clk.today) {
		return fmt.Errorf("latest gold rate is dated %s, not today (%s) — loans cannot be created",
			latest.Date.Format("2006-01-02"), st.clk.today.Format("2006-01-02"))
	}
	return nil
}

// sameDay compares two instants by calendar date, ignoring the clock time.
// The rate row is stored at whatever time Publish wrote it; only the date is
// what loan.Service.Create checks.
func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

// seedSchemes creates the ten loan products.
//
// IsActive is passed explicitly on every row. scheme.Scheme.IsActive is
// declared `default:false`, and Go's zero value for a bool is exactly what
// GORM omits from an insert — so a fixture that simply left the field unset
// would produce a scheme the new-loan form never offers, and the loans step
// would have nothing to reference.
func seedSchemes(ctx context.Context, d *Deps, st *state, rep *Report) error {
	for i, f := range schemeFixtures {
		s, err := d.schemeSvc.Create(ctx, scheme.CreateInput{
			Name:           f.Name,
			BranchID:       st.branchIDs[i%len(st.branchIDs)],
			InterestRate:   f.InterestRate,
			DurationMonths: f.DurationMonths,
			LTVPercent:     f.LTVPercent,
			InterestMethod: f.InterestMethod,
			PenalRate:      f.PenalRate,
			IsActive:       f.Active,
		})
		if err != nil {
			return fmt.Errorf("create scheme %q: %w", f.Name, err)
		}
		// Only active schemes are offered to loans, for the same reason
		// inactive branches are excluded from the rotation.
		if f.Active {
			st.schemeIDs = append(st.schemeIDs, s.ID)
		}
	}
	rep.created("schemes", len(schemeFixtures))
	return nil
}
