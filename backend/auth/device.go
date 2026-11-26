package auth

import (
	"bytes"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	headerDeviceID        = "X-Device-Id"
	headerDeviceSignature = "X-Device-Signature"
)

var (
	errDeviceUnknown  = errors.New("this PC is not registered")
	errDeviceDisabled = errors.New("this PC has been switched off")
	errDeviceBadSig   = errors.New("the entry could not be verified as coming from this PC")
)

// RegisterDevice records a PC on its first online sign-in and returns its id and signing key. The key is
// returned once, here. Registering the same machine again keeps its id and issues a fresh key, so a PC that
// lost its device file can recover without leaving a second row behind.
func RegisterDevice(ctx context.Context, machineID, name string, branchID, employeeID uint) (id uint, key string, err error) {
	machineID = strings.TrimSpace(machineID)
	name = strings.TrimSpace(name)
	if machineID == "" || len(machineID) > 120 {
		return 0, "", errors.New("a machine id is required")
	}
	if name == "" {
		name = "PC"
	}
	if len(name) > 120 {
		name = name[:120]
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return 0, "", err
	}
	key = hex.EncodeToString(raw)
	sealed, err := config.SettingsCipher.Encrypt(key)
	if err != nil {
		return 0, "", err
	}
	row := commonModels.Device{Name: name, MachineID: machineID, SecretEncrypted: sealed, Enabled: true}
	if branchID != 0 {
		row.BranchID = &branchID
	}
	if employeeID != 0 {
		row.RegisteredByEmployeeID = &employeeID
	}
	db := config.DB.WithContext(ctx)
	var existing commonModels.Device
	switch err := db.Where("machine_id = ?", machineID).First(&existing).Error; {
	case err == nil:
		if !existing.Enabled {
			return 0, "", errDeviceDisabled
		}
		upd := map[string]any{"secret_encrypted": sealed, "name": name, "updated_at": time.Now()}
		if err := db.Model(&commonModels.Device{}).Where("id = ?", existing.ID).Updates(upd).Error; err != nil {
			return 0, "", err
		}
		return existing.ID, key, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		if err := db.Clauses(clause.Returning{}).Create(&row).Error; err != nil {
			return 0, "", err
		}
		return row.ID, key, nil
	default:
		return 0, "", err
	}
}

// signature is the hex HMAC-SHA256 of the request body under the device key.
func signature(key string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// verifyDevice checks an entry replayed from a PC's outbox: the PC exists in this business, is switched on,
// and signed exactly these body bytes with its own key. The body is read and put back for the handler.
func verifyDevice(c echo.Context) error {
	req := c.Request()
	rawID := strings.TrimSpace(req.Header.Get(headerDeviceID))
	sig := strings.TrimSpace(req.Header.Get(headerDeviceSignature))
	id, perr := strconv.ParseUint(strings.TrimPrefix(rawID, "dev_"), 10, 64)
	if rawID == "" || sig == "" || perr != nil {
		return errDeviceUnknown
	}
	var body []byte
	if req.Body != nil {
		var err error
		if body, err = io.ReadAll(req.Body); err != nil {
			return err
		}
		_ = req.Body.Close()
		req.Body = io.NopCloser(bytes.NewReader(body))
	}
	ctx := RequestContext(c)
	var d commonModels.Device
	if err := config.DB.WithContext(ctx).Where("id = ?", id).First(&d).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errDeviceUnknown
		}
		return err
	}
	if !d.Enabled {
		return errDeviceDisabled
	}
	key, err := config.SettingsCipher.Decrypt(d.SecretEncrypted)
	if err != nil {
		return err
	}
	if !hmac.Equal([]byte(signature(key, body)), []byte(strings.ToLower(sig))) {
		return errDeviceBadSig
	}
	touchDevice(ctx, d.ID)
	return nil
}

func touchDevice(ctx context.Context, id uint) {
	now := time.Now()
	if err := config.DB.WithContext(ctx).Model(&commonModels.Device{}).Where("id = ?", id).Update("last_seen_at", now).Error; err != nil {
		log.Printf("touching device %d: %v", id, err)
	}
}

func deviceFailure(c echo.Context, err error) error {
	switch {
	case errors.Is(err, errDeviceDisabled):
		return failAbort(c, http.StatusForbidden, err.Error())
	case errors.Is(err, errDeviceUnknown), errors.Is(err, errDeviceBadSig):
		return failAbort(c, http.StatusUnauthorized, err.Error())
	default:
		log.Printf("verifying device: %v", err)
		return failAbort(c, http.StatusServiceUnavailable, "the service is busy — please try again in a moment")
	}
}

// DeviceRegistrationInput is the body of the registration call.
type DeviceRegistrationInput struct {
	MachineID string `json:"machine_id"`
	Name      string `json:"name"`
}
