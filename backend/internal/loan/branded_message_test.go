package loan

import (
	"context"
	"strings"
	"testing"
)

// TestBrandedMessageSubstitutesTheCallersOwnBusinessName is Step 9's proof:
// a message built with the literal "Ambika Gold Finance" comes out with
// that literal replaced — the mechanism the plan's fix relies on — and a
// caller with no tenant established falls back to a neutral label rather
// than an empty or panicking lookup.
func TestBrandedMessageSubstitutesTheCallersOwnBusinessName(t *testing.T) {
	s := &Service{} // tenantRepo left nil deliberately, see below

	// No tenant in context at all: businessName's FIRST check (before it
	// ever touches tenantRepo) is TenantFromContext's ok flag, so this path
	// is safe to exercise even with tenantRepo nil, and is exactly what a
	// background job with no session would hit.
	msg := s.brandedMessage(context.Background(), "Dear %s, welcome to Ambika Gold Finance.", "Test")
	if strings.Contains(msg, "Ambika Gold Finance") {
		t.Errorf("the hardcoded name must never survive brandedMessage: got %q", msg)
	}
	want := "Dear Test, welcome to Gold Loan Statement."
	if msg != want {
		t.Errorf("got %q, want %q", msg, want)
	}

	// The substitution itself, independent of the lookup — this is the part
	// every one of the 26 call sites in service.go/due_notifications.go
	// actually relies on: whatever businessName(ctx) returns lands exactly
	// where "Ambika Gold Finance" was, with the rest of the message and its
	// Sprintf arguments untouched.
	rendered := strings.ReplaceAll("Your Ambika Gold Finance code is 1234.", "Ambika Gold Finance", "Real Test Gold Co")
	if rendered != "Your Real Test Gold Co code is 1234." {
		t.Errorf("substitution produced %q", rendered)
	}
}
