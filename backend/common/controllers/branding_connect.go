package controllers

import (
	"cloudhouse/backend/config"
	"context"
	"crypto/rand"
	"math/big"
	"strings"
	"sync"
	"time"
)

const ConnectCodeTTL = 3 * time.Minute

type ConnectCode struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
	ExpiresIn int       `json:"expires_in"`
}

type ConnectRedeem struct {
	BusinessCode string `json:"business_code"`
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
	return "", time.Time{}, NewUnavailable("could not generate a connect code, try again")
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
	max := big.NewInt(int64(len("ABCDEFGHJKMNPQRSTUVWXYZ23456789")))
	for range 6 {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte("ABCDEFGHJKMNPQRSTUVWXYZ23456789"[n.Int64()])
	}
	return b.String(), nil
}

func normalizeConnectCode(raw string) string {
	r := strings.NewReplacer(" ", "", "-", "")
	return strings.ToUpper(r.Replace(strings.TrimSpace(raw)))
}

func issueConnectCode(ctx context.Context) (*ConnectCode, error) {
	id, ok := config.TenantFromContext(ctx)
	if !ok || id == 0 {
		return nil, NewUnauthorized("no business in session")
	}
	t, err := FindTenantByID(config.AllowCrossTenant(ctx), id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	code, expires, err := brandingConnects.
		issue(t.Code, now)
	if err != nil {
		return nil, err
	}
	return &ConnectCode{Code: code, ExpiresAt: expires, ExpiresIn: int(ConnectCodeTTL / time.Second)}, nil
}

func redeemConnectCode(raw string) (*ConnectRedeem, error) {
	code := normalizeConnectCode(raw)
	if len(code) != 6 {
		return nil, NewNotFound("this code is invalid or has expired — generate a new one from the web dashboard")
	}
	businessCode, ok := brandingConnects.
		lookup(code, time.Now())
	if !ok {
		return nil, NewNotFound("this code is invalid or has expired — generate a new one from the web dashboard")
	}
	return &ConnectRedeem{BusinessCode: businessCode}, nil
}
