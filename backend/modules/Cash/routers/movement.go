package routers

import (
	"cloudhouse/backend/auth"
	cash "cloudhouse/backend/modules/Cash/controllers"

	"github.com/labstack/echo/v4"
)

var movementPath = "/api/v1/users/:user_id/cash-movements"

func MovementRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("cash")
	e.POST(movementPath, cash.RecordMovement, auth.Staff(perms.Create)...)
	e.POST(movementPath+"/self-transfer", cash.RecordSelfTransfer, auth.Staff(perms.Create)...)
	e.GET(movementPath, cash.ListMovements, auth.Staff(perms.Read)...)
	e.GET(movementPath+"/export", cash.ExportMovements, auth.Staff(perms.Read, perms.Export)...)
	e.GET(movementPath+"/transactions/bank/:bank_id", cash.ListMovementsByBank, auth.Staff(perms.Read, perms.ExportQuery)...)
	e.GET(movementPath+"/transactions/bank/:bank_id/export", cash.ExportMovementsByBank, auth.Staff(perms.Read, perms.Export)...)
	e.GET(movementPath+"/transactions/customer/:customer_id", cash.ListMovementsByCustomer, auth.Staff(perms.Read, perms.ExportQuery, cash.LedgerFocus())...)
	e.GET(movementPath+"/transactions/customer/:customer_id/export", cash.ExportMovementsByCustomer, auth.Staff(perms.Read, perms.Export)...)
	e.GET(movementPath+"/transactions/branch/:id", cash.ListMovementsByBranch, auth.Staff(auth.RequirePermission("can view branch ledger"), perms.ExportQuery, cash.LedgerFocus())...)
	e.GET(movementPath+"/transactions/branch/:id/export", cash.ExportMovementsByBranch, auth.Staff(auth.RequirePermission("can view branch ledger"), perms.Export)...)
	e.GET(movementPath+"/cash-ledger", cash.GetCashLedger, auth.Staff(perms.Read, perms.ExportQuery, cash.LedgerFocus())...)
	e.GET(movementPath+"/mode-ledger", cash.GetModeLedger, auth.Staff(perms.Read, perms.ExportQuery, cash.LedgerFocus())...)
	e.GET(movementPath+"/loan-sources", cash.ListLoanSources, auth.Staff(perms.Read)...)
	e.GET(movementPath+"/:id", cash.GetMovementById, auth.Staff(perms.Read)...)
	e.GET(movementPath+"/:id/entry", cash.GetMovementEntry, auth.Staff(perms.Read)...)
	// Editing a cash-in, debit or self transfer from the ledger needs no permission of its own.
	e.PUT(movementPath+"/:id", cash.UpdateMovement, auth.Staff()...)
	e.PATCH(movementPath+"/:id/status", cash.UpdateMovementStatus, auth.Staff(perms.Update)...)
	return e
}
