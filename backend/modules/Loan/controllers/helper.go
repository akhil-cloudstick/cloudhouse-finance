package controllers

import (
	"context"

	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
)

func init() {
	common.LoansForCustomer = LoansForCustomer
	common.HardDeleteLoan = PurgeLoan
}

// refreshSchemeLTV points the loan at its scheme's current LTV, so an edit checks the principal against the LTV in
// force now and not the one frozen when the loan was opened. A scheme that no longer exists leaves the loan as it is.
func refreshSchemeLTV(ctx context.Context, l *models.Loan) {
	if sch, err := common.FindSchemeByID(ctx, l.SchemeID); err == nil {
		l.SchemeLTVPercent = sch.LTVPercent
	}
}

func applySchemeSnapshot(l *models.Loan, sch *commonModels.Scheme) {
	l.SchemeCode = sch.Code
	l.SchemeInterestRate = sch.InterestRate
	l.SchemeDurationMonths = sch.DurationMonths
	l.SchemeLTVPercent = sch.LTVPercent
	l.SchemeInterestMethod = sch.InterestMethod
	l.SchemePenalRate = sch.PenalRate
	l.SchemeRateTiers = append([]commonModels.RateTier(nil), sch.RateTiers...)
	l.SchemeMinimumDays = sch.MinimumDays
	l.SchemeAccrualBasis = sch.AccrualBasis
	l.RateTierLevel = 0
	l.ArrearsSince = nil
	l.ServiceChargeType = sch.ServiceChargeType
	l.ServiceChargeValue = sch.ServiceChargeValue
	l.ServiceChargeMode = sch.ServiceChargeMode
}
