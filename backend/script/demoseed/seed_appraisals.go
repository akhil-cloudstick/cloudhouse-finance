package demoseed

import (
	"context"
	"fmt"

	"cloudhouse/backend/internal/loan"
)

// seedAppraisals records assay results and photographs against pledged
// ornaments.
//
// These two tables are easy to forget — nothing else in the reseed touches
// them, because both are optional extras a branch adds AFTER a loan is
// booked rather than part of creating one. Left empty, the ornament detail
// panel shows "no purity test recorded" and an empty photo strip on every
// single loan, which reads as a broken screen rather than an unused feature.
//
// Only the first ornament of each loan is used: an appraisal is per item, and
// testing every one would produce sixty near-identical rows without showing
// anything the first twenty do not.
func seedAppraisals(ctx context.Context, d *Deps, st *state, rep *Report) error {
	tests, images := 0, 0

	for i, loanID := range st.loanIDs {
		// Only a subset, so the demo also shows the untested state.
		if i >= 20 {
			break
		}
		ornaments, err := d.ornamentRepo.FindByLoanID(ctx, loanID)
		if err != nil || len(ornaments) == 0 {
			continue
		}
		o := ornaments[0]

		// The tested figures deliberately differ slightly from the declared
		// ones — a real assay almost never matches the counter estimate, and
		// a demo where they agree exactly hides the whole point of recording
		// a test. Fixed offsets, so the numbers are identical every reset.
		if _, err := d.loanSvc.RecordPurityTest(ctx, o.ID, loan.PurityTestInput{
			TestedPurity:          o.Purity,
			TestedGrossWeight:     o.GrossWeight - 0.2,
			TestedDeductionWeight: o.DeductionWeight + 0.1,
			TestingRemarks:        "Touchstone assay, within tolerance",
			TestedBy:              "Appraiser",
			TestedAt:              st.clk.daysAgo(1),
		}); err != nil {
			return fmt.Errorf("record purity test on ornament %d: %w", o.ID, err)
		}
		tests++

		// Photographs, drawn from the files seedUploads already wrote so
		// there is a real image behind each row rather than a dead path.
		if len(st.uploadKeys) == 0 {
			continue
		}
		for j := 0; j < 2; j++ {
			key := st.uploadKeys[(i+j)%len(st.uploadKeys)]
			if _, err := d.loanSvc.AddOrnamentImage(ctx, o.ID, key); err != nil {
				return fmt.Errorf("add image to ornament %d: %w", o.ID, err)
			}
			images++
		}
	}

	rep.created("ornament purity tests", tests)
	rep.created("ornament images", images)
	return nil
}
