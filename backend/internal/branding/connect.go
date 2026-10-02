package branding

import (
	"context"
	"crypto/rand"
	"math/big"
	"strings"
	"sync"
	"time"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Connect codes link the staff mobile app to a business, WhatsApp
// "link a device" style: the web dashboard's "Connect mobile app" modal asks
// for a fresh short code (and a QR carrying it), the phone redeems it on
// /public/connect/:code and learns which business to sign in to.
//
// The code only stands in for the business code so nobody has to read the
// slug off the screen — it grants nothing, and the staff member still signs
// in with their own username and password. It is short-lived, so it is kept
// in memory rather than in a table: a restart only loses codes that would
// have expired within minutes anyway, and the modal just issues a new one.

// ConnectCodeTTL is how long an issued code can be redeemed. The web modal
// counts down and requests a replacement when it runs out.
const ConnectCodeTTL = 3 * time.Minute

// connectCodeLen / connectAlphabet: 6 characters from 31 symbols with the
// look-alikes (0/O, 1/I/L) dropped, so a code typed off a screen is not
// mistyped. Uppercase only; redemption normalizes what the phone sends.
const (
	connectCodeLen  = 6
	connectAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
)

// ErrConnectCodeInvalid covers unknown and expired codes alike — which one
// it was tells the caller nothing useful.
var ErrConnectCodeInvalid = httpx.NewNotFound("this code is invalid or has expired — generate a new one from the web dashboard")

// ConnectCode is what the web modal shows.
type ConnectCode struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
	// ExpiresIn (seconds) lets the client count down without trusting its
	// own clock to agree with the server's.
	ExpiresIn int `json:"expiresIn"`
}

// ConnectRedeem is what the phone learns from a code.
type ConnectRedeem struct {
	BusinessCode string `json:"businessCode"`
}

type connectEntry struct {
	businessCode string
	expiresAt    time.Time
}

type connectStore struct {
	mu      sync.Mutex
	entries map[string]connectEntry
}

func newConnectStore() *connectStore {
	return &connectStore{entries: map[string]connectEntry{}}
}

func (s *connectStore) issue(businessCode string, now time.Time) (string, time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, e := range s.entries {
		if !now.Before(e.expiresAt) {
			delete(s.entries, k)
		}
	}
	expires := now.Add(ConnectCodeTTL)
	for range 10 {
		code, err := randomConnectCode()
		if err != nil {
			return "", time.Time{}, err
		}
		if _, taken := s.entries[code]; taken {
			continue
		}
		s.entries[code] = connectEntry{businessCode: businessCode, expiresAt: expires}
		return code, expires, nil
	}
	return "", time.Time{}, httpx.NewUnavailable("could not generate a connect code, try again")
}

func (s *connectStore) lookup(code string, now time.Time) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[code]
	if !ok {
		return "", false
	}
	if !now.Before(e.expiresAt) {
		delete(s.entries, code)
		return "", false
	}
	return e.businessCode, true
}

func randomConnectCode() (string, error) {
	var b strings.Builder
	max := big.NewInt(int64(len(connectAlphabet)))
	for range connectCodeLen {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte(connectAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// normalizeConnectCode accepts what a person might type: lowercase, spaces
// or a dash in the middle ("ABC-123").
func normalizeConnectCode(raw string) string {
	r := strings.NewReplacer(" ", "", "-", "")
	return strings.ToUpper(r.Replace(strings.TrimSpace(raw)))
}

// IssueConnectCode creates a fresh code for the caller's own business — the
// tenant comes from the token, never a parameter.
func (s *Service) IssueConnectCode(ctx context.Context) (*ConnectCode, error) {
	id, ok := platform.TenantFromContext(ctx)
	if !ok || id == 0 {
		return nil, httpx.NewUnauthorized("no business in session")
	}
	t, err := s.tenants.FindByID(platform.AllowCrossTenant(ctx), id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	code, expires, err := s.connect.issue(t.Code, now)
	if err != nil {
		return nil, err
	}
	return &ConnectCode{Code: code, ExpiresAt: expires, ExpiresIn: int(ConnectCodeTTL / time.Second)}, nil
}

// RedeemConnectCode resolves a code to its business. Not consumed on use:
// it simply expires, so a phone whose first attempt dropped can retry.
func (s *Service) RedeemConnectCode(raw string) (*ConnectRedeem, error) {
	code := normalizeConnectCode(raw)
	if len(code) != connectCodeLen {
		return nil, ErrConnectCodeInvalid
	}
	businessCode, ok := s.connect.lookup(code, time.Now())
	if !ok {
		return nil, ErrConnectCodeInvalid
	}
	return &ConnectRedeem{BusinessCode: businessCode}, nil
}
