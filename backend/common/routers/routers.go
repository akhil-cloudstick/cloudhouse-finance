package routers

import "github.com/labstack/echo/v4"

func CommonRoutes(e *echo.Echo) *echo.Echo {
	AuditLogRoutes(e)
	AuthRoutes(e)
	AuthzRoutes(e)
	BankRoutes(e)
	BranchRoutes(e)
	BrandingRoutes(e)
	CustomerAppRoutes(e)
	CustomerRoutes(e)
	DemoRoutes(e)
	EmployeeRoutes(e)
	GoldRateRoutes(e)
	OrnamentTypeRoutes(e)
	PublicRoutes(e)
	PurityStandardRoutes(e)
	SchemeRoutes(e)
	SettingsRoutes(e)
	UploadRoutes(e)
	UploadServeRoutes(e)
	WorkflowRoutes(e)
	return e
}
