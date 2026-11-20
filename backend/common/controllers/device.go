package controllers

import (
	"cloudhouse/backend/auth"
	"net/http"

	"github.com/labstack/echo/v4"
)

type deviceRegistration struct {
	DeviceID uint   `json:"device_id"`
	Key      string `json:"key"`
}

// RegisterDevice registers the PC the signed-in employee is using. The desktop exe calls it once, online,
// and keeps the returned key; every entry it later replays from its outbox is signed with that key.
func RegisterDevice(c echo.Context) error {
	var in auth.DeviceRegistrationInput
	if err := BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	employeeID, _, _ := auth.ActorFromContext(c)
	branchID := auth.EnforceBranchOnWrite(c, 0)
	id, key, err := auth.RegisterDevice(auth.RequestContext(c), in.MachineID, in.Name, branchID, employeeID)
	if err != nil {
		return FailErr(c, NewBadRequest(err.Error()))
	}
	return Success(c, http.StatusOK, deviceRegistration{DeviceID: id, Key: key})
}
