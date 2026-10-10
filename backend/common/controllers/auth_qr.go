package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

const QRLoginTTL = 3 * time.Minute

type QRLoginIssue struct {
	Token     string `json:"token"`
	ExpiresIn int    `json:"expires_in"`
}

type QRLoginSession struct {
	Token        string                 `json:"token"`
	Employee     *commonModels.Employee `json:"employee"`
	BusinessCode string                 `json:"business_code"`
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

func issueQRLogin(ctx context.Context, employeeID uint) (*QRLoginIssue, error) {
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok || tenantID == 0 || employeeID == 0 {
		return nil, NewUnauthorized("no session")
	}
	token, err := randomHex(16)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	qrSessions.
		mu.Lock()
	defer qrSessions.
		mu.Unlock()
	if len(qrSessions.
		entries) >= 5000 {
		for k, e := range qrSessions.
			entries {
			if !now.Before(e.expiresAt) {
				delete(qrSessions.
					entries, k)
			}
		}
		if len(qrSessions.
			entries) >= 5000 {
			return nil, NewUnavailable("too many pending sign-ins, try again shortly")
		}
	}
	qrSessions.
		entries[token] = qrEntry{employeeID: employeeID, tenantID: tenantID, expiresAt: now.Add(QRLoginTTL)}
	return &QRLoginIssue{Token: token, ExpiresIn: int(QRLoginTTL.Seconds())}, nil
}

func redeemQRLogin(ctx context.Context, token string) (*QRLoginSession, error) {
	qrSessions.
		mu.Lock()
	e, ok := qrSessions.
		entries[token]
	delete(qrSessions.
		entries, token)
	qrSessions.
		mu.Unlock()
	if !ok || !time.Now().Before(e.expiresAt) {
		return nil, NewNotFound("this QR code has expired — generate a new one from the web dashboard")
	}
	ctx = config.WithTenant(ctx, e.tenantID)
	emp, err := FindEmployeeByID(ctx, e.employeeID)
	if err != nil {
		return nil, NewNotFound("this QR code has expired — generate a new one from the web dashboard")
	}
	if emp.PasswordHash == "" || emp.TenantID == 0 {
		return nil, NewNotFound("this QR code has expired — generate a new one from the web dashboard")
	}
	session, ok := CurrentSession(ctx, emp.ID)
	if !ok || !session.IsActive {
		return nil, NewNotFound("this QR code has expired — generate a new one from the web dashboard")
	}
	emp.IsSystem = session.IsSystem
	t, err := FindTenantByID(config.AllowCrossTenant(ctx), emp.TenantID)
	if err != nil {
		return nil, err
	}
	jwt, err := auth.IssueToken(emp.ID, emp.Role, emp.RoleID, emp.TenantID, emp.BranchID, config.Env.JWTSecret, config.Env.JWTExpiry)
	if err != nil {
		return nil, err
	}
	return &QRLoginSession{Token: jwt, Employee: emp, BusinessCode: t.Code}, nil
}
