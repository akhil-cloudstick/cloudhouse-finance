// Package billing implements multi-tenancy plan Step 10: a business's own
// recurring subscription, billed monthly via Razorpay Subscriptions against
// its Tier's price. Deliberately narrow in scope — see the doc comments
// below for what is and isn't handled yet.
package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/tenant"
)

var (
	ErrRazorpayNotConfigured = httpx.NewUnavailable("billing is not configured")
	ErrTierHasNoPrice        = httpx.NewConflict("this business's plan has no billing price configured — contact support")
	ErrAlreadySubscribed     = httpx.NewConflict("this business already has an active subscription")
	ErrNoSubscription        = httpx.NewNotFound("this business has no subscription on file")
	// ErrWebhookSignatureInvalid is returned (and the event refused) when a
	// webhook's signature does not verify. A webhook is an unauthenticated
	// POST from the public internet; this signature is its only proof of
	// origin, and there is deliberately no fallback that trusts the payload
	// anyway (see attack-surface item 13 in the plan).
	ErrWebhookSignatureInvalid = httpx.NewBadRequest("invalid webhook signature")
)

// expiryReminderWindow is how far ahead of SubscriptionExpiresAt the
// reminder job starts notifying — see NotifyExpiringSubscriptions.
const expiryReminderWindow = 7 * 24 * time.Hour

// reminderCooldown is the minimum gap between two reminders to the same
// business, so a job ticking every few hours doesn't message someone
// several times a day for the whole week their subscription is expiring.
const reminderCooldown = 20 * time.Hour

// Service implements Step 10's billing rules.
type Service struct {
	db           *gorm.DB // usage-cap bookkeeping only (platform.CheckAndRecordUsage) — never queried directly here
	tenantRepo   *tenant.Repository
	employeeRepo *employee.Repository
	razorpay     *platform.RazorpayClient
	whatsapp     platform.SMSSender
	commlogRepo  *commlog.Repository
}

func NewService(
	db *gorm.DB,
	tenantRepo *tenant.Repository,
	employeeRepo *employee.Repository,
	razorpay *platform.RazorpayClient,
	whatsapp platform.SMSSender,
	commlogRepo *commlog.Repository,
) *Service {
	return &Service{
		db:           db,
		tenantRepo:   tenantRepo,
		employeeRepo: employeeRepo,
		razorpay:     razorpay,
		whatsapp:     whatsapp,
		commlogRepo:  commlogRepo,
	}
}

// Status is what GET /billing/status returns — a business's own admin
// checking where their subscription stands.
type Status struct {
	Code                  string     `json:"code"` // tenant slug, e.g. "acme" → /login/acme
	TierName              string     `json:"tierName"`
	PriceInPaise          int64      `json:"priceInPaise"`
	BusinessStatus        string     `json:"businessStatus"` // tenant.Status — active/grace/suspended/...
	HasSubscription       bool       `json:"hasSubscription"`
	SubscriptionExpiresAt *time.Time `json:"subscriptionExpiresAt,omitempty"`
	GracePeriodEndsAt     *time.Time `json:"gracePeriodEndsAt,omitempty"`
}

// GetStatus reads the caller's own business's billing state. No cross-
// tenant reach here — tenantID comes from the caller's own JWT, same as
// every other tenant-scoped read in this codebase.
func (s *Service) GetStatus(ctx context.Context, tenantID uint) (*Status, error) {
	t, err := s.tenantRepo.FindByID(ctx, tenantID)
	if err != nil {
		return nil, ErrNoSubscription
	}
	return &Status{
		Code:                  t.Code,
		TierName:              t.Tier.Name,
		PriceInPaise:          t.Tier.PriceInPaise,
		BusinessStatus:        t.Status,
		HasSubscription:       t.RazorpaySubscriptionID != "",
		SubscriptionExpiresAt: t.SubscriptionExpiresAt,
		GracePeriodEndsAt:     t.GracePeriodEndsAt,
	}, nil
}

// SubscribeResult is what the frontend needs to open Razorpay's checkout
// widget in subscription mode.
type SubscribeResult struct {
	SubscriptionID string `json:"subscriptionId"`
	KeyID          string `json:"keyId"`
}

// Subscribe creates a Razorpay Subscription for the caller's own business
// against its tier's price, lazily creating (and caching) the tier's
// Razorpay Plan on first use. Returns the subscription id for the frontend
// to open checkout against — the subscription is NOT active yet; that only
// happens once the customer completes authorization and Razorpay reports
// success, via ConfirmSubscription (immediate UI feedback) and the webhook
// (authoritative — see HandleWebhook).
func (s *Service) Subscribe(ctx context.Context, tenantID uint) (*SubscribeResult, error) {
	if s.razorpay == nil || s.razorpay.KeyID == "" {
		return nil, ErrRazorpayNotConfigured
	}
	t, err := s.tenantRepo.FindByID(ctx, tenantID)
	if err != nil {
		return nil, ErrNoSubscription
	}
	if t.RazorpaySubscriptionID != "" && t.Status != tenant.StatusSuspended && t.Status != tenant.StatusCancelled {
		return nil, ErrAlreadySubscribed
	}
	tier := t.Tier
	if tier.PriceInPaise <= 0 {
		return nil, ErrTierHasNoPrice
	}

	if tier.RazorpayPlanID == "" {
		plan, err := s.razorpay.CreatePlan(tier.PriceInPaise, tier.Name+" plan")
		if err != nil {
			return nil, fmt.Errorf("creating razorpay plan: %w", err)
		}
		tier.RazorpayPlanID = plan.ID
		if err := s.tenantRepo.SaveTier(ctx, &tier); err != nil {
			return nil, fmt.Errorf("saving plan id: %w", err)
		}
	}

	sub, err := s.razorpay.CreateSubscription(tier.RazorpayPlanID)
	if err != nil {
		return nil, fmt.Errorf("creating razorpay subscription: %w", err)
	}

	t.RazorpaySubscriptionID = sub.ID
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}

	return &SubscribeResult{SubscriptionID: sub.ID, KeyID: s.razorpay.KeyID}, nil
}

// ConfirmSubscription is called by the frontend immediately after Razorpay's
// checkout widget reports success, for fast UI feedback — it verifies the
// checkout signature and marks the subscription active right away rather
// than making the admin wait for the webhook to arrive. The webhook
// (HandleWebhook) remains the AUTHORITATIVE source for the actual billing
// period dates and every subsequent renewal; this call never sets
// SubscriptionExpiresAt itself; it only clears any "suspended for
// non-payment" state so the business isn't left locked out until the
// webhook happens to arrive.
func (s *Service) ConfirmSubscription(ctx context.Context, tenantID uint, subscriptionID, paymentID, signature string) error {
	if s.razorpay == nil {
		return ErrRazorpayNotConfigured
	}
	if !s.razorpay.VerifySubscriptionSignature(subscriptionID, paymentID, signature) {
		return ErrWebhookSignatureInvalid
	}
	t, err := s.tenantRepo.FindByID(ctx, tenantID)
	if err != nil {
		return ErrNoSubscription
	}
	if t.RazorpaySubscriptionID != subscriptionID {
		return httpx.NewBadRequest("subscription does not belong to this business")
	}
	if t.Status == tenant.StatusSuspended {
		t.Status = tenant.StatusActive
	}
	t.GracePeriodEndsAt = nil
	return s.tenantRepo.Update(ctx, t)
}

// razorpayWebhookEvent covers only the fields this handler reads out of
// Razorpay's Subscriptions webhook payload
// (https://razorpay.com/docs/webhooks/payloads/subscriptions/) — not a full
// mirror of the schema.
type razorpayWebhookEvent struct {
	Event   string `json:"event"`
	Payload struct {
		Subscription struct {
			Entity struct {
				ID         string `json:"id"`
				Status     string `json:"status"`
				CurrentEnd int64  `json:"current_end"` // unix seconds
			} `json:"entity"`
		} `json:"subscription"`
	} `json:"payload"`
}

// HandleWebhook processes a Razorpay Subscriptions webhook delivery. body
// MUST be the exact raw request bytes (signature is computed over them) and
// signature MUST come from the X-Razorpay-Signature header — this is the
// ONLY caller in the codebase permitted to run cross-tenant with no
// authenticated actor, because a webhook has neither: it is Razorpay's
// server, not a logged-in user of any business, and the business it is
// ABOUT is something this method has to resolve FROM the payload, not
// something the caller already knows.
func (s *Service) HandleWebhook(ctx context.Context, body []byte, signature string) error {
	if s.razorpay == nil {
		return ErrRazorpayNotConfigured
	}
	if !s.razorpay.VerifyWebhookSignature(body, signature) {
		return ErrWebhookSignatureInvalid
	}
	var evt razorpayWebhookEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		return httpx.NewBadRequest("malformed webhook payload")
	}
	sub := evt.Payload.Subscription.Entity
	if sub.ID == "" {
		// Not a subscription-lifecycle event this handler cares about
		// (Razorpay's webhook endpoint fans out many event families) —
		// nothing to do, not an error.
		return nil
	}

	tenantCtx := platform.AllowCrossTenant(ctx)
	t, err := s.tenantRepo.FindByRazorpaySubscriptionID(tenantCtx, sub.ID)
	if err != nil {
		// A subscription we have no record of — ignore rather than error,
		// so an unrelated/stale webhook delivery can't make Razorpay's
		// retry logic hammer this endpoint.
		return nil
	}

	switch evt.Event {
	case "subscription.activated", "subscription.charged":
		t.Status = tenant.StatusActive
		if sub.CurrentEnd > 0 {
			end := time.Unix(sub.CurrentEnd, 0).UTC()
			t.SubscriptionExpiresAt = &end
		}
		t.GracePeriodEndsAt = nil
		t.SubscriptionNotifiedAt = nil // reset the reminder dedupe for the new cycle
	case "subscription.pending":
		// A charge attempt failed but Razorpay is still retrying — a grace
		// window, not an immediate cutoff. Writing is still allowed at
		// this status (see tenant.Tenant.CanWrite's doc comment).
		t.Status = tenant.StatusGrace
		graceEnd := time.Now().UTC().Add(72 * time.Hour)
		t.GracePeriodEndsAt = &graceEnd
	case "subscription.halted", "subscription.cancelled", "subscription.completed":
		// Halted = retries exhausted; cancelled/completed = no further
		// charges will happen. All three mean the paid period is over.
		t.Status = tenant.StatusSuspended
	default:
		// Every other event family (payment.*, invoice.*, etc.) — nothing
		// this handler tracks yet.
		return nil
	}

	return s.tenantRepo.Update(tenantCtx, t)
}

// NotifyExpiringSubscriptions is the background job's entry point (see
// app.StartBackgroundJobs) — WhatsApps every business's own Administrator(s)
// once its subscription is within expiryReminderWindow of expiring, or
// already past expiry, at most once per reminderCooldown.
//
// Deliberately NOT gated on tenant.Status == Active the way the due/overdue
// loan sweep is: a business already in Grace or PastDue because a payment
// failed is exactly who most needs the reminder, so this walks every
// non-cancelled business directly rather than reusing tenant.ForEachActive.
func (s *Service) NotifyExpiringSubscriptions(ctx context.Context) {
	all, err := s.tenantRepo.FindAll(platform.AllowCrossTenant(ctx))
	if err != nil {
		return
	}
	now := time.Now().UTC()
	for i := range all {
		t := all[i]
		if t.Status == tenant.StatusCancelled {
			continue
		}
		if t.SubscriptionExpiresAt == nil {
			continue // never subscribed, or a comped/unbilled tier — nothing to remind about
		}
		if t.SubscriptionExpiresAt.After(now.Add(expiryReminderWindow)) {
			continue // not due for a reminder yet
		}
		if t.SubscriptionNotifiedAt != nil && now.Sub(*t.SubscriptionNotifiedAt) < reminderCooldown {
			continue
		}

		tenantCtx := platform.WithTenant(ctx, t.ID)
		s.notifyAdmins(tenantCtx, t, now)

		t.SubscriptionNotifiedAt = &now
		_ = s.tenantRepo.Update(platform.AllowCrossTenant(ctx), &t)
	}
}

func (s *Service) notifyAdmins(ctx context.Context, t tenant.Tenant, now time.Time) {
	admins, err := s.employeeRepo.FindByRole(ctx, "Administrator")
	if err != nil {
		return
	}
	var message string
	if t.SubscriptionExpiresAt.Before(now) {
		message = fmt.Sprintf("Your %s subscription has EXPIRED. Please renew to avoid service interruption.", t.Name)
	} else {
		daysLeft := int(time.Until(*t.SubscriptionExpiresAt).Hours() / 24)
		message = fmt.Sprintf("Your %s subscription expires in %d day(s). Please renew soon to avoid service interruption.", t.Name, daysLeft)
	}

	for _, admin := range admins {
		if admin.Phone == "" {
			continue
		}
		if err := platform.CheckAndRecordUsage(s.db, t.ID, platform.UsageWhatsApp); err != nil {
			// Usage cap exceeded for this business's shared WhatsApp
			// quota — best-effort reminder, never worth failing the whole
			// job over, but also never worth sending anyway once refused.
			continue
		}
		sendErr := s.whatsapp.Send(admin.Phone, message)
		if s.commlogRepo != nil {
			logRec := &commlog.CommunicationLog{
				RecipientName:     admin.Name,
				RecipientPhone:    admin.Phone,
				ChatID:            commlog.NormalizeChatID(admin.Phone),
				Channel:           commlog.ChannelWhatsApp,
				TriggerType:       commlog.TriggerBillingReminder,
				MessageBody:       message,
				RelatedEntityType: "tenant",
				RelatedEntityID:   t.ID,
				Status:            commlog.StatusSent,
			}
			if sendErr != nil {
				logRec.Status = commlog.StatusFailed
				logRec.ErrorMessage = sendErr.Error()
			}
			_ = s.commlogRepo.Create(ctx, logRec)
		}
	}
}
