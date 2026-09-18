package demoseed

import (
	"context"
	"fmt"

	"cloudhouse/backend/internal/investment"
	"cloudhouse/backend/internal/personalloan"
	"cloudhouse/backend/internal/platform"
)

// personalLoanFixture is one money-lending (non-gold) loan.
type personalLoanFixture struct {
	Principal    float64
	InterestType string
	Value        float64
	Frequency    string
	Tenure       int
	// openedDaysAgo is how far back the loan starts, which is what puts its
	// installment schedule partly in the past and partly ahead.
	openedDaysAgo int
}

var personalLoanFixtures = []personalLoanFixture{
	{50000, "Flat", 2, "Monthly", 12, 200},
	{75000, "Percentage", 18, "Monthly", 12, 180},
	{30000, "Flat", 1.5, "Monthly", 6, 150},
	{120000, "Percentage", 15, "Monthly", 24, 300},
	{45000, "Flat", 2.5, "Weekly", 20, 90},
	{25000, "Percentage", 24, "Weekly", 12, 60},
	{60000, "Flat", 2, "Monthly", 18, 240},
	{90000, "Percentage", 16, "Monthly", 12, 120},
	{15000, "Flat", 3, "Daily", 30, 25},
	{200000, "Percentage", 14, "Monthly", 24, 330},
	{35000, "Flat", 2, "Weekly", 16, 100},
	{80000, "Percentage", 17, "Monthly", 12, 210},
}

// seedPersonalLoans creates the money-lending book.
//
// Goes through personalloan.Service.CreateLoan because it generates the PL-
// number, computes the interest and installment amounts, and writes the whole
// installment schedule in one transaction. That schedule is the bulk of the
// row count here — twelve loans produce well over a hundred installments.
func seedPersonalLoans(ctx context.Context, d *Deps, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 {
		return fmt.Errorf("no customers to attach personal loans to")
	}

	created := 0
	ids := make([]uint, 0, len(personalLoanFixtures))
	for i, f := range personalLoanFixtures {
		l, err := d.personalSvc.CreateLoan(ctx, personalloan.CreateInput{
			BranchID:            st.branchIDs[i%len(st.branchIDs)],
			CustomerID:          st.customerIDs[i%len(st.customerIDs)],
			PrincipalAmount:     f.Principal,
			InterestType:        f.InterestType,
			InterestValue:       f.Value,
			Frequency:           f.Frequency,
			TenureCount:         f.Tenure,
			CreatedByEmployeeID: st.keep.adminID,
		})
		if err != nil {
			return fmt.Errorf("create personal loan %d: %w", i+1, err)
		}
		ids = append(ids, l.ID)
		created++
	}
	rep.created("personal loans", created)

	// A few receipts, so the schedule shows Paid and PartiallyPaid
	// installments rather than everything Pending.
	payments := 0
	for i := range ids {
		// One receipt on every loan, and a second on every other one, so the
		// schedule shows Paid, PartiallyPaid and Pending installments rather
		// than a uniform column.
		receipts := 1
		if i%2 == 0 {
			receipts = 2
		}
		amount := personalLoanFixtures[i].Principal / float64(personalLoanFixtures[i].Tenure)
		for r := 0; r < receipts; r++ {
			if _, err := d.personalSvc.RecordPayment(ctx, ids[i], nil, personalloan.PaymentInput{
				Amount: amount,
				// No PaidOn field: personalloan.Service dates the receipt itself.
				ReceivedByEmployeeID: &st.keep.adminID,
				CashAmount:           amount,
				Description:          "Demo installment receipt",
			}); err != nil {
				return fmt.Errorf("record personal loan payment %d on loan %d: %w", r+1, i+1, err)
			}
			payments++
		}
	}
	rep.created("personal loan payments", payments)

	// Terminal statuses by scoped update. CreateLoan always writes Active,
	// and the paths that reach Closed or Defaulted depend on real elapsed
	// time and a full repayment history — neither of which a seeder can
	// manufacture without inventing payments that would not add up.
	if len(ids) >= 12 {
		terminal := map[uint]string{
			ids[9]:  personalloan.StatusClosed,
			ids[10]: personalloan.StatusClosed,
			ids[11]: personalloan.StatusDefaulted,
		}
		for id, status := range terminal {
			if err := d.db.WithContext(ctx).
				Model(&personalloan.PersonalLoan{}).
				Where("id = ?", id).
				Update("status", status).Error; err != nil {
				return fmt.Errorf("set personal loan %d status: %w", id, err)
			}
		}
	}

	return nil
}

// seedInvestments creates the deposit products and the investments against
// them.
//
// THE TENANT STAMP AT THE END IS NOT OPTIONAL. investments,
// investment_plans and investment_payouts are tenant-scoped models that
// appear in neither platform.tenantScopedTables nor
// migrate.tenantScopedTables, so GORM's stamp callback never fires on them
// and every row lands with tenant_id = 0. Nothing notices today because the
// scope callback does not filter them either — they are simply visible to
// everyone. Leaving them at zero would make the wipe's tenant predicate miss
// them on the next reset, so they are corrected explicitly here.
func seedInvestments(ctx context.Context, d *Deps, st *state, rep *Report) error {
	for _, f := range investmentPlanFixtures {
		p, err := d.investmentSvc.CreatePlan(ctx, investment.PlanInput{
			Name:                f.Name,
			InterestRateType:    f.RateType,
			InterestRatePercent: f.RatePercent,
			PayoutFrequency:     f.PayoutFrequency,
			TenureMonths:        f.TenureMonths,
			MinPrincipal:        f.MinPrincipal,
			IsActive:            f.Active,
		})
		if err != nil {
			return fmt.Errorf("create investment plan %q: %w", f.Name, err)
		}
		if f.Active {
			st.planIDs = append(st.planIDs, p.ID)
		}
	}
	rep.created("investment plans", len(investmentPlanFixtures))

	if len(st.planIDs) == 0 {
		return fmt.Errorf("no active investment plans to invest into")
	}

	// Twelve investments. Principals are comfortably above every plan's
	// minimum so no row is rejected for being under the floor.
	ids := make([]uint, 0, 12)
	for i := 0; i < 12; i++ {
		principal := float64(500000 + i*100000)
		inv, err := d.investmentSvc.CreateInvestment(ctx, investment.CreateInput{
			BranchID:   st.branchIDs[i%len(st.branchIDs)],
			CustomerID: st.customerIDs[i%len(st.customerIDs)],
			PlanID:     st.planIDs[i%len(st.planIDs)],
			// Start dates walk back so some payouts are already due and
			// some are still ahead.
			PrincipalAmount:     principal,
			StartDate:           st.clk.monthsAgo(i % 10),
			CreatedByEmployeeID: st.keep.adminID,
		})
		if err != nil {
			return fmt.Errorf("create investment %d: %w", i+1, err)
		}
		ids = append(ids, inv.ID)
	}
	rep.created("investments", len(ids))

	// The stamp correction described in this function's doc comment. Runs
	// cross-tenant because the rows it is fixing are, by definition, not
	// matched by a tenant predicate yet.
	crossCtx := platform.AllowCrossTenant(ctx)
	for _, table := range []string{"investment_plans", "investments", "investment_payouts"} {
		if err := d.db.WithContext(crossCtx).
			Exec("UPDATE "+table+" SET tenant_id = ? WHERE tenant_id = 0 OR tenant_id IS NULL", st.tenantID).
			Error; err != nil {
			return fmt.Errorf("stamp tenant on %s: %w", table, err)
		}
	}

	// Mark some payouts paid so the payout register is not entirely pending.
	paid := 0
	for i := 0; i < 4 && i < len(ids); i++ {
		payouts, _, err := d.investmentSvc.GetSchedule(ctx, ids[i], nil, 12, 0)
		if err != nil {
			continue
		}
		for j, po := range payouts {
			if j >= 4 || po.DueDate.After(st.clk.today) {
				break
			}
			if _, err := d.investmentSvc.MarkPayoutPaid(ctx, ids[i], po.ID, nil, st.keep.adminID, investment.MarkPayoutPaidInput{CashAmount: po.Amount}); err != nil {
				// A payout that cannot be paid (already paid, or out of
				// order) is not worth failing the whole reset over.
				continue
			}
			paid++
		}
	}
	rep.created("investment payouts paid", paid)

	return nil
}
