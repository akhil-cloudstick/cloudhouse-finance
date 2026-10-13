package routers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	whatsapp "cloudhouse/backend/modules/WhatsApp/controllers"

	"github.com/labstack/echo/v4"
)

var whatsappPath = "/api/v1/users/:user_id/integrations/whatsapp"

func WhatsAppRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("settings")
	gate := auth.RequireTenantModule(commonModels.ModuleWhatsApp)
	e.GET(whatsappPath, whatsapp.GetWhatsAppSession, auth.Staff(gate, perms.Read)...)
	e.GET(whatsappPath+"/qr", whatsapp.GetWhatsAppQR, auth.Staff(gate, perms.Read)...)
	e.POST(whatsappPath+"/connect", whatsapp.ConnectWhatsAppSession, auth.Staff(gate, perms.Update)...)
	e.POST(whatsappPath+"/pairing-code", whatsapp.RequestWhatsAppPairingCode, auth.Staff(gate, perms.Update)...)
	e.POST(whatsappPath+"/disconnect", whatsapp.DisconnectWhatsAppSession, auth.Staff(gate, perms.Update)...)
	return e
}
