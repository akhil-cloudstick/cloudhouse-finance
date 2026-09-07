package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/tenant"
)

// signWebhook reproduces platform.RazorpayClient.VerifyWebhookSignature's
// exact computation, independently, so this test proves the real
// production verification logic rather than assuming its own understanding
// of it — using the production signer itself here would let a bug in that
// signer pass its own check silently.
func signWebhook(t *testing.T, secret string, body []byte) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func openScratchDB(t *testing.T) *tenant.Repository {
	t.Helper()
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run this test")
	}
	t.Setenv("DB_NAME", name)
	db, err := platform.NewDatabase(platform.LoadConfig())
	if err != nil {
		t.Skipf("cannot reach test database %q: %v", name, err)
	}
	if err := platform.RegisterTenantScope(db); err != nil {
		t.Fatalf("registering tenant scope: %v", err)
	}
	return tenant.NewRepository(db)
}

func makeWebhookBody(t *testing.T, event, subscriptionID, status string, currentEnd int64) []byte {
	t.Helper()
	payload := map[string]interface{}{
		"event": event,
		"payload": map[string]interface{}{
			"subscription": map[string]interface{}{
				"entity": map[string]interface{}{
					"id":          subscriptionID,
					"status":      status,
					"current_end": currentEnd,
				},
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal webhook body: %v", err)
	}
	return body
}

// TestHandleWebhookRefusesAnUnverifiedSignature is the security-critical
// proof for this package: a webhook is an unauthenticated POST from the
// public internet, and the signature is its ONLY proof of origin. Anything
// less than a hard refusal here would let anyone activate/suspend any
// business's subscription just by guessing its Razorpay subscription id.
func TestHandleWebhookRefusesAnUnverifiedSignature(t *testing.T) {
	repo := openScratchDB(t)
	razorpay := &platform.RazorpayClient{KeySecret: "key-secret", WebhookSecret: "webhook-secret"}
	svc := NewService(nil, repo, nil, razorpay, nil, nil)

	body := makeWebhookBody(t, "subscription.activated", "sub_doesnotexist", "active", time.Now().Add(30*24*time.Hour).Unix())

	if err := svc.HandleWebhook(context.Background(), body, "not-the-real-signature"); err != ErrWebhookSignatureInvalid {
		t.Errorf("got %v, want ErrWebhookSignatureInvalid for a wrong signature", err)
	}

	// No WebhookSecret configured at all — must also refuse, not fall back
	// to trusting the payload.
	unconfigured := &platform.RazorpayClient{KeySecret: "key-secret"}
	svcUnconfigured := NewService(nil, repo, nil, unconfigured, nil, nil)
	if err := svcUnconfigured.HandleWebhook(context.Background(), body, "anything"); err != ErrWebhookSignatureInvalid {
		t.Errorf("got %v, want ErrWebhookSignatureInvalid when WebhookSecret is unset", err)
	}
}

// TestHandleWebhookActivatesAndSuspendsByEvent proves the lifecycle
// transitions HandleWebhook is actually for: a genuine, correctly-signed
// "charged" event activates the business and sets its next expiry from the
// payload; a "halted" event (retries exhausted) suspends it. Runs against a
// real scratch database — the tenant lookup and the tenant-table write both
// need a live dialector, the same reason platform's own tenant-scope SQL
// tests do.
func TestHandleWebhookActivatesAndSuspendsByEvent(t *testing.T) {
	repo := openScratchDB(t)
	razorpay := &platform.RazorpayClient{KeySecret: "key-secret", WebhookSecret: "webhook-secret"}
	svc := NewService(nil, repo, employee.NewRepository(nil), razorpay, nil, nil)

	ctx := platform.AllowCrossTenant(context.Background())
	tierName := fmt.Sprintf("billing-test-tier-%d", time.Now().UnixNano()%1_000_000_000)
	tier, err := repo.UpsertTier(ctx, tierName, 1)
	if err != nil {
		t.Fatalf("creating test tier: %v", err)
	}
	code := fmt.Sprintf("billing-test-%d", time.Now().UnixNano()%1_000_000_000)
	subID := "sub_" + code

	tn := &tenant.Tenant{
		Name:                   "Billing Webhook Test Co",
		Code:                   code,
		TierID:                 tier.ID,
		Status:                 tenant.StatusSuspended, // starts suspended, as if awaiting first payment
		RazorpaySubscriptionID: subID,
	}
	if err := repo.Create(ctx, tn); err != nil {
		t.Fatalf("creating test tenant: %v", err)
	}

	expectedEnd := time.Now().Add(30 * 24 * time.Hour).Unix()
	activated := makeWebhookBody(t, "subscription.activated", subID, "active", expectedEnd)
	sig := signWebhook(t, "webhook-secret", activated)

	if err := svc.HandleWebhook(context.Background(), activated, sig); err != nil {
		t.Fatalf("HandleWebhook(activated): %v", err)
	}
	got, err := repo.FindByID(ctx, tn.ID)
	if err != nil {
		t.Fatalf("reloading tenant: %v", err)
	}
	if got.Status != tenant.StatusActive {
		t.Errorf("status after activation = %q, want %q", got.Status, tenant.StatusActive)
	}
	if got.SubscriptionExpiresAt == nil || got.SubscriptionExpiresAt.Unix() != expectedEnd {
		t.Errorf("SubscriptionExpiresAt = %v, want unix %d", got.SubscriptionExpiresAt, expectedEnd)
	}

	halted := makeWebhookBody(t, "subscription.halted", subID, "halted", 0)
	sig = signWebhook(t, "webhook-secret", halted)
	if err := svc.HandleWebhook(context.Background(), halted, sig); err != nil {
		t.Fatalf("HandleWebhook(halted): %v", err)
	}
	got, err = repo.FindByID(ctx, tn.ID)
	if err != nil {
		t.Fatalf("reloading tenant: %v", err)
	}
	if got.Status != tenant.StatusSuspended {
		t.Errorf("status after halted = %q, want %q", got.Status, tenant.StatusSuspended)
	}
}

// TestHandleWebhookIgnoresAnUnknownSubscription proves a webhook for a
// subscription id this database has never heard of is dropped quietly
// rather than erroring — necessary so Razorpay's retry logic on a
// delivery this server will never recognize doesn't hammer the endpoint
// forever (see HandleWebhook's own doc comment).
func TestHandleWebhookIgnoresAnUnknownSubscription(t *testing.T) {
	repo := openScratchDB(t)
	razorpay := &platform.RazorpayClient{KeySecret: "key-secret", WebhookSecret: "webhook-secret"}
	svc := NewService(nil, repo, nil, razorpay, nil, nil)

	body := makeWebhookBody(t, "subscription.activated", "sub_totally_unknown_12345", "active", time.Now().Unix())
	sig := signWebhook(t, "webhook-secret", body)

	if err := svc.HandleWebhook(context.Background(), body, sig); err != nil {
		t.Errorf("HandleWebhook for an unknown subscription id returned %v, want nil (ignored)", err)
	}
}
