package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/modules/Loan/models"
)

func init() {
	common.LoansForCustomer = LoansForCustomer
	common.HardDeleteLoan = PurgeLoan
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
	l.RateTierLevel = 0
	l.ArrearsSince = nil
	l.ServiceChargeType = sch.ServiceChargeType
	l.ServiceChargeValue = sch.ServiceChargeValue
	l.ServiceChargeMode = sch.ServiceChargeMode
}
