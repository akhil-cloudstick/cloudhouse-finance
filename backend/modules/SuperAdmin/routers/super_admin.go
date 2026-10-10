package routers

import (
	"cloudhouse/backend/auth"
	superAdmin "cloudhouse/backend/modules/SuperAdmin/controllers"

	"github.com/labstack/echo/v4"
)

var superAdminPath = "/api/v1/superadmin"

func SuperAdminRoutes(e *echo.Echo) *echo.Echo {
	e.POST(superAdminPath+"/login", superAdmin.SuperAdminLogin)
	e.POST(superAdminPath+"/users/:user_id/businesses", superAdmin.CreateBusiness, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/businesses", superAdmin.ListBusinesses, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/businesses/:id", superAdmin.GetBusiness, auth.SuperAdmin()...)
	e.POST(superAdminPath+"/users/:user_id/businesses/:id/suspend", superAdmin.SuspendBusiness, auth.SuperAdmin()...)
	e.POST(superAdminPath+"/users/:user_id/businesses/:id/reactivate", superAdmin.ReactivateBusiness, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/businesses/:id/tier", superAdmin.ChangeTier, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/businesses/:id/expiry", superAdmin.AdjustExpiry, auth.SuperAdmin()...)
	e.DELETE(superAdminPath+"/users/:user_id/businesses/:id/delete", superAdmin.DeleteBusiness, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/businesses/:id/overview", superAdmin.GetBusinessOverview, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/businesses/:id/payments", superAdmin.ListBusinessPayments, auth.SuperAdmin()...)
	e.POST(superAdminPath+"/users/:user_id/businesses/:id/payments", superAdmin.RecordBusinessPayment, auth.SuperAdmin()...)
	e.DELETE(superAdminPath+"/users/:user_id/businesses/:id/payments/:payment_id/delete", superAdmin.DeleteBusinessPayment, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/tiers", superAdmin.ListTiers, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/tiers/:id/price", superAdmin.SetTierPrice, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/catalogue", superAdmin.GetCatalogue, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/businesses/:id/profile", superAdmin.UpdateSuperAdminProfile, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/businesses/:id/branding", superAdmin.SetBranding, auth.SuperAdmin()...)
	e.POST(superAdminPath+"/users/:user_id/businesses/:id/logo", superAdmin.SetLogo, auth.SuperAdmin()...)
	e.DELETE(superAdminPath+"/users/:user_id/businesses/:id/logo", superAdmin.ClearLogo, auth.SuperAdmin()...)
	e.POST(superAdminPath+"/users/:user_id/businesses/:id/signature", superAdmin.SetSignature, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/businesses/:id/signature", superAdmin.GetSignature, auth.SuperAdmin()...)
	e.DELETE(superAdminPath+"/users/:user_id/businesses/:id/signature", superAdmin.ClearSignature, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/businesses/:id/modules", superAdmin.SetModules, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/businesses/:id/languages", superAdmin.SetLanguages, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/businesses/:id/branch-mode", superAdmin.SetBranchMode, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/businesses/:id/admin", superAdmin.GetAdminLogin, auth.SuperAdmin()...)
	e.PATCH(superAdminPath+"/users/:user_id/businesses/:id/admin", superAdmin.UpdateAdminLogin, auth.SuperAdmin()...)
	e.GET(superAdminPath+"/users/:user_id/audit-log", superAdmin.ListAuditLog, auth.SuperAdmin()...)
	return e
}
