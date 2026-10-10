package routers

import (
	"cloudhouse/backend/auth"
	packet "cloudhouse/backend/modules/Packet/controllers"

	"github.com/labstack/echo/v4"
)

var packetPath = "/api/v1/users/:user_id/packets"

func PacketRoutes(e *echo.Echo) *echo.Echo {
	perms := auth.CRUDPermissions("packets")
	e.GET(packetPath, packet.ListPackets, auth.Staff(perms.Read)...)
	e.GET(packetPath+"/by-code/:code", packet.GetPacketByCode, auth.Staff(perms.Read)...)
	e.GET(packetPath+"/:id", packet.GetPacketById, auth.Staff(perms.Read)...)
	e.GET(packetPath+"/:id/movements", packet.ListPacketMovements, auth.Staff(perms.Read)...)
	e.POST(packetPath+"/:id/movements", packet.RecordPacketMovement, auth.Staff(perms.Update)...)
	return e
}
