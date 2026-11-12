package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"

	"github.com/labstack/echo/v4"
)

var investorPath = "/api/v1/users/:user_id/investors"

// InvestorRoutes: investors are their own records, managed from the Investments area, so they
// are gated by the investment permissions and the Investments module — not the customer ones.
func InvestorRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("investments")
	module := auth.RequireTenantModule(commonModels.ModuleInvestments)
	e.POST(investorPath, common.CreateInvestor, auth.Staff(module, perms.Create)...)
	e.GET(investorPath, common.ListInvestors, auth.Staff(module, perms.Read)...)
	e.GET(investorPath+"/by-code/:code", common.GetInvestorByCode, auth.Staff(module, perms.Read)...)
	e.GET(investorPath+"/:id", common.GetInvestorById, auth.Staff(module, perms.Read)...)
	e.GET(investorPath+"/:id/aadhaar-full", common.GetInvestorAadhaar, auth.Staff(module, perms.Update)...)
	e.PATCH(investorPath+"/:id/update", common.UpdateInvestor, auth.Staff(module, perms.Update)...)
	e.DELETE(investorPath+"/:id/hard-delete", common.HardDeleteInvestor, auth.Staff(module, perms.Delete)...)
	return e
}
