package customerauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/tenant"
)

var (
	// ErrCustomerNotFound covers "no customer with this phone" — the
	// handler turns this into a generic, non-account-existence-leaking
	// message for request-otp, same convention as internal/auth's
	// ForgotPassword.
	ErrCustomerNotFound = httpx.NewNotFound("no customer account found for this phone number")
	// ErrBusinessCodeRequired mirrors auth.ErrBusinessCodeRequired: with more
	// than one business, the app link must say which one.
	ErrBusinessCodeRequired = httpx.NewBadRequest("please open your lender's app link")
	ErrInvalidOrExpiredOTP  = httpx.NewBadRequest("invalid or expired OTP")
	ErrTooManyAttempts      = httpx.NewBadRequest("too many incorrect attempts — request a new code")
	ErrInvalidDeviceToken   = httpx.NewBadRequest("device is not signed in — please sign in again")
	ErrDeviceIDRequired     = httpx.NewBadRequest("deviceId is required")
)

const (
	otpTTL          = 5 * time.Minute
	maxOTPAttempts  = 5
	sessionTokenTTL = 24 * time.Hour
	// deviceTokenTTL is long-lived by design (this is the whole point of a
	// biometric-unlock device credential) — 180 days, refreshed implicitly
	// every time device-login succeeds since TouchDeviceToken only updates
	// LastUsedAt, not ExpiresAt. Expiry is enforced purely by RevokedAt
	// (an admin/self revoke), not by a stored expiry column — see
	// DeviceLogin.
)

// Service implements customer OTP + device-token sign-in.
type Service struct {
	db           *gorm.DB
	customerRepo *customer.Repository
	tenantRepo   *tenant.Repository
	repo         *Repository
	whatsapp     platform.SMSSender
	jwtSecret    string
	commlogRepo  *commlog.Repository
}

func NewService(db *gorm.DB, customerRepo *customer.Repository, tenantRepo *tenant.Repository, repo *Repository, whatsapp platform.SMSSender, jwtSecret string, commlogRepo *commlog.Repository) *Service {
	return &Service{
		db:           db,
		customerRepo: customerRepo,
		tenantRepo:   tenantRepo,
		repo:         repo,
		whatsapp:     whatsapp,
		jwtSecret:    jwtSecret,
		commlogRepo:  commlogRepo,
	}
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

// generateDeviceToken returns a cryptographically random 32-byte token,
// hex-encoded, given raw to the app exactly once (at register-device) and
// never recoverable server-side afterward — only its hash is stored.
func generateDeviceToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// RequestOTP looks up the customer by phone and, if found, generates and
// WhatsApp-sends a 6-digit OTP. Returns ErrCustomerNotFound if no customer
// has that phone — the handler swallows that case in its response so the
// API never reveals which phone numbers are registered.
func (s *Service) RequestOTP(ctx context.Context, businessCode, phone string) error {
	tenantID, err := s.resolveTenant(ctx, businessCode)
	if err != nil {
		return err
	}
	ctx = platform.WithTenant(ctx, tenantID)

	phone = strings.TrimSpace(phone)
	cust, err := s.customerRepo.FindByPhone(ctx, phone)
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

	if err := s.repo.UpsertOTP(ctx, &OTP{
		Phone:     phone,
		CodeHash:  hashCode(code),
		ExpiresAt: time.Now().Add(otpTTL),
	}); err != nil {
		return err
	}

	// Step 13: capped per business, same reasoning as auth.Service's
	// ForgotPassword — this is the highest-volume, lowest-friction outbound
	// send in the app (any phone number can trigger it), so it is the first
	// place a runaway loop would exhaust the shared deployment's quota.
	if tenantID, ok := platform.TenantFromContext(ctx); ok {
		if err := platform.CheckAndRecordUsage(s.db, tenantID, platform.UsageWhatsApp); err != nil {
			return err
		}
	}

	message := fmt.Sprintf("Your %s app sign-in code is %s. It expires in 5 minutes. Do not share this code with anyone.", s.businessName(ctx), code)
	sendErr := s.whatsapp.Send(cust.Phone, message)
	if s.commlogRepo != nil {
		logRec := &commlog.CommunicationLog{
			RecipientName:     cust.Name,
			RecipientPhone:    cust.Phone,
			ChatID:            commlog.NormalizeChatID(cust.Phone),
			Channel:           commlog.ChannelWhatsApp,
			TriggerType:       commlog.TriggerOTP,
			MessageBody:       message,
			RelatedEntityType: "customer",
			RelatedEntityID:   cust.ID,
			Status:            commlog.StatusSent,
		}
		if sendErr != nil {
			logRec.Status = commlog.StatusFailed
			logRec.ErrorMessage = sendErr.Error()
		}
		_ = s.commlogRepo.Create(ctx, logRec)
	}
	return sendErr
}

// VerifyOTP checks code against the stored hash for phone (respecting
// expiry and the attempt cap), and on success issues a customer session
// JWT. The OTP row is deleted on success so it can't be replayed.
func (s *Service) VerifyOTP(ctx context.Context, businessCode, phone, code string) (string, *customer.Customer, error) {
	tenantID, terr := s.resolveTenant(ctx, businessCode)
	if terr != nil {
		return "", nil, terr
	}
	ctx = platform.WithTenant(ctx, tenantID)

	phone = strings.TrimSpace(phone)
	code = strings.TrimSpace(code)

	cust, err := s.customerRepo.FindByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, ErrInvalidOrExpiredOTP
		}
		return "", nil, err
	}

	rec, err := s.repo.FindOTPByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, ErrInvalidOrExpiredOTP
		}
		return "", nil, err
	}
	if rec.Attempts >= maxOTPAttempts {
		return "", nil, ErrTooManyAttempts
	}
	if time.Now().After(rec.ExpiresAt) {
		return "", nil, ErrInvalidOrExpiredOTP
	}
	if subtle.ConstantTimeCompare([]byte(hashCode(code)), []byte(rec.CodeHash)) != 1 {
		_ = s.repo.IncrementOTPAttempts(ctx, rec.ID)
		return "", nil, ErrInvalidOrExpiredOTP
	}

	_ = s.repo.DeleteOTP(ctx, rec.ID)

	token, err := platform.IssueCustomerToken(cust.ID, cust.TenantID, s.jwtSecret, sessionTokenTTL)
	if err != nil {
		return "", nil, err
	}
	return token, cust, nil
}

// RegisterDevice issues a new long-lived device token for customerID +
// deviceID, called once right after a successful VerifyOTP. Any prior live
// token for the same (customerID, deviceID) pair is revoked first. The raw
// token is returned exactly once — only its hash is retained.
func (s *Service) RegisterDevice(ctx context.Context, customerID uint, deviceID string) (string, error) {
	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return "", ErrDeviceIDRequired
	}
	if err := s.repo.RevokeDeviceTokensForCustomerDevice(ctx, customerID, deviceID); err != nil {
		return "", err
	}
	raw, err := generateDeviceToken()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(raw))
	if err := s.repo.CreateDeviceToken(ctx, &DeviceToken{
		CustomerID: customerID,
		DeviceID:   deviceID,
		TokenHash:  hex.EncodeToString(sum[:]),
	}); err != nil {
		return "", err
	}
	return raw, nil
}

// DeviceLogin validates a device token (exists, not revoked) and, on
// success, issues a fresh session JWT — called after a successful local
// biometric check on a subsequent app open. Any failure here (unknown,
// revoked token) must send the app back to the OTP screen; there is no
// device-side-only fallback.
func (s *Service) DeviceLogin(ctx context.Context, rawToken string) (string, *customer.Customer, error) {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return "", nil, ErrInvalidDeviceToken
	}
	sum := sha256.Sum256([]byte(rawToken))
	rec, err := s.repo.FindDeviceTokenByHash(ctx, hex.EncodeToString(sum[:]))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, ErrInvalidDeviceToken
		}
		return "", nil, err
	}
	if rec.RevokedAt != nil {
		return "", nil, ErrInvalidDeviceToken
	}

	cust, err := s.customerRepo.FindByID(ctx, rec.CustomerID)
	if err != nil {
		return "", nil, ErrInvalidDeviceToken
	}

	_ = s.repo.TouchDeviceToken(ctx, rec.ID)

	token, err := platform.IssueCustomerToken(cust.ID, cust.TenantID, s.jwtSecret, sessionTokenTTL)
	if err != nil {
		return "", nil, err
	}
	return token, cust, nil
}

// Refresh mints a new session JWT for an already-authenticated customer
// (customerId comes from a still-valid, though possibly soon-to-expire,
// session JWT verified by CustomerAuthMiddleware) — a lightweight "extend
// my session" call, distinct from DeviceLogin which starts from a device
// token instead.
func (s *Service) Refresh(ctx context.Context, customerID uint) (string, error) {
	// Refresh runs under CustomerAuthMiddleware, so the business is already
	// established on the session. Re-reading it from the context rather than
	// looking it up again keeps the renewed token identical in scope to the
	// one it replaces.
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok {
		return "", platform.ErrNoTenantInContext
	}
	return platform.IssueCustomerToken(customerID, tenantID, s.jwtSecret, sessionTokenTTL)
}

// resolveTenant turns the business code the borrower app was opened with
// into the business whose customer records the phone number is matched
// against.
//
// Mirrors auth.Service.resolveTenant, and for the same reason: this is the
// one query that legitimately precedes a tenant, because it is what
// establishes it. Everything after is scoped.
//
// A borrower with loans at two different businesses signs in to each
// separately — merging them would tell each business the person also
// borrows elsewhere, which is not theirs to know. The code normally arrives
// from the per-business app link, so the borrower never types it.
func (s *Service) resolveTenant(ctx context.Context, code string) (uint, error) {
	lookupCtx := platform.AllowCrossTenant(ctx)
	code = strings.TrimSpace(code)

	if code != "" {
		t, err := s.tenantRepo.FindByCode(lookupCtx, code)
		if err != nil {
			// Indistinguishable from "no such customer", so the OTP endpoint
			// cannot be used to discover which businesses exist.
			return 0, ErrCustomerNotFound
		}
		return t.ID, nil
	}

	// No code supplied: fall back to the host the request arrived on. Each
	// business has its own frontend URL, so a borrower opening their lender's
	// app is already saying which business they mean, and never has to type or
	// be sent a code.
	//
	// This can only NARROW. The host is client-supplied, so a forged one at
	// most selects a business the caller then still needs a valid OTP for,
	// delivered to a phone number that business already holds.
	if host, ok := platform.RequestHostFromContext(ctx); ok {
		// Subdomain first: every business now has its own subdomain of the
		// platform's base domain (see tenant.SubdomainLabel), which is the
		// normal way a business is reached today. FindByAppURL stays as a
		// secondary fallback, for a business's own custom domain — something
		// SubdomainLabel cannot recognise.
		if t, err := s.tenantRepo.FindByHostLabel(lookupCtx, host); err == nil && t != nil {
			return t.ID, nil
		}
		if t, err := s.tenantRepo.FindByAppURL(lookupCtx, host); err == nil && t != nil {
			return t.ID, nil
		}
	}


	all, err := s.tenantRepo.FindAll(lookupCtx)
	if err != nil {
		return 0, err
	}
	if len(all) == 1 {
		return all[0].ID, nil
	}
	return 0, ErrBusinessCodeRequired
}

// businessName resolves the lender's own display name for the sign-in code
// message (multi-tenancy plan, Step 9) — falls back to a neutral label
// rather than another business's name if the lookup fails for any reason.
func (s *Service) businessName(ctx context.Context) string {
	id, ok := platform.TenantFromContext(ctx)
	if !ok {
		return "your lender"
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil || t.Name == "" {
		return "your lender"
	}
	return t.Name
}
