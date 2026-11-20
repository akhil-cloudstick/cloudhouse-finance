package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/WhatsApp/models"
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

var (
	nonDigits      = regexp.MustCompile(`\D`)
	pairingPhoneRe = regexp.MustCompile(`^[0-9]{6,15}$`)
	nonSessionChar = regexp.MustCompile(`[^a-z0-9]+`)
	// one connect per business at a time: a second /start while the engine boots fails the session
	connectLocks sync.Map
)

type pairingRequest struct {
	Phone string `json:"phone" binding:"required"`
}

func findSession(ctx context.Context) (*models.Session, error) {
	var s models.Session
	err := config.DB.WithContext(ctx).Order("id asc").First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func removeSession(ctx context.Context, s *models.Session) error {
	return config.DB.WithContext(ctx).Delete(s).Error
}

// ensureSession returns the business's session, creating it in OpenWA the first
// time. If OpenWA lost the session (e.g. it was deleted from its own dashboard)
// the stale row is dropped and a fresh one is created.
func ensureSession(ctx context.Context) (*models.Session, error) {
	s, err := findSession(ctx)
	if err != nil {
		return nil, err
	}
	if s != nil {
		var remote openwaSession
		err := openwaCall(http.MethodGet, "/sessions/"+s.OpenWASessionID, nil, &remote)
		if err == nil {
			return s, nil
		}
		if !isOpenWAStatus(err, http.StatusNotFound) {
			return nil, err
		}
		if err := removeSession(ctx, s); err != nil {
			return nil, err
		}
	}
	var created openwaSession
	if err := openwaCall(http.MethodPost, "/sessions", map[string]string{"name": sessionName(ctx)}, &created); err != nil {
		if isOpenWAStatus(err, http.StatusConflict) {
			return nil, common.NewConflict("a WhatsApp session already exists for this business; ask support to reset it")
		}
		return nil, err
	}
	s = &models.Session{OpenWASessionID: created.ID, Status: created.Status}
	if err := config.DB.WithContext(ctx).Create(s).Error; err != nil {
		return nil, err
	}
	return s, nil
}

// sessionName names the OpenWA session after the business, e.g. "sunrise-gold-loans-12"; the id keeps
// two businesses with the same name apart, and OpenWA allows only letters, digits and hyphens, up to 50.
func sessionName(ctx context.Context) string {
	tenantID, _ := config.TenantFromContext(ctx)
	base := "cloudhouse"
	if t, err := common.FindTenantByID(ctx, tenantID); err == nil {
		if slug := strings.Trim(nonSessionChar.ReplaceAllString(strings.ToLower(t.Name), "-"), "-"); slug != "" {
			base = slug
		}
	}
	suffix := fmt.Sprintf("-%d", tenantID)
	if len(base) > 50-len(suffix) {
		base = strings.TrimRight(base[:50-len(suffix)], "-")
	}
	return base + suffix
}

// refreshSession syncs the stored status/phone with OpenWA and returns the view.
func refreshSession(ctx context.Context, s *models.Session) (*models.SessionView, error) {
	var remote openwaSession
	if err := openwaCall(http.MethodGet, "/sessions/"+s.OpenWASessionID, nil, &remote); err != nil {
		if isOpenWAStatus(err, http.StatusNotFound) {
			if err := removeSession(ctx, s); err != nil {
				return nil, err
			}
			return &models.SessionView{Status: models.StatusNotConnected}, nil
		}
		return nil, err
	}
	if remote.Status != s.Status || remote.Phone != s.Phone {
		s.Status, s.Phone = remote.Status, remote.Phone
		if err := config.DB.WithContext(ctx).Save(s).Error; err != nil {
			return nil, err
		}
	}
	return &models.SessionView{Status: s.Status, Connected: s.Status == models.StatusReady, Phone: s.Phone}, nil
}

func GetWhatsAppSession(c echo.Context) error {
	ctx := auth.RequestContext(c)
	s, err := findSession(ctx)
	if err != nil {
		return common.FailErr(c, err)
	}
	if s == nil {
		return common.Success(c, http.StatusOK, models.SessionView{Status: models.StatusNotConnected})
	}
	view, err := refreshSession(ctx, s)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, view)
}

func ConnectWhatsAppSession(c echo.Context) error {
	ctx := auth.RequestContext(c)
	tenantID, _ := config.TenantFromContext(ctx)
	lock, _ := connectLocks.LoadOrStore(tenantID, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()
	s, err := ensureSession(ctx)
	if err != nil {
		return common.FailErr(c, err)
	}
	view, err := refreshSession(ctx, s)
	if err != nil {
		return common.FailErr(c, err)
	}
	if view.Status == "created" || view.Status == "disconnected" || view.Status == "failed" {
		if err := openwaCall(http.MethodPost, "/sessions/"+s.OpenWASessionID+"/start", nil, nil); err != nil {
			return common.FailErr(c, err)
		}
		if view, err = refreshSession(ctx, s); err != nil {
			return common.FailErr(c, err)
		}
	}
	return common.Success(c, http.StatusOK, view)
}

func GetWhatsAppQR(c echo.Context) error {
	ctx := auth.RequestContext(c)
	s, err := findSession(ctx)
	if err != nil {
		return common.FailErr(c, err)
	}
	if s == nil {
		return common.FailErr(c, common.NewBadRequest("start connecting first"))
	}
	var qr openwaQR
	if err := openwaCall(http.MethodGet, "/sessions/"+s.OpenWASessionID+"/qr", nil, &qr); err != nil {
		if !isOpenWAStatus(err, http.StatusBadRequest) {
			return common.FailErr(c, err)
		}
		// not ready yet, or already linked: report the status so the caller keeps polling or stops
		view, rerr := refreshSession(ctx, s)
		if rerr != nil {
			return common.FailErr(c, rerr)
		}
		return common.Success(c, http.StatusOK, models.QRView{Status: view.Status})
	}
	return common.Success(c, http.StatusOK, models.QRView{QRCode: qr.QRCode, Status: qr.Status})
}

func RequestWhatsAppPairingCode(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req pairingRequest
	if err := c.Bind(&req); err != nil {
		return common.FailErr(c, common.NewBadRequest("phone is required"))
	}
	phone := nonDigits.ReplaceAllString(req.Phone, "")
	if !pairingPhoneRe.MatchString(phone) {
		return common.FailErr(c, common.NewBadRequest("enter the number with its country code, e.g. 919876543210"))
	}
	s, err := findSession(ctx)
	if err != nil {
		return common.FailErr(c, err)
	}
	if s == nil {
		return common.FailErr(c, common.NewBadRequest("start connecting first"))
	}
	var out openwaPairing
	if err := openwaCall(http.MethodPost, "/sessions/"+s.OpenWASessionID+"/pairing-code", map[string]string{"phoneNumber": phone}, &out); err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, models.PairingView{PairingCode: out.PairingCode, Status: out.Status})
}

func DisconnectWhatsAppSession(c echo.Context) error {
	ctx := auth.RequestContext(c)
	s, err := findSession(ctx)
	if err != nil {
		return common.FailErr(c, err)
	}
	if s == nil {
		return common.SuccessMessage(c, http.StatusOK, "WhatsApp is not connected")
	}
	// logout is best effort (the phone may already have unlinked); the delete is what frees the session
	_ = openwaCall(http.MethodPost, "/sessions/"+s.OpenWASessionID+"/logout", nil, nil)
	if err := openwaCall(http.MethodDelete, "/sessions/"+s.OpenWASessionID, nil, nil); err != nil && !isOpenWAStatus(err, http.StatusNotFound) {
		return common.FailErr(c, err)
	}
	if err := removeSession(ctx, s); err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessMessage(c, http.StatusOK, "WhatsApp disconnected")
}
