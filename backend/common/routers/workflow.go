package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"

	"github.com/labstack/echo/v4"
)

var workflowPath = "/api/v1/users/:user_id/approval-workflow"

func WorkflowRoutes(e *echo.Echo) *echo.Echo {
	e.GET(workflowPath, common.ListWorkflows, auth.Staff()...)
	e.GET(workflowPath+"/categories", common.ListWorkflowCategories, auth.Staff(auth.RequirePermission("can view role and permission module"))...)
	e.PATCH(workflowPath+"/categories/:category/update", common.UpdateWorkflowCategory, auth.Staff(auth.RequirePermission("can update role"))...)
	return e
}
