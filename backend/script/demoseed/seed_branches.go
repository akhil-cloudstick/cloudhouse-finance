package demoseed

import (
	"context"
	"fmt"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/employee"
)

// seedBranches adds nine branches alongside the preserved Head Office.
//
// # WHY THE REPOSITORY AND NOT branch.Service.Create
//
// branch.Service.Create calls tenant.Repository.ReserveBranchSlot, which
// enforces the subscription tier's branch quota. Those quotas are Starter 1,
// Growth 3, Enterprise 10 — so ten branches is exactly at the ceiling on the
// largest tier and flatly impossible on the other two. A demo dataset that
// silently shrinks to one branch because the business is on Starter would be
// a confusing failure, and quota enforcement is not what this seeder is here
// to demonstrate. The repository create is the same insert without the
// reservation.
//
// The trade-off is that the audit-log entry Service.Create would have written
// is not produced. seedCommsAndAudit adds branch-lifecycle entries explicitly
// instead, so the audit log still shows branch activity.
func seedBranches(ctx context.Context, d *Deps, st *state, rep *Report) error {
	// The admin's own branch survived the wipe and is index 0, so every later
	// step can treat branchIDs[0] as the main branch.
	st.branchIDs = append(st.branchIDs, st.keep.adminBranchID)

	for _, f := range branchFixtures {
		b := branch.Branch{
			Name:     f.Name,
			Code:     f.Code,
			Address:  f.Address,
			Phone:    f.Phone,
			IsActive: f.Active,
		}
		b.TenantID = st.tenantID
		if err := d.branchRepo.Create(ctx, &b); err != nil {
			return fmt.Errorf("create branch %q: %w", f.Name, err)
		}
		// Only active branches join the rotation. Handing a deactivated
		// branch to a later step would create loans nobody can find, since
		// the branch filters exclude it.
		if f.Active {
			st.branchIDs = append(st.branchIDs, b.ID)
		}
	}
	rep.created("branches", len(branchFixtures)+1)
	return nil
}

// seedEmployees creates the demo staff. The bootstrap admin is neither
// created nor modified here — it survived the wipe untouched.
//
// Goes through employee.Service.Create rather than the repository for three
// things the repository would not do: resolving the role name to this
// business's own role id, generating the EMP-nn code, and writing an
// audit-log entry per hire. Passing the admin's id as the actor is what makes
// those audit entries attribute correctly.
//
// This is the slowest step in the reseed. Each login is a bcrypt hash at
// cost 12, so eleven of them is a couple of seconds — the bulk of the
// endpoint's response time.
func seedEmployees(ctx context.Context, d *Deps, st *state, rep *Report) error {
	for i, f := range employeeFixtures {
		in := employee.CreateInput{
			Name:     f.Name,
			Role:     f.Role,
			BranchID: st.branchIDs[i%len(st.branchIDs)],
			Phone:    f.Phone,
			Username: f.Username,
			Password: demoPassword,
		}
		emp, err := d.employeeSvc.Create(ctx, in, st.keep.adminID)
		if err != nil {
			return fmt.Errorf("create employee %q: %w", f.Name, err)
		}
		st.employeeIDs = append(st.employeeIDs, emp.ID)
	}
	rep.created("employees", len(employeeFixtures))
	return nil
}
