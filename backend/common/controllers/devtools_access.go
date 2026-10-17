package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// Unlocks the desktop app's DevTools via the one platform-wide PIN. Public,
// no session — called before any login exists. Attempts are throttled
// per-IP in-memory since a 4-6 digit PIN is brute-forceable otherwise.

const (
	devToolsMaxAttempts  = 5
	devToolsLockDuration = 15 * time.Minute
)

type devToolsAttemptState struct {
	failures  int
	lockUntil time.Time
}

var (
	devToolsAttemptsMu sync.Mutex
	devToolsAttempts   = map[string]*devToolsAttemptState{}
)

func devToolsLocked(key string) bool {
	devToolsAttemptsMu.Lock()
	defer devToolsAttemptsMu.Unlock()
	st := devToolsAttempts[key]
	return st != nil && time.Now().Before(st.lockUntil)
}

func devToolsRecordFailure(key string) {
	devToolsAttemptsMu.Lock()
	defer devToolsAttemptsMu.Unlock()
	st := devToolsAttempts[key]
	if st == nil {
		st = &devToolsAttemptState{}
		devToolsAttempts[key] = st
	}
	st.failures++
	if st.failures >= devToolsMaxAttempts {
		st.lockUntil = time.Now().Add(devToolsLockDuration)
		st.failures = 0
	}
}

func devToolsClearFailures(key string) {
	devToolsAttemptsMu.Lock()
	defer devToolsAttemptsMu.Unlock()
	delete(devToolsAttempts, key)
}

type unlockDevToolsRequest struct {
	Pin string `json:"pin"`
}

// UnlockDevTools checks the PIN; responds only success/failure.
func UnlockDevTools(c echo.Context) error {
	key := c.RealIP()
	if devToolsLocked(key) {
		return c.JSON(http.StatusTooManyRequests, echo.Map{"success": false, "error": "too many attempts, try again later"})
	}

	var req unlockDevToolsRequest
	if err := BindJSON(c, &req); err != nil || req.Pin == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "pin is required"})
	}

	var row commonModels.DevToolsAccess
	err := config.BaseDB.WithContext(c.Request().Context()).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		devToolsRecordFailure(key)
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "incorrect pin"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"success": false, "error": "unable to verify pin"})
	}

	current, err := config.SettingsCipher.Decrypt(row.EncryptedPin)
	if err != nil || current != req.Pin {
		devToolsRecordFailure(key)
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "incorrect pin"})
	}

	devToolsClearFailures(key)
	return Success(c, http.StatusOK, echo.Map{"unlocked": true})
}
