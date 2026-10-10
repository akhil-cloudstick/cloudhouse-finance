package routers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	investment "cloudhouse/backend/modules/Investment/controllers"

	"github.com/labstack/echo/v4"
)

var investmentPlanPath = "/api/v1/users/:user_id/investment-plans"

func InvestmentPlanRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("investments")
	e.POST(investmentPlanPath, investment.CreateInvestmentPlan, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Create)...)
	e.GET(investmentPlanPath, investment.ListInvestmentPlans, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	e.GET(investmentPlanPath+"/:id", investment.GetInvestmentPlan, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Read)...)
	e.PATCH(investmentPlanPath+"/:id/update", investment.UpdateInvestmentPlan, auth.Staff(auth.RequireTenantModule(commonModels.ModuleInvestments), perms.Update)...)
	return e
}
