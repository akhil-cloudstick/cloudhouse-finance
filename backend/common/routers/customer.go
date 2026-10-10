package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var customerPath = "/api/v1/users/:user_id/customers"

func CustomerRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("customers")
	e.POST(customerPath, common.CreateCustomer, auth.Staff(perms.Create)...)
	e.GET(customerPath, common.ListCustomers, auth.Staff(perms.Read)...)
	e.GET(customerPath+"/:id", common.GetCustomerById, auth.Staff(perms.Read)...)
	e.GET(customerPath+"/:id/aadhaar-full", common.GetCustomerAadhaar, auth.Staff(perms.Update)...)
	e.PATCH(customerPath+"/:id/update", common.UpdateCustomer, auth.Staff(perms.Update)...)
	e.POST(customerPath+"/:id/verify-pan", common.VerifyPAN, auth.Staff(perms.Update)...)
	e.POST(customerPath+"/:id/verify-aadhaar/start", common.StartAadhaarVerify, auth.Staff(perms.Update)...)
	e.POST(customerPath+"/:id/verify-aadhaar/check", common.CheckAadhaarVerify, auth.Staff(perms.Update)...)
	e.DELETE(customerPath+"/:id/hard-delete", common.HardDeleteCustomer, auth.Staff(auth.RequirePermission("can hard delete customer"))...)
	return e
}
