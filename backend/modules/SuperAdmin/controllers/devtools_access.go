package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var devToolsPinPattern = regexp.MustCompile(`^\d{4,6}$`)

type setDevToolsPinRequest struct {
	Pin    string `json:"pin"`
	Reason string `json:"reason"`
}

type devToolsPinView struct {
	Pin       string `json:"pin"`
	IsSet     bool   `json:"is_set"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

// GetDevToolsPin reveals the current platform-wide PIN (reversibly
// encrypted, not hashed, by design).
func GetDevToolsPin(c echo.Context) error {
	var row commonModels.DevToolsAccess
	err := config.BaseDB.WithContext(auth.RequestContext(c)).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return common.Success(c, http.StatusOK, devToolsPinView{IsSet: false})
	}
	if err != nil {
		return common.FailErr(c, err)
	}
	pin, err := config.SettingsCipher.Decrypt(row.EncryptedPin)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, devToolsPinView{
		Pin:       pin,
		IsSet:     true,
		UpdatedAt: row.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	})
}

// SetDevToolsPin replaces the one platform-wide DevTools PIN.
func SetDevToolsPin(c echo.Context) error {
	var req setDevToolsPinRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	if !devToolsPinPattern.MatchString(req.Pin) {
		return common.FailErr(c, common.NewBadRequest("pin must be 4-6 digits"))
	}
	encrypted, err := config.SettingsCipher.Encrypt(req.Pin)
	if err != nil {
		return common.FailErr(c, err)
	}

	row := commonModels.DevToolsAccess{ID: 1, EncryptedPin: encrypted, UpdatedAt: time.Now()}
	err = config.BaseDB.WithContext(auth.RequestContext(c)).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns([]string{"encrypted_pin", "updated_at"}),
		}).
		Create(&row).Error
	if err != nil {
		return common.FailErr(c, err)
	}

	auditBusiness(auth.RequestContext(c), actor(c), "set_devtools_pin", nil, "", "", optionalReason(req.Reason))
	return common.Success(c, http.StatusOK, echo.Map{"updated": true})
}
