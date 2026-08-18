package customerauth

import (
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

	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/platform"
)

var (
	// ErrCustomerNotFound covers "no customer with this phone" — the
	// handler turns this into a generic, non-account-existence-leaking
	// message for request-otp, same convention as internal/auth's
	// ForgotPassword.
	ErrCustomerNotFound    = errors.New("no customer account found for this phone number")
	ErrInvalidOrExpiredOTP = errors.New("invalid or expired OTP")
	ErrTooManyAttempts     = errors.New("too many incorrect attempts — request a new code")
	ErrInvalidDeviceToken  = errors.New("device is not signed in — please sign in again")
	ErrDeviceIDRequired    = errors.New("deviceId is required")
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
	customerRepo *customer.Repository
	repo         *Repository
	whatsapp     platform.SMSSender
	jwtSecret    string
	commlogRepo  *commlog.Repository
}

func NewService(customerRepo *customer.Repository, repo *Repository, whatsapp platform.SMSSender, jwtSecret string, commlogRepo *commlog.Repository) *Service {
	return &Service{
		customerRepo: customerRepo,
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
func (s *Service) RequestOTP(phone string) error {
	phone = strings.TrimSpace(phone)
	cust, err := s.customerRepo.FindByPhone(phone)
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

	if err := s.repo.UpsertOTP(&OTP{
		Phone:     phone,
		CodeHash:  hashCode(code),
		ExpiresAt: time.Now().Add(otpTTL),
	}); err != nil {
		return err
	}

	message := fmt.Sprintf("Your Ambika Gold Finance app sign-in code is %s. It expires in 5 minutes. Do not share this code with anyone.", code)
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
		_ = s.commlogRepo.Create(logRec)
	}
	return sendErr
}

// VerifyOTP checks code against the stored hash for phone (respecting
// expiry and the attempt cap), and on success issues a customer session
// JWT. The OTP row is deleted on success so it can't be replayed.
func (s *Service) VerifyOTP(phone, code string) (string, *customer.Customer, error) {
	phone = strings.TrimSpace(phone)
	code = strings.TrimSpace(code)

	cust, err := s.customerRepo.FindByPhone(phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, ErrInvalidOrExpiredOTP
		}
		return "", nil, err
	}

	rec, err := s.repo.FindOTPByPhone(phone)
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
		_ = s.repo.IncrementOTPAttempts(rec.ID)
		return "", nil, ErrInvalidOrExpiredOTP
	}

	_ = s.repo.DeleteOTP(rec.ID)

	token, err := platform.IssueCustomerToken(cust.ID, s.jwtSecret, sessionTokenTTL)
	if err != nil {
		return "", nil, err
	}
	return token, cust, nil
}

// RegisterDevice issues a new long-lived device token for customerID +
// deviceID, called once right after a successful VerifyOTP. Any prior live
// token for the same (customerID, deviceID) pair is revoked first. The raw
// token is returned exactly once — only its hash is retained.
func (s *Service) RegisterDevice(customerID uint, deviceID string) (string, error) {
	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return "", ErrDeviceIDRequired
	}
	if err := s.repo.RevokeDeviceTokensForCustomerDevice(customerID, deviceID); err != nil {
		return "", err
	}
	raw, err := generateDeviceToken()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(raw))
	if err := s.repo.CreateDeviceToken(&DeviceToken{
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
func (s *Service) DeviceLogin(rawToken string) (string, *customer.Customer, error) {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return "", nil, ErrInvalidDeviceToken
	}
	sum := sha256.Sum256([]byte(rawToken))
	rec, err := s.repo.FindDeviceTokenByHash(hex.EncodeToString(sum[:]))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, ErrInvalidDeviceToken
		}
		return "", nil, err
	}
	if rec.RevokedAt != nil {
		return "", nil, ErrInvalidDeviceToken
	}

	cust, err := s.customerRepo.FindByID(rec.CustomerID)
	if err != nil {
		return "", nil, ErrInvalidDeviceToken
	}

	_ = s.repo.TouchDeviceToken(rec.ID)

	token, err := platform.IssueCustomerToken(cust.ID, s.jwtSecret, sessionTokenTTL)
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
func (s *Service) Refresh(customerID uint) (string, error) {
	return platform.IssueCustomerToken(customerID, s.jwtSecret, sessionTokenTTL)
}
