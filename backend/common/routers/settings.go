package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"

	"github.com/labstack/echo/v4"
)

var settingsPath = "/api/v1/users/:user_id/settings/api-keys"

func SettingsRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("settings")
	e.GET(settingsPath, common.ListSettings, auth.Staff(auth.RequireTenantModule(commonModels.ModuleSettings), perms.Read)...)
	e.GET(settingsPath+"/:category", common.GetSetting, auth.Staff(auth.RequireTenantModule(commonModels.ModuleSettings), perms.Read)...)
	e.PATCH(settingsPath+"/:category/update", common.SetSetting, auth.Staff(auth.RequireTenantModule(commonModels.ModuleSettings), perms.Update)...)
	e.DELETE(settingsPath+"/:category/delete", common.DeleteSetting, auth.Staff(auth.RequireTenantModule(commonModels.ModuleSettings), perms.Delete)...)
	return e
}
