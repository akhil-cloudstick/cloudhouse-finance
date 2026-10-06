package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/tenant"
)

var (
	// ErrInvalidCredentials covers both "no employee with this
	// username/phone" and "password mismatch" — deliberately not
	// distinguished to callers so a login attempt never reveals whether an
	// account exists.
	ErrInvalidCredentials = httpx.NewUnauthorized("invalid username/phone or password")
	// ErrInvalidOrExpiredToken covers an OTP that's unknown, mistyped,
	// already used, or past its 10-minute expiry.
	ErrInvalidOrExpiredToken = httpx.NewBadRequest("invalid or expired reset code")
	// ErrAccountNotSetUp is returned by Login when the employee row exists
	// but has no password configured yet (needs an Administrator to set
	// one, along with a username or phone, via the employee update
	// endpoint first).
	ErrAccountNotSetUp = httpx.NewUnauthorized("this account has not been set up for login yet")
	// ErrBusinessCodeRequired is returned when more than one business exists
	// and the caller did not say which one they are signing in to. Normally
	// unreachable in the UI, where the code comes from the login URL.
	ErrBusinessCodeRequired = httpx.NewBadRequest("please use your organisation's sign-in link, or enter your business code")
	// ErrAccountNotMatched is returned by the reset flow when no employee of
	// the business has BOTH that username and that phone number. One message
	// for every case (unknown phone, unknown username, or the two belonging
	// to different people), so the reset page can't be used to find out
	// which half of a guessed pair is right.
	ErrAccountNotMatched = httpx.NewNotFound("Username and phone number don't match any account.")
	// ErrTooManyResetAttempts is returned once maxResetAttempts wrong codes
	// have been entered — the code is discarded and a new one is needed.
	ErrTooManyResetAttempts = httpx.NewBadRequest("Too many incorrect codes. Please request a new code.")
	// ErrResetCodeNotSent is returned by ForgotPassword when the code was
	// generated but the SMS gateway failed to deliver it.
	ErrResetCodeNotSent = httpx.NewUnavailable("Sending failed")
	// ErrPhoneNoLogin is returned by ForgotPassword when the phone belongs to
	// an employee who has no login (no password set) — there is no password
	// to reset, so no code is sent.
	ErrPhoneNoLogin = httpx.NewForbidden("This number has no login account.")
)

// resetOTPTTL is how long a texted reset code stays valid — short, since
// unlike an emailed link an SMS OTP is meant to be entered within a couple
// of minutes of arriving.
const resetOTPTTL = 10 * time.Minute

// maxResetAttempts is how many wrong codes a reset code survives. There is no
// request rate limiting in front of these public endpoints, so without a cap
// a 6-digit code could be brute-forced inside its TTL.
const maxResetAttempts = 5

// Service implements login/forgot-password/reset-password on top of the
// employee repository.
type Service struct {
	db           *gorm.DB
	employeeRepo *employee.Repository
	tenantRepo   *tenant.Repository
	smsSender    platform.SMSSender
	jwtSecret    string
	jwtExpiry    time.Duration
	commlogRepo  *commlog.Repository
	qr           *qrStore
}

// NewService wires the auth service's dependencies: the employee repository
// (for credential lookup/storage), the SMS sender (for reset codes — see
// platform.SMSSender), and the JWT signing secret/expiry.
func NewService(db *gorm.DB, employeeRepo *employee.Repository, tenantRepo *tenant.Repository, smsSender platform.SMSSender, jwtSecret string, jwtExpiry time.Duration, commlogRepo *commlog.Repository) *Service {
	return &Service{
		db:           db,
		employeeRepo: employeeRepo,
		tenantRepo:   tenantRepo,
		smsSender:    smsSender,
		jwtSecret:    jwtSecret,
		jwtExpiry:    jwtExpiry,
		commlogRepo:  commlogRepo,
		qr:           newQRStore(),
	}
}

// Login verifies identifier (username OR phone) + password and, on
// success, mints a JWT encoding the employee's ID/role/branch.
// resolveTenant turns the business code supplied at login into the tenant
// whose employees the credentials will be checked against.
//
// This is the one query in the system that legitimately runs before a tenant
// is known — it is what establishes it — so it is explicitly cross-tenant.
// Everything after it is scoped.
//
// When exactly one business exists the code may be omitted, so a
// single-business installation keeps working with no login change at all.
// The moment a second exists the code becomes required, because a username
// is only unique within a business and picking one for the caller would be a
// guess. The error deliberately does not say which businesses exist.
func (s *Service) resolveTenant(ctx context.Context, code string) (uint, error) {
	lookupCtx := platform.AllowCrossTenant(ctx)
	code = strings.TrimSpace(code)

	if code != "" {
		t, err := s.tenantRepo.FindByCode(lookupCtx, code)
		if err != nil {
			// Same error as bad credentials: a wrong business code must not
			// be distinguishable from a wrong password, or the login page
			// becomes a way to enumerate which businesses exist.
			return 0, ErrInvalidCredentials
		}
		return t.ID, nil
	}

	// No code supplied: each business now also has its own subdomain of the
	// platform's base domain (see tenant.SubdomainLabel), so staff visiting
	// their business's own URL don't need to type a code either — mirrors
	// customerauth.Service.resolveTenant's host fallback. Only ever NARROWS:
	// a forged Host at most selects a business the caller still needs valid
	// credentials for.
	if host, ok := platform.RequestHostFromContext(ctx); ok {
		if t, err := s.tenantRepo.FindByHostLabel(lookupCtx, host); err == nil && t != nil {
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

func (s *Service) Login(ctx context.Context, businessCode, identifier, password string) (string, *employee.Employee, error) {
	tenantID, err := s.resolveTenant(ctx, businessCode)
	if err != nil {
		return "", nil, err
	}
	// From here on the lookup is confined to that business, so a username
	// belonging to another one simply does not exist.
	ctx = platform.WithTenant(ctx, tenantID)

	identifier = strings.TrimSpace(identifier)
	emp, err := s.employeeRepo.FindByUsernameOrPhone(ctx, identifier)
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

	// The session's tenant comes from the employee record — the one
	// authoritative source. It is never taken from the request, and an
	// employee somehow lacking one is refused rather than defaulted: a
	// guessed tenant is worse than a failed login.
	if emp.TenantID == 0 {
		return "", nil, ErrInvalidCredentials
	}

	token, err := platform.IssueToken(emp.ID, emp.Role, emp.RoleID, emp.TenantID, emp.BranchID, s.jwtSecret, s.jwtExpiry)
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

// findResetAccount resolves the business and returns the employee who owns
// BOTH username and phone, or ErrAccountNotMatched. Phone is unique per
// business (uq_employees_tenant_phone), so it picks the row; the username
// must then match it exactly — the same comparison Login uses.
func (s *Service) findResetAccount(ctx context.Context, businessCode, username, phone string) (context.Context, *employee.Employee, error) {
	tenantID, err := s.resolveTenant(ctx, businessCode)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			return ctx, nil, ErrAccountNotMatched
		}
		return ctx, nil, err
	}
	ctx = platform.WithTenant(ctx, tenantID)

	username = strings.TrimSpace(username)
	phone = strings.TrimSpace(phone)
	if username == "" || phone == "" {
		return ctx, nil, ErrAccountNotMatched
	}
	emp, err := s.employeeRepo.FindByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ctx, nil, ErrAccountNotMatched
		}
		return ctx, nil, err
	}
	// FindByPhone is tenant-scoped, but a row from another business must
	// still never be the one a code is sent to.
	if emp.TenantID != tenantID || emp.Username != username {
		return ctx, nil, ErrAccountNotMatched
	}
	return ctx, emp, nil
}

// checkResetCode verifies otp against emp's stored reset code. A wrong code
// counts against maxResetAttempts; the last allowed miss discards the code.
func (s *Service) checkResetCode(ctx context.Context, emp *employee.Employee, otp string) error {
	if emp.PasswordResetTokenHash == "" || emp.PasswordResetExpiresAt == nil || time.Now().After(*emp.PasswordResetExpiresAt) {
		return ErrInvalidOrExpiredToken
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(otp)))
	hashHex := hex.EncodeToString(hash[:])
	if subtle.ConstantTimeCompare([]byte(hashHex), []byte(emp.PasswordResetTokenHash)) == 1 {
		return nil
	}

	emp.PasswordResetAttempts++
	tooMany := emp.PasswordResetAttempts >= maxResetAttempts
	if tooMany {
		emp.PasswordResetTokenHash = ""
		emp.PasswordResetExpiresAt = nil
	}
	if err := s.employeeRepo.Update(ctx, emp); err != nil {
		return err
	}
	if tooMany {
		return ErrTooManyResetAttempts
	}
	return ErrInvalidOrExpiredToken
}

// ForgotPassword finds the employee owning both username and phone; if
// found, generates a 6-digit OTP, stores its SHA-256 hash + a 10-minute
// expiry, and texts the raw code via platform.SMSSender. Returns
// ErrAccountNotMatched if no employee of the business has that username +
// phone pair (or the business code itself is unknown), and
// ErrResetCodeNotSent if the SMS could not be delivered.
func (s *Service) ForgotPassword(ctx context.Context, businessCode, username, phone string) error {
	ctx, emp, err := s.findResetAccount(ctx, businessCode, username, phone)
	if err != nil {
		return err
	}
	// Same rule as Login's ErrAccountNotSetUp: an employee without a
	// password cannot sign in, so a reset code would be meaningless.
	if emp.PasswordHash == "" {
		return ErrPhoneNoLogin
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
	if err := s.employeeRepo.Update(ctx, emp); err != nil {
		return err
	}

	// Step 13: the shared SMS/WhatsApp credentials are metered per business,
	// not just per deployment — a compromised account or a scripted retry
	// loop hammering forgot-password must not be able to spend every
	// business's shared quota. Checked here, not after the send: the point
	// is to stop the call from happening, not to count it retroactively.
	// tenantID is already established by resolveTenant above, so this
	// cannot silently charge the wrong business.
	if tenantID, ok := platform.TenantFromContext(ctx); ok {
		if err := platform.CheckAndRecordUsage(s.db, tenantID, platform.UsageSMS); err != nil {
			// The person resetting is staff locked out of their account, not
			// whoever manages the business's quota — they just see the send
			// failed, same as a gateway error.
			if errors.Is(err, platform.ErrUsageCapExceeded) {
				log.Printf("auth: reset code not sent for tenant %d: %v", tenantID, err)
				return ErrResetCodeNotSent
			}
			return err
		}
	}

	message := fmt.Sprintf("Your %s password reset code is %s. It expires in 10 minutes. Do not share this code with anyone.", s.businessName(ctx), otp)
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
		_ = s.commlogRepo.Create(ctx, logRec)
	}
	if sendErr != nil {
		log.Printf("auth: reset code SMS to %q failed: %v", emp.Phone, sendErr)
		return ErrResetCodeNotSent
	}
	return nil
}

// VerifyResetCode checks the texted code for the username + phone pair
// WITHOUT consuming it, so the reset screens can confirm the code before
// asking for a new password. ResetPassword re-checks it on the final submit.
func (s *Service) VerifyResetCode(ctx context.Context, businessCode, username, phone, otp string) error {
	ctx, emp, err := s.findResetAccount(ctx, businessCode, username, phone)
	if err != nil {
		if errors.Is(err, ErrAccountNotMatched) {
			return ErrInvalidOrExpiredToken
		}
		return err
	}
	return s.checkResetCode(ctx, emp, otp)
}

// ResetPassword finds the employee owning both username and phone, checks
// the given OTP against the stored hash (and that it hasn't expired),
// bcrypt-hashes the new password, and clears the reset fields so the OTP
// can't be reused.
func (s *Service) ResetPassword(ctx context.Context, businessCode, username, phone, otp, newPassword string) error {
	if len(newPassword) < 8 {
		return httpx.NewBadRequest("password must be at least 8 characters")
	}
	ctx, emp, err := s.findResetAccount(ctx, businessCode, username, phone)
	if err != nil {
		if errors.Is(err, ErrAccountNotMatched) {
			return ErrInvalidOrExpiredToken
		}
		return err
	}
	if err := s.checkResetCode(ctx, emp, otp); err != nil {
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
	return s.employeeRepo.Update(ctx, emp)
}

// Me returns the current employee's record for GET /auth/me.
func (s *Service) Me(ctx context.Context, employeeID uint) (*employee.Employee, error) {
	return s.employeeRepo.FindByID(ctx, employeeID)
}

// businessName resolves the tenant's own display name for outbound
// SMS/WhatsApp text (multi-tenancy plan, Step 9) — falls back to a neutral
// label rather than another business's name if the lookup fails for any
// reason. Mirrors loan.Service.businessName's fallback shape.
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
