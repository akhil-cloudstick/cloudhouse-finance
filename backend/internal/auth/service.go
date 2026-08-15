package auth

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

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/platform"
)

var (
	// ErrInvalidCredentials covers both "no employee with this
	// username/phone" and "password mismatch" — deliberately not
	// distinguished to callers so a login attempt never reveals whether an
	// account exists.
	ErrInvalidCredentials = errors.New("invalid username/phone or password")
	// ErrInvalidOrExpiredToken covers an OTP that's unknown, mistyped,
	// already used, or past its 10-minute expiry.
	ErrInvalidOrExpiredToken = errors.New("invalid or expired reset code")
	// ErrAccountNotSetUp is returned by Login when the employee row exists
	// but has no password configured yet (needs an Administrator to set
	// one, along with a username or phone, via the employee update
	// endpoint first).
	ErrAccountNotSetUp = errors.New("this account has not been set up for login yet")
)

// resetOTPTTL is how long a texted reset code stays valid — short, since
// unlike an emailed link an SMS OTP is meant to be entered within a couple
// of minutes of arriving.
const resetOTPTTL = 10 * time.Minute

// Service implements login/forgot-password/reset-password on top of the
// employee repository.
type Service struct {
	employeeRepo *employee.Repository
	smsSender    platform.SMSSender
	jwtSecret    string
	jwtExpiry    time.Duration
	commlogRepo  *commlog.Repository
}

// NewService wires the auth service's dependencies: the employee repository
// (for credential lookup/storage), the SMS sender (for reset codes — see
// platform.SMSSender), and the JWT signing secret/expiry.
func NewService(employeeRepo *employee.Repository, smsSender platform.SMSSender, jwtSecret string, jwtExpiry time.Duration, commlogRepo *commlog.Repository) *Service {
	return &Service{
		employeeRepo: employeeRepo,
		smsSender:    smsSender,
		jwtSecret:    jwtSecret,
		jwtExpiry:    jwtExpiry,
		commlogRepo:  commlogRepo,
	}
}

// Login verifies identifier (username OR phone) + password and, on
// success, mints a JWT encoding the employee's ID/role/branch.
func (s *Service) Login(identifier, password string) (string, *employee.Employee, error) {
	identifier = strings.TrimSpace(identifier)
	emp, err := s.employeeRepo.FindByUsernameOrPhone(identifier)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, ErrInvalidCredentials
		}
		return "", nil, err
	}
	if emp.PasswordHash == "" {
		return "", nil, ErrAccountNotSetUp
	}
	if err := bcrypt.CompareHashAndPassword([]byte(emp.PasswordHash), []byte(password)); err != nil {
		return "", nil, ErrInvalidCredentials
	}

	token, err := platform.IssueToken(emp.ID, emp.Role, emp.BranchID, s.jwtSecret, s.jwtExpiry)
	if err != nil {
		return "", nil, err
	}
	return token, emp, nil
}

// generateOTP returns a cryptographically random 6-digit numeric code,
// zero-padded (e.g. "004821").
func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// ForgotPassword looks up the employee by phone; if found, generates a
// 6-digit OTP, stores its SHA-256 hash + a 10-minute expiry, and texts the
// raw code via platform.SMSSender. Returns ErrInvalidCredentials if no
// employee has that phone — callers (the handler) should swallow that
// specific case so the API response never reveals whether a phone number
// is registered.
func (s *Service) ForgotPassword(phone string) error {
	phone = strings.TrimSpace(phone)
	emp, err := s.employeeRepo.FindByPhone(phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvalidCredentials
		}
		return err
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
	if err := s.employeeRepo.Update(emp); err != nil {
		return err
	}

	message := fmt.Sprintf("Your Ambika Gold Finance password reset code is %s. It expires in 10 minutes. Do not share this code with anyone.", otp)
	sendErr := s.smsSender.Send(emp.Phone, message)
	if s.commlogRepo != nil {
		logRec := &commlog.CommunicationLog{
			RecipientName:     emp.Name,
			RecipientPhone:    emp.Phone,
			ChatID:            commlog.NormalizeChatID(emp.Phone),
			Channel:           commlog.ChannelWhatsApp,
			TriggerType:       commlog.TriggerOTP,
			MessageBody:       message,
			RelatedEntityType: "employee",
			RelatedEntityID:   emp.ID,
			// TriggeredByEmployeeID is nil — this is self-triggered (the
			// employee requested their own reset code).
			Status: commlog.StatusSent,
		}
		if sendErr != nil {
			logRec.Status = commlog.StatusFailed
			logRec.ErrorMessage = sendErr.Error()
		}
		_ = s.commlogRepo.Create(logRec)
	}
	return sendErr
}

// ResetPassword looks up the employee by phone, checks the given OTP
// against the stored hash (and that it hasn't expired), bcrypt-hashes the
// new password, and clears the reset fields so the OTP can't be reused.
func (s *Service) ResetPassword(phone, otp, newPassword string) error {
	if len(newPassword) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	phone = strings.TrimSpace(phone)
	emp, err := s.employeeRepo.FindByPhone(phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvalidOrExpiredToken
		}
		return err
	}
	if emp.PasswordResetTokenHash == "" || emp.PasswordResetExpiresAt == nil || time.Now().After(*emp.PasswordResetExpiresAt) {
		return ErrInvalidOrExpiredToken
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(otp)))
	hashHex := hex.EncodeToString(hash[:])
	if subtle.ConstantTimeCompare([]byte(hashHex), []byte(emp.PasswordResetTokenHash)) != 1 {
		return ErrInvalidOrExpiredToken
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost+2)
	if err != nil {
		return err
	}
	emp.PasswordHash = string(newHash)
	emp.PasswordResetTokenHash = ""
	emp.PasswordResetExpiresAt = nil
	return s.employeeRepo.Update(emp)
}

// Me returns the current employee's record for GET /auth/me.
func (s *Service) Me(employeeID uint) (*employee.Employee, error) {
	return s.employeeRepo.FindByID(employeeID)
}
