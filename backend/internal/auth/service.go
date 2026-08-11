package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/platform"
)

var (
	// ErrInvalidCredentials covers both "no employee with this email" and
	// "password mismatch" — deliberately not distinguished to callers so a
	// login attempt never reveals whether an email exists.
	ErrInvalidCredentials = errors.New("invalid email or password")
	// ErrInvalidOrExpiredToken covers a reset token that's unknown,
	// mistyped, already used, or past its 1-hour expiry.
	ErrInvalidOrExpiredToken = errors.New("invalid or expired password reset token")
	// ErrAccountNotSetUp is returned by Login when the employee row exists
	// but has no email/password configured yet (needs an Administrator to
	// set them via the employee update endpoint first).
	ErrAccountNotSetUp = errors.New("this account has not been set up for login yet")
)

// resetTokenTTL is how long a password-reset link stays valid.
const resetTokenTTL = 1 * time.Hour

// Service implements login/forgot-password/reset-password on top of the
// employee repository.
type Service struct {
	employeeRepo *employee.Repository
	mailer       *platform.Mailer
	jwtSecret    string
	jwtExpiry    time.Duration
	frontendURL  string
}

// NewService wires the auth service's dependencies: the employee repository
// (for credential lookup/storage), the shared Mailer (for reset emails),
// the JWT signing secret/expiry, and the frontend origin used to build the
// reset-password link.
func NewService(employeeRepo *employee.Repository, mailer *platform.Mailer, jwtSecret string, jwtExpiry time.Duration, frontendURL string) *Service {
	return &Service{
		employeeRepo: employeeRepo,
		mailer:       mailer,
		jwtSecret:    jwtSecret,
		jwtExpiry:    jwtExpiry,
		frontendURL:  frontendURL,
	}
}

// Login verifies email+password and, on success, mints a JWT encoding the
// employee's ID/role/branch.
func (s *Service) Login(email, password string) (string, *employee.Employee, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	emp, err := s.employeeRepo.FindByEmail(email)
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

// ForgotPassword looks up the employee by email; if found, generates a
// random reset token, stores its SHA-256 hash + a 1-hour expiry, and emails
// the raw token as a link. Returns ErrInvalidCredentials if no employee has
// that email — callers (the handler) should swallow that specific case so
// the API response never reveals whether an email exists.
func (s *Service) ForgotPassword(email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	emp, err := s.employeeRepo.FindByEmail(email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvalidCredentials
		}
		return err
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		return err
	}
	rawTokenHex := hex.EncodeToString(rawToken)
	hash := sha256.Sum256([]byte(rawTokenHex))
	hashHex := hex.EncodeToString(hash[:])

	expiresAt := time.Now().Add(resetTokenTTL)
	emp.PasswordResetTokenHash = hashHex
	emp.PasswordResetExpiresAt = &expiresAt
	if err := s.employeeRepo.Update(emp); err != nil {
		return err
	}

	link := fmt.Sprintf("%s/reset-password?token=%s", strings.TrimRight(s.frontendURL, "/"), rawTokenHex)
	subject := "Reset your Ambika Gold password"
	body := fmt.Sprintf(
		"Hello %s,\n\nA password reset was requested for your account. Click the link below to set a new password (valid for 1 hour):\n\n%s\n\nIf you did not request this, you can safely ignore this email.\n",
		emp.Name, link,
	)
	if err := s.mailer.Send(emp.Email, subject, body); err != nil {
		log.Printf("auth: failed to send password reset email to %s: %v", emp.Email, err)
		return err
	}
	return nil
}

// ResetPassword hashes the incoming raw token, looks up a matching
// non-expired employee row, bcrypt-hashes the new password, and clears the
// reset fields so the token can't be reused.
func (s *Service) ResetPassword(token, newPassword string) error {
	if len(newPassword) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	hash := sha256.Sum256([]byte(token))
	hashHex := hex.EncodeToString(hash[:])

	emp, err := s.employeeRepo.FindByResetTokenHash(hashHex)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvalidOrExpiredToken
		}
		return err
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
