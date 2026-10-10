package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var bankPath = "/api/v1/users/:user_id/banks"

func BankRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("banks")
	e.GET(bankPath, common.ListBanks, auth.Staff(perms.Read)...)
	e.POST(bankPath, common.CreateBank, auth.Staff(perms.Create)...)
	e.GET(bankPath+"/:id", common.GetBankById, auth.Staff(perms.Read)...)
	e.PATCH(bankPath+"/:id/update", common.UpdateBank, auth.Staff(perms.Update)...)
	e.DELETE(bankPath+"/:id/delete", common.DeleteBank, auth.Staff(perms.Delete)...)
	e.POST(bankPath+"/:id/merge", common.MergeBank, auth.Staff(perms.Update)...)
	return e
}
