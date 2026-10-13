package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/CustomerApp/models"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

var (
	ErrCustomerNotFound = common.NewNotFound("no customer account found for this phone number")
)

const (
	otpTTL          = 5 * time.Minute
	sessionTokenTTL = 24 * time.Hour
)

type requestOTPInput struct {
	BusinessCode string `json:"business_code"`
	Phone        string `json:"phone" binding:"required"`
}

type verifyOTPInput struct {
	BusinessCode string `json:"business_code"`
	Phone        string `json:"phone" binding:"required"`
	Code         string `json:"code" binding:"required"`
}

type sessionResponse struct {
	Token    string                        `json:"token"`
	Customer commonModels.CustomerResponse `json:"customer"`
}

type registerDeviceInput struct {
	DeviceID string `json:"device_id" binding:"required"`
}

type deviceLoginInput struct {
	DeviceToken string `json:"device_token" binding:"required"`
}

func upsertOTP(ctx context.Context, rec *models.OTP) error {
	return config.DB.
		WithContext(ctx).Where("phone = ?", rec.Phone).
		Assign(models.OTP{CodeHash: rec.CodeHash, ExpiresAt: rec.ExpiresAt, Attempts: 0}).
		FirstOrCreate(rec).Error
}

func findOTPByPhone(ctx context.Context, phone string) (*models.OTP, error) {
	var rec models.OTP
	if err := config.DB.
		WithContext(ctx).Where("phone = ?", phone).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func incrementOTPAttempts(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Model(&models.OTP{}).Where("id = ?", id).UpdateColumn("attempts", gorm.Expr("attempts + 1")).Error
}

func deleteOTP(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Delete(&models.OTP{}, id).Error
}

func createDeviceToken(ctx context.Context, rec *models.DeviceToken) error {
	return config.DB.
		WithContext(ctx).Create(rec).Error
}

func findDeviceTokenByHash(ctx context.Context, hash string) (*models.DeviceToken, error) {
	var rec models.DeviceToken
	if err := config.DB.
		WithContext(ctx).Where("token_hash = ?", hash).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func touchDeviceToken(ctx context.Context, id uint) error {
	now := time.Now()
	return config.DB.
		WithContext(ctx).Model(&models.DeviceToken{}).Where("id = ?", id).Update("last_used_at", now).Error
}

func revokeDeviceTokensForCustomerDevice(ctx context.Context, customerID uint, deviceID string) error {
	now := time.Now()
	return config.DB.
		WithContext(ctx).Model(&models.DeviceToken{}).
		Where("customer_id = ? AND device_id = ? AND revoked_at IS NULL", customerID, deviceID).
		Update("revoked_at", now).Error
}

func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func generateDeviceToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func requestOTP(ctx context.Context, businessCode, phone string) error {
	tenantID, err := resolveTenant(ctx, businessCode)
	if err != nil {
		return err
	}
	ctx = config.WithTenant(ctx, tenantID)
	phone = strings.TrimSpace(phone)
	cust, err := common.FindByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrCustomerNotFound
		}
		return err
	}
	code, err := generateOTP()
	if err != nil {
		return err
	}
	if err := upsertOTP(ctx, &models.OTP{
		Phone:     phone,
		CodeHash:  hashCode(code),
		ExpiresAt: time.Now().Add(otpTTL),
	}); err != nil {
		return err
	}
	if tenantID, ok := config.TenantFromContext(ctx); ok {
		if err := common.CheckAndRecordUsage(config.BaseDB,
			tenantID, "whatsapp"); err != nil {
			return err
		}
	}
	message := fmt.Sprintf("Your %s app sign-in code is %s. It expires in 5 minutes. Do not share this code with anyone.", businessName(ctx), code)
	sendErr := config.WhatsApp.
		Send(ctx, cust.Phone, message)
	{
		logRec := &commonModels.CommunicationLog{
			RecipientName:     cust.Name,
			RecipientPhone:    cust.Phone,
			ChatID:            common.NormalizeChatID(cust.Phone),
			Channel:           commonModels.ChannelWhatsApp,
			TriggerType:       "otp",
			MessageBody:       message,
			RelatedEntityType: "customer",
			RelatedEntityID:   cust.ID,
			Status:            commonModels.StatusSent,
		}
		if sendErr != nil {
			logRec.Status = commonModels.StatusFailed
			logRec.ErrorMessage = sendErr.Error()
		}
		_ = common.InsertCommLog(ctx, logRec)
	}
	return sendErr
}

func verifyOTP(ctx context.Context, businessCode, phone, code string) (string, *commonModels.Customer, error) {
	tenantID, terr := resolveTenant(ctx, businessCode)
	if terr != nil {
		return "", nil, terr
	}
	ctx = config.WithTenant(ctx, tenantID)
	phone = strings.TrimSpace(phone)
	code = strings.TrimSpace(code)
	cust, err := common.FindByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, common.NewBadRequest("invalid or expired OTP")
		}
		return "", nil, err
	}
	rec, err := findOTPByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, common.NewBadRequest("invalid or expired OTP")
		}
		return "", nil, err
	}
	if rec.Attempts >= 5 {
		return "", nil, common.NewBadRequest("too many incorrect attempts — request a new code")
	}
	if time.Now().After(rec.ExpiresAt) {
		return "", nil, common.NewBadRequest("invalid or expired OTP")
	}
	if subtle.ConstantTimeCompare([]byte(hashCode(code)), []byte(rec.CodeHash)) != 1 {
		_ = incrementOTPAttempts(ctx, rec.ID)
		return "", nil, common.NewBadRequest("invalid or expired OTP")
	}
	_ = deleteOTP(ctx, rec.ID)
	token, err := auth.IssueCustomerToken(cust.ID, cust.TenantID, config.Env.JWTSecret, sessionTokenTTL)
	if err != nil {
		return "", nil, err
	}
	return token, cust, nil
}

func registerDevice(ctx context.Context, customerID uint, deviceID string) (string, error) {
	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return "", common.NewBadRequest("device_id is required")
	}
	if err := revokeDeviceTokensForCustomerDevice(ctx, customerID, deviceID); err != nil {
		return "", err
	}
	raw, err := generateDeviceToken()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(raw))
	if err := createDeviceToken(ctx, &models.DeviceToken{
		CustomerID: customerID,
		DeviceID:   deviceID,
		TokenHash:  hex.EncodeToString(sum[:]),
	}); err != nil {
		return "", err
	}
	return raw, nil
}

func deviceLogin(ctx context.Context, rawToken string) (string, *commonModels.Customer, error) {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return "", nil, common.NewBadRequest("device is not signed in — please sign in again")
	}
	sum := sha256.Sum256([]byte(rawToken))
	rec, err := findDeviceTokenByHash(ctx, hex.EncodeToString(sum[:]))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, common.NewBadRequest("device is not signed in — please sign in again")
		}
		return "", nil, err
	}
	if rec.RevokedAt != nil {
		return "", nil, common.NewBadRequest("device is not signed in — please sign in again")
	}
	cust, err := common.FindCustomerByID(ctx, rec.CustomerID)
	if err != nil {
		return "", nil, common.NewBadRequest("device is not signed in — please sign in again")
	}
	_ = touchDeviceToken(ctx, rec.ID)
	token, err := auth.IssueCustomerToken(cust.ID, cust.TenantID, config.Env.JWTSecret, sessionTokenTTL)
	if err != nil {
		return "", nil, err
	}
	return token, cust, nil
}

func refreshCustomerAuth(ctx context.Context, customerID uint) (string, error) {
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return "", config.ErrNoTenantInContext
	}
	return auth.IssueCustomerToken(customerID, tenantID, config.Env.JWTSecret, sessionTokenTTL)
}

func resolveTenant(ctx context.Context, code string) (uint, error) {
	lookupCtx := config.AllowCrossTenant(ctx)
	code = strings.TrimSpace(code)
	if code != "" {
		t, err := common.FindByCode(lookupCtx, code)
		if err != nil {
			return 0, ErrCustomerNotFound
		}
		return t.ID, nil
	}
	if host, ok := auth.RequestHostFromContext(ctx); ok {
		if t, err := common.FindByHostLabel(lookupCtx, host); err == nil && t != nil {
			return t.ID, nil
		}
		if t, err := common.FindByAppURL(lookupCtx, host); err == nil && t != nil {
			return t.ID, nil
		}
	}
	all, err := common.FindTenants(lookupCtx)
	if err != nil {
		return 0, err
	}
	if len(all) == 1 {
		return all[0].ID, nil
	}
	return 0, common.NewBadRequest("please open your lender's app link")
}

func businessName(ctx context.Context) string {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return "your lender"
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil || t.Name == "" {
		return "your lender"
	}
	return t.Name
}

func customerIDFromContext(c echo.Context) (uint, bool) {
	v, ok := common.Get(c, "customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

func RequestOTP(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var in requestOTPInput
	if err := common.BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	if err := requestOTP(ctx, in.BusinessCode, in.Phone); err != nil {
		if errors.Is(err, ErrCustomerNotFound) {
			return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "This phone number is not registered. Please contact your branch."})
		}
		log.Printf("customerauth: request-otp error for %q: %v", in.Phone, err)
		return common.FailErr(c, err)
	}
	return common.SuccessMessage(c, http.StatusOK, "A sign-in code has been sent via WhatsApp.")
}

func VerifyOTP(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var in verifyOTPInput
	if err := common.BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	token, cust, err := verifyOTP(ctx, in.BusinessCode, in.Phone, in.Code)
	if err != nil {
		return common.FailErr(c, err)
	}
	common.SetAuthCookie(c, token, int(sessionTokenTTL.Seconds()))
	return common.Success(c, http.StatusOK, sessionResponse{Token: token, Customer: common.CustomerToResponse(cust)})
}

func RegisterDevice(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	var in registerDeviceInput
	if err := common.BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	deviceToken, err := registerDevice(ctx, customerID, in.DeviceID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"device_token": deviceToken})
}

func DeviceLogin(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var in deviceLoginInput
	if err := common.BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	token, cust, err := deviceLogin(ctx, in.DeviceToken)
	if err != nil {
		return common.FailErr(c, err)
	}
	common.SetAuthCookie(c, token, int(sessionTokenTTL.Seconds()))
	return common.Success(c, http.StatusOK, sessionResponse{Token: token, Customer: common.CustomerToResponse(cust)})
}

func RefreshCustomerToken(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	token, err := refreshCustomerAuth(ctx, customerID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"token": token})
}
