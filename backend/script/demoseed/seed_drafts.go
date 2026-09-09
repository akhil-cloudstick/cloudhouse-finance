package demoseed

import (
	"context"
	"fmt"

	"cloudhouse/backend/internal/loan"
)

// seedDrafts saves ten half-finished New Gold Loan forms.
//
// A draft is what "Save Draft" on the new-loan screen produces: a form
// abandoned partway, to be picked up later. Worth seeding precisely because
// it is the one screen state a demo cannot manufacture on the spot without
// leaving a half-typed form behind for the next client.
//
// The drafts are deliberately incomplete in different ways — some with no
// scheme chosen yet, some with no ornaments entered — since a draft that has
// every field filled is indistinguishable from a loan and demonstrates
// nothing.
func seedDrafts(ctx context.Context, d *Deps, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 {
		return nil
	}

	for i := 0; i < 10; i++ {
		customerID := st.customerIDs[i%len(st.customerIDs)]
		in := loan.DraftInput{
			BranchID:   st.branchIDs[i%len(st.branchIDs)],
			CustomerID: &customerID,
		}

		// Every third draft has not reached the scheme step yet.
		if i%3 != 0 && len(st.schemeIDs) > 0 {
			schemeID := st.schemeIDs[i%len(st.schemeIDs)]
			in.SchemeID = &schemeID
		}
		// Every fourth has no ornaments keyed in yet.
		if i%4 != 0 {
			f := ornamentFixtures[i%len(ornamentFixtures)]
			in.Ornaments = []loan.DraftOrnamentInput{{
				// A draft has no deduction-weight field: the deduction is
				// worked out at appraisal, which has not happened yet.
				Name:        f.Name,
				Purity:      f.Purity,
				GrossWeight: f.Gross,
				Quantity:    f.Quantity,
			}}
		}

		if _, err := d.loanSvc.SaveDraft(ctx, st.keep.adminID, in); err != nil {
			return fmt.Errorf("save loan draft %d: %w", i+1, err)
		}
	}

	rep.created("loan drafts", 10)
	return nil
}
