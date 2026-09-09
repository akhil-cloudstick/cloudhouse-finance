package demoseed

import (
	"context"
	"fmt"
	"time"

	"cloudhouse/backend/internal/platform"
)

// state carries the ids each step creates forward to the steps that need
// them. Passed by pointer through the whole run.
type state struct {
	tenantID uint
	clk      clock
	keep     *preserved

	// adminRoleID is the Administrator role's id in THIS business. Every
	// approval the seeder performs acts as the admin, and the sanction chain
	// authorises on role id, not role name.
	adminRoleID uint

	// branchIDs[0] is always the preserved Head Office, so any step that
	// wants "the main branch" can use branchIDs[0] and any step spreading
	// records across branches can range over the slice.
	branchIDs   []uint
	employeeIDs []uint
	customerIDs []uint
	schemeIDs   []uint
	lockerIDs   []uint
	bankIDs     []uint
	loanIDs     []uint
	planIDs     []uint
	uploadKeys  []string
}

// step is one named phase of the reseed. Named because a failure halfway
// through a reseed needs to say WHICH phase, so the operator knows whether
// the demo is usable or needs another reset.
type step struct {
	name string
	run  func(context.Context, *Deps, *state, *Report) error
}

// Progress reports one completed phase of a reset.
//
// It exists because a reset takes several seconds and does a lot of work, and
// a UI with no signal during that is indistinguishable from a hung one. The
// phases are the same named steps the error messages use, so what the
// operator watches tick past is the real sequence rather than a timer
// pretending to be one.
type Progress struct {
	// Step is the phase just finished, in the same words as steps().
	Step string `json:"step"`
	// Index is 1-based and counts completed phases; Total includes the wipe.
	Index int `json:"index"`
	Total int `json:"total"`
}

// ProgressFunc is called once per completed phase. It runs on the goroutine
// driving the reset, so an implementation that blocks slows the reset down.
type ProgressFunc func(Progress)

// Reset wipes the business named by the tenant on ctx and reseeds it.
//
// The tenant comes from the context and nowhere else — not a parameter, not a
// request body. That is what stops the CLI and the HTTP handler from
// diverging on scoping, and it means the endpoint cannot be tricked into
// wiping a business other than the caller's own.
func Reset(ctx context.Context, d *Deps) (*Report, error) {
	return ResetWithProgress(ctx, d, nil)
}

// ResetWithProgress is Reset with a callback after each phase. A nil callback
// is the plain Reset behaviour, which is what the CLI uses.
func ResetWithProgress(ctx context.Context, d *Deps, onProgress ProgressFunc) (*Report, error) {
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok || tenantID == 0 {
		return nil, fmt.Errorf("demoseed: no business on the context — call platform.WithTenant first")
	}

	started := time.Now()
	rep := newReport()
	st := &state{
		tenantID: tenantID,
		// One time.Now() for the entire run. See clock's doc comment.
		clk: newClock(started),
	}

	keep, err := wipe(ctx, d, tenantID, rep)
	if err != nil {
		return nil, err
	}
	st.keep = keep

	// Files come out after the delete transaction has committed, so a
	// rolled-back wipe never loses them.
	files, err := removeUploadFiles(ctx, d, keep.uploadKeys)
	if err != nil {
		return nil, err
	}
	rep.FilesRemoved = files

	// The reseed is deliberately NOT one transaction. personalloan and
	// investment open their own transactions on the root handle (which would
	// not join an outer one), and loan.Service.Create derives its loan number
	// from a COUNT that has to see previously committed rows. Wrapping the
	// whole thing would produce visibility bugs, not atomicity. A failure
	// mid-way is recoverable by running the reset again, which wipes first.
	all := steps()
	// +1 for the wipe, which is a phase the operator waits through too.
	total := len(all) + 1
	report := func(step string, index int) {
		if onProgress != nil {
			onProgress(Progress{Step: step, Index: index, Total: total})
		}
	}
	report("clearing the old data", 1)

	for i, s := range all {
		if err := s.run(ctx, d, st, rep); err != nil {
			return nil, fmt.Errorf("reseed step %q: %w", s.name, err)
		}
		report(s.name, i+2)
	}

	rep.AdminUsername = adminUsername
	rep.DurationMS = time.Since(started).Milliseconds()
	rep.SeededAt = started.Format(time.RFC3339)
	return rep, nil
}

// steps is the reseed order, and the order is forced by real dependencies
// rather than taste:
//
//   - grants first, because every later step that approves anything is
//     permission-checked against them;
//   - branches before employees, because employees.branch_id is NOT NULL;
//   - gold rates before ANY loan, because loan.Service.Create refuses to run
//     without a rate dated today;
//   - loans before packets/pledges/auctions/requests, which all hang off a
//     loan;
//   - payments after the sanction chain, since a pending loan takes none.
func steps() []step {
	return []step{
		{"grants", seedGrants},
		{"branches", seedBranches},
		{"employees", seedEmployees},
		{"masters", seedMasters},
		{"gold rates", seedGoldRates},
		{"schemes", seedSchemes},
		{"customers", seedCustomers},
		{"uploads", seedUploads},
		{"gold loans", seedLoans},
		{"appraisals", seedAppraisals},
		{"payments", seedPayments},
		{"loan drafts", seedDrafts},
		{"packets and pledges", seedPacketsAndPledges},
		{"loan requests", seedLoanRequests},
		{"auctions", seedAuctions},
		{"personal loans", seedPersonalLoans},
		{"investments", seedInvestments},
		{"cash and expenses", seedCashAndExpenses},
		{"reminders", seedReminders},
		{"messages and audit", seedCommsAndAudit},
		{"dashboard snapshots", seedSnapshots},
		{"code sequences", seedSequences},
	}
}
