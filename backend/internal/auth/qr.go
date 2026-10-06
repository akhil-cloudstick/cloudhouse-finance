package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// QR sign-in for the staff mobile app: an employee who is signed in on the
// web opens "Connect mobile app", and the phone that scans that QR is signed
// in as the same employee — WhatsApp's "link a device", applied to login.
//
//	POST /auth/qr/issue    signed in — the web dashboard asks for a login token
//	POST /auth/qr/redeem   public    — the phone swaps the scanned token for a session
//
// The token rides in the same QR as the business connect code (see
// frontend ConnectMobileModal and mobile/app/(auth)/connect.tsx). It is a
// one-time bearer: whoever scans it first becomes that employee, so it is
// short-lived, redeemable once, and never shown as typeable text.
//
// Held in memory like the connect codes (branding/connect.go): it lives a
// few minutes, so surviving a restart gains nothing.

// QRLoginTTL is how long an issued token can be redeemed. Matches the
// connect code beside it in the same QR.
const QRLoginTTL = 3 * time.Minute

// qrMaxPending bounds the store. Issue needs a session, so this is a
// backstop against a runaway client rather than an abuse limit.
const qrMaxPending = 5000

var (
	// ErrQRLoginInvalid covers unknown, expired and already-used tokens alike.
	ErrQRLoginInvalid = httpx.NewNotFound("this QR code has expired — generate a new one from the web dashboard")
	// ErrQRLoginBusy is returned by issue when the store is full.
	ErrQRLoginBusy = httpx.NewUnavailable("too many pending sign-ins, try again shortly")
)

// QRLoginIssue is what the web dashboard gets back from issue.
type QRLoginIssue struct {
	Token     string `json:"token"`
	ExpiresIn int    `json:"expiresIn"` // seconds
}

// QRLoginSession is what the phone gets back from redeem: the same session
// Login returns, plus the business code the app stores on a connect.
type QRLoginSession struct {
	Token        string             `json:"token"`
	Employee     *employee.Employee `json:"employee"`
	BusinessCode string             `json:"businessCode"`
}

type qrEntry struct {
	employeeID uint
	tenantID   uint
	expiresAt  time.Time
}

type qrStore struct {
	mu      sync.Mutex
	entries map[string]qrEntry
}

func newQRStore() *qrStore { return &qrStore{entries: map[string]qrEntry{}} }

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// IssueQRLogin mints a login token for the calling employee. Both identities
// come from the authenticated request, never a parameter.
func (s *Service) IssueQRLogin(ctx context.Context, employeeID uint) (*QRLoginIssue, error) {
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok || tenantID == 0 || employeeID == 0 {
		return nil, httpx.NewUnauthorized("no session")
	}
	token, err := randomHex(16)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	s.qr.mu.Lock()
	defer s.qr.mu.Unlock()
	if len(s.qr.entries) >= qrMaxPending {
		for k, e := range s.qr.entries {
			if !now.Before(e.expiresAt) {
				delete(s.qr.entries, k)
			}
		}
		if len(s.qr.entries) >= qrMaxPending {
			return nil, ErrQRLoginBusy
		}
	}
	s.qr.entries[token] = qrEntry{employeeID: employeeID, tenantID: tenantID, expiresAt: now.Add(QRLoginTTL)}
	return &QRLoginIssue{Token: token, ExpiresIn: int(QRLoginTTL.Seconds())}, nil
}

// RedeemQRLogin swaps a scanned token for a session. The token is consumed
// whether or not the rest succeeds.
func (s *Service) RedeemQRLogin(ctx context.Context, token string) (*QRLoginSession, error) {
	s.qr.mu.Lock()
	e, ok := s.qr.entries[token]
	delete(s.qr.entries, token)
	s.qr.mu.Unlock()
	if !ok || !time.Now().Before(e.expiresAt) {
		return nil, ErrQRLoginInvalid
	}

	ctx = platform.WithTenant(ctx, e.tenantID)
	emp, err := s.employeeRepo.FindByID(ctx, e.employeeID)
	if err != nil {
		return nil, ErrQRLoginInvalid
	}
	// Same rules as Login: an employee with no login, or no business, gets no session.
	if emp.PasswordHash == "" || emp.TenantID == 0 {
		return nil, ErrQRLoginInvalid
	}
	t, err := s.tenantRepo.FindByID(platform.AllowCrossTenant(ctx), emp.TenantID)
	if err != nil {
		return nil, err
	}
	jwt, err := platform.IssueToken(emp.ID, emp.Role, emp.RoleID, emp.TenantID, emp.BranchID, s.jwtSecret, s.jwtExpiry)
	if err != nil {
		return nil, err
	}
	return &QRLoginSession{Token: jwt, Employee: emp, BusinessCode: t.Code}, nil
}
