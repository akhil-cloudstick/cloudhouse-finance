package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"

	"github.com/labstack/echo/v4"
)

var branchPath = "/api/v1/users/:user_id/branches"

func BranchRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("branches")
	e.POST(branchPath, common.CreateBranch, auth.Staff(auth.RequireTenantModule(commonModels.ModuleBranches), perms.Create)...)
	e.GET(branchPath, common.ListBranches, auth.Staff(perms.Read)...)
	e.GET(branchPath+"/switchable", common.ListSwitchableBranches, auth.Staff(perms.Read)...)
	e.GET(branchPath+"/quota", common.GetBranchQuota, auth.Staff(perms.Read)...)
	e.GET(branchPath+"/:id", common.GetBranchById, auth.Staff(perms.Read)...)
	e.PATCH(branchPath+"/:id/update", common.UpdateBranch, auth.Staff(auth.RequireTenantModule(commonModels.ModuleBranches), perms.Update)...)
	e.DELETE(branchPath+"/:id/delete", common.DeleteBranch, auth.Staff(auth.RequireTenantModule(commonModels.ModuleBranches), perms.Delete)...)
	return e
}
