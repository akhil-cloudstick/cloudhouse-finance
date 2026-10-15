package routers

import (
	"cloudhouse/backend/auth"
	cash "cloudhouse/backend/modules/Cash/controllers"

	"github.com/labstack/echo/v4"
)

var expensePath = "/api/v1/users/:user_id/expenses"

func ExpenseRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("cash")
	e.POST(expensePath, cash.RecordExpense, auth.Staff(perms.Create)...)
	e.GET(expensePath, cash.ListExpenses, auth.Staff(perms.Read)...)
	e.GET(expensePath+"/export", cash.ExportExpense, auth.Staff(perms.Read, perms.Export)...)
	e.GET(expensePath+"/:id", cash.GetExpenseById, auth.Staff(perms.Read)...)
	e.GET(expensePath+"/:id/entry", cash.GetExpenseEntry, auth.Staff(perms.Read)...)
	// Editing an expense rewrites money records, so it needs the same right as recording one.
	e.PUT(expensePath+"/:id", cash.UpdateExpense, auth.Staff(perms.Create)...)
	e.PATCH(expensePath+"/:id/approve", cash.ApproveExpense, auth.Staff(perms.Update)...)
	e.PATCH(expensePath+"/:id/reject", cash.RejectExpense, auth.Staff(perms.Update)...)
	return e
}
