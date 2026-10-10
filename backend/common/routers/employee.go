package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var employeePath = "/api/v1/users/:user_id/employees"

func EmployeeRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("employees")
	e.POST(employeePath, common.CreateEmployee, auth.Staff(perms.Create)...)
	e.GET(employeePath, common.ListEmployees, auth.Staff(perms.Read)...)
	e.GET(employeePath+"/:id", common.GetEmployeeById, auth.Staff(perms.Read)...)
	e.PATCH(employeePath+"/:id/update", common.UpdateEmployee, auth.Staff(perms.Update)...)
	e.DELETE(employeePath+"/:id/delete", common.DeleteEmployee, auth.Staff(perms.Delete)...)
	return e
}
