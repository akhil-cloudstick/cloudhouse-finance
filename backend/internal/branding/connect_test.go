package branding

import (
	"strings"
	"testing"
	"time"
)

func TestConnectCodeIssueAndRedeem(t *testing.T) {
	s := newConnectStore()
	now := time.Now()
	code, expires, err := s.issue("ambika", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != connectCodeLen {
		t.Fatalf("code %q: want %d chars", code, connectCodeLen)
	}
	for _, r := range code {
		if !strings.ContainsRune(connectAlphabet, r) {
			t.Fatalf("code %q has %q outside the alphabet", code, r)
		}
	}
	if !expires.Equal(now.Add(ConnectCodeTTL)) {
		t.Fatalf("expires %v, want %v", expires, now.Add(ConnectCodeTTL))
	}

	got, ok := s.lookup(normalizeConnectCode(" "+strings.ToLower(code[:3])+"-"+code[3:]), now.Add(time.Minute))
	if !ok || got != "ambika" {
		t.Fatalf("lookup = %q, %v; want ambika, true", got, ok)
	}
	if _, ok := s.lookup(code, expires); ok {
		t.Fatal("code still redeemable at its expiry")
	}
	if _, ok := s.lookup("ZZZZZZ", now); ok {
		t.Fatal("unknown code redeemed")
	}
}
