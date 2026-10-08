package auth

import (
	"context"
	"testing"
	"time"

	"cloudhouse/backend/internal/platform"
)

func TestIssueQRLoginNeedsSession(t *testing.T) {
	s := &Service{qr: newQRStore()}
	if _, err := s.IssueQRLogin(context.Background(), 1); err == nil {
		t.Fatal("issued a token with no tenant in context")
	}
	ctx := platform.WithTenant(context.Background(), 7)
	if _, err := s.IssueQRLogin(ctx, 0); err == nil {
		t.Fatal("issued a token with no employee")
	}
	got, err := s.IssueQRLogin(ctx, 3)
	if err != nil || len(got.Token) != 32 {
		t.Fatalf("issue: got %+v, %v", got, err)
	}
	if e := s.qr.entries[got.Token]; e.employeeID != 3 || e.tenantID != 7 {
		t.Fatalf("entry bound to wrong identity: %+v", e)
	}
}

func TestRedeemQRLoginIsOneTimeAndExpires(t *testing.T) {
	s := &Service{qr: newQRStore()}
	s.qr.entries["gone"] = qrEntry{employeeID: 1, tenantID: 1, expiresAt: time.Now().Add(-time.Second)}
	if _, err := s.RedeemQRLogin(context.Background(), "gone"); err != ErrQRLoginInvalid {
		t.Fatalf("expired: got %v", err)
	}
	if _, err := s.RedeemQRLogin(context.Background(), "unknown"); err != ErrQRLoginInvalid {
		t.Fatalf("unknown: got %v", err)
	}
	if _, ok := s.qr.entries["gone"]; ok {
		t.Fatal("expired token was not consumed")
	}
}
