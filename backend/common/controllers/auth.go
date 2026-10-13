package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
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
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrInvalidCredentials = NewUnauthorized("invalid username/phone or password")
	ErrAccountNotMatched  = NewNotFound("Username and phone number don't match any account.")
)

const resetOTPTTL = 10 * time.Minute

type LoginResponse struct {
	Token    string                 `json:"token"`
	Employee *commonModels.Employee `json:"employee"`
}

func resolveTenant(ctx context.Context, code string) (uint, error) {
	lookupCtx := config.AllowCrossTenant(ctx)
	code = strings.TrimSpace(code)
	if code != "" {
		t, err := FindByCode(lookupCtx, code)
		if err != nil {
			return 0, ErrInvalidCredentials
		}
		return t.ID, nil
	}
	if host, ok := auth.RequestHostFromContext(ctx); ok {
		if t, err := FindByHostLabel(lookupCtx, host); err == nil && t != nil {
			return t.ID, nil
		}
	}
	all, err := FindTenants(lookupCtx)
	if err != nil {
		return 0, err
	}
	if len(all) == 1 {
		return all[0].ID, nil
	}
	return 0, NewBadRequest("please use your organisation's sign-in link, or enter your business code")
}

func login(ctx context.Context, businessCode, identifier, password string) (string, *commonModels.Employee, error) {
	tenantID, err := resolveTenant(ctx, businessCode)
	if err != nil {
		return "", nil, err
	}
	ctx = config.WithTenant(ctx, tenantID)
	identifier = strings.TrimSpace(identifier)
	emp, err := findByUsernameOrPhone(ctx, identifier)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, ErrInvalidCredentials
		}
		return "", nil, err
	}
	if emp.PasswordHash == "" {
		return "", nil, NewUnauthorized("this account has not been set up for login yet")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(emp.PasswordHash), []byte(password)); err != nil {
		return "", nil, ErrInvalidCredentials
	}
	if emp.TenantID == 0 {
		return "", nil, ErrInvalidCredentials
	}
	session, ok := CurrentSession(ctx, emp.ID)
	if !ok {
		return "", nil, ErrInvalidCredentials
	}
	if !session.IsActive {
		return "", nil, NewUnauthorized("Account is inactive")
	}
	emp.IsSystem = session.IsSystem
	token, err := auth.IssueToken(emp.ID, emp.Role, emp.RoleID, emp.TenantID, emp.BranchID, config.Env.JWTSecret, config.Env.JWTExpiry)
	if err != nil {
		return "", nil, err
	}
	return token, emp, nil
}

func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func findResetAccount(ctx context.Context, businessCode, username, phone string) (context.Context, *commonModels.Employee, error) {
	tenantID, err := resolveTenant(ctx, businessCode)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			return ctx, nil, ErrAccountNotMatched
		}
		return ctx, nil, err
	}
	ctx = config.WithTenant(ctx, tenantID)
	username = strings.TrimSpace(username)
	phone = strings.TrimSpace(phone)
	if username == "" || phone == "" {
		return ctx, nil, ErrAccountNotMatched
	}
	emp, err := findByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ctx, nil, ErrAccountNotMatched
		}
		return ctx, nil, err
	}
	// FindByPhone is tenant-scoped, but a row from another business must still never be the one a code is sent to.
	if emp.TenantID != tenantID || emp.Username != username {
		return ctx, nil, ErrAccountNotMatched
	}
	return ctx, emp, nil
}

func checkResetCode(ctx context.Context, emp *commonModels.Employee, otp string) error {
	if emp.PasswordResetTokenHash == "" || emp.PasswordResetExpiresAt == nil || time.Now().After(*emp.PasswordResetExpiresAt) {
		return NewBadRequest("invalid or expired reset code")
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(otp)))
	hashHex := hex.EncodeToString(hash[:])
	if subtle.ConstantTimeCompare([]byte(hashHex), []byte(emp.PasswordResetTokenHash)) == 1 {
		return nil
	}
	emp.PasswordResetAttempts++
	tooMany := emp.PasswordResetAttempts >= 5
	if tooMany {
		emp.PasswordResetTokenHash = ""
		emp.PasswordResetExpiresAt = nil
	}
	if err := persistEmployee(ctx, emp); err != nil {
		return err
	}
	if tooMany {
		return NewBadRequest("Too many incorrect codes. Please request a new code.")
	}
	return NewBadRequest("invalid or expired reset code")
}

func forgotPassword(ctx context.Context, businessCode, username, phone string) error {
	ctx, emp, err := findResetAccount(ctx, businessCode, username, phone)
	if err != nil {
		return err
	}
	if emp.PasswordHash == "" {
		return NewForbidden("This number has no login account.")
	}
	otp, err := generateOTP()
	if err != nil {
		return err
	}
	hash := sha256.Sum256([]byte(otp))
	hashHex := hex.EncodeToString(hash[:])
	expiresAt := time.Now().Add(resetOTPTTL)
	emp.PasswordResetTokenHash = hashHex
	emp.PasswordResetExpiresAt = &expiresAt
	emp.PasswordResetAttempts = 0
	if err := persistEmployee(ctx, emp); err != nil {
		return err
	}
	if tenantID, ok := config.TenantFromContext(ctx); ok {
		if err := CheckAndRecordUsage(config.BaseDB,
			tenantID, "sms"); err != nil {
			if errors.Is(err, ErrUsageCapExceeded) {
				log.Printf("auth: reset code not sent for tenant %d: %v", tenantID, err)
				return NewUnavailable("Sending failed")
			}
			return err
		}
	}
	message := fmt.Sprintf("Your %s password reset code is %s. It expires in 10 minutes. Do not share this code with anyone.", businessName(ctx), otp)
	sendErr := config.WhatsApp.
		Send(ctx, emp.Phone, message)
	{
		logRec := &commonModels.CommunicationLog{
			RecipientName:     emp.Name,
			RecipientPhone:    emp.Phone,
			ChatID:            NormalizeChatID(emp.Phone),
			Channel:           commonModels.ChannelWhatsApp,
			TriggerType:       "otp",
			MessageBody:       message,
			RelatedEntityType: "employee",
			RelatedEntityID:   emp.ID,
			Status:            commonModels.StatusSent,
		}
		if sendErr != nil {
			logRec.Status = commonModels.StatusFailed
			logRec.ErrorMessage = sendErr.Error()
		}
		_ = InsertCommLog(ctx, logRec)
	}
	if sendErr != nil {
		log.Printf("auth: reset code SMS to %q failed: %v", emp.Phone, sendErr)
		return NewUnavailable("Sending failed")
	}
	return nil
}

func verifyResetCode(ctx context.Context, businessCode, username, phone, otp string) error {
	ctx, emp, err := findResetAccount(ctx, businessCode, username, phone)
	if err != nil {
		if errors.Is(err, ErrAccountNotMatched) {
			return NewBadRequest("invalid or expired reset code")
		}
		return err
	}
	return checkResetCode(ctx, emp, otp)
}

func resetPassword(ctx context.Context, businessCode, username, phone, otp, newPassword string) error {
	if len(newPassword) < 8 {
		return NewBadRequest("password must be at least 8 characters")
	}
	ctx, emp, err := findResetAccount(ctx, businessCode, username, phone)
	if err != nil {
		if errors.Is(err, ErrAccountNotMatched) {
			return NewBadRequest("invalid or expired reset code")
		}
		return err
	}
	if err := checkResetCode(ctx, emp, otp); err != nil {
		return err
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost+2)
	if err != nil {
		return err
	}
	emp.PasswordHash = string(newHash)
	emp.PasswordResetTokenHash = ""
	emp.PasswordResetExpiresAt = nil
	emp.PasswordResetAttempts = 0
	return persistEmployee(ctx, emp)
}

func me(ctx context.Context, employeeID uint) (*commonModels.Employee, error) {
	return FindEmployeeByID(ctx, employeeID)
}

func businessName(ctx context.Context) string {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return "your lender"
	}
	t, err := FindTenantByID(ctx, id)
	if err != nil || t.Name == "" {
		return "your lender"
	}
	return t.Name
}

func Login(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var in commonModels.LoginInput
	if err := BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	token, emp, err := login(ctx, in.BusinessCode, in.Identifier, in.Password)
	if err != nil {
		return FailErr(c, err)
	}
	SetAuthCookie(c, token, int(config.Env.JWTExpiry.
		Seconds()))
	return Success(c, http.StatusOK, LoginResponse{Token: token, Employee: emp})
}

func QRIssue(c echo.Context) error {
	employeeID, ok := c.Get("employeeId").(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	rec, err := issueQRLogin(auth.RequestContext(c), employeeID)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func QRRedeem(c echo.Context) error {
	var in commonModels.QRRedeemInput
	if err := BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	res, err := redeemQRLogin(auth.RequestContext(c), in.Token)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, res)
}

func ForgotPassword(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var in commonModels.ForgotPasswordInput
	if err := BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	if err := forgotPassword(ctx, in.BusinessCode, in.Username, in.Phone); err != nil {
		var se StatusedError
		if !errors.As(err, &se) {
			log.Printf("auth: forgot-password error for %q: %v", in.Phone, err)
			err = NewUnavailable("Sending failed")
		}
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "A reset code has been sent by SMS.")
}

func VerifyResetCode(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var in commonModels.VerifyResetCodeInput
	if err := BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	if err := verifyResetCode(ctx, in.BusinessCode, in.Username, in.Phone, in.OTP); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Code verified.")
}

func ResetPassword(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var in commonModels.ResetPasswordInput
	if err := BindJSON(c, &in); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	if err := resetPassword(ctx, in.BusinessCode, in.Username, in.Phone, in.OTP, in.NewPassword); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Password has been reset. You can now log in.")
}

func GetMe(c echo.Context) error {
	ctx := auth.RequestContext(c)
	employeeIDVal, ok := Get(c, "employeeId")
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	employeeID, ok := employeeIDVal.(uint)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	emp, err := me(ctx, employeeID)
	if err != nil {
		return FailErr(c, NewNotFound("employee not found"))
	}
	emp.IsSystem = auth.IsSystemActor(c)
	return Success(c, http.StatusOK, emp)
}
