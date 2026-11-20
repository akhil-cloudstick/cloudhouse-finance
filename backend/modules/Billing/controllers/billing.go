package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

var (
	ErrWebhookSignatureInvalid = common.NewBadRequest("invalid webhook signature")
)

const expiryReminderWindow = 7 * 24 * time.Hour

const reminderCooldown = 20 * time.Hour

type confirmRequest struct {
	RazorpaySubscriptionID string `json:"razorpay_subscription_id" binding:"required"`
	RazorpayPaymentID      string `json:"razorpay_payment_id" binding:"required"`
	RazorpaySignature      string `json:"razorpay_signature" binding:"required"`
}

type Status struct {
	Code                  string     `json:"code"`
	TierName              string     `json:"tier_name"`
	PriceInPaise          int64      `json:"price_in_paise"`
	BusinessStatus        string     `json:"business_status"`
	HasSubscription       bool       `json:"has_subscription"`
	SubscriptionExpiresAt *time.Time `json:"subscription_expires_at,omitempty"`
	GracePeriodEndsAt     *time.Time `json:"grace_period_ends_at,omitempty"`
}

type SubscribeResult struct {
	SubscriptionID string `json:"subscription_id"`
	KeyID          string `json:"key_id"`
}

type razorpayWebhookEvent struct {
	Event   string `json:"event"`
	Payload struct {
		Subscription struct {
			Entity struct {
				ID         string `json:"id"`
				Status     string `json:"status"`
				CurrentEnd int64  `json:"current_end"`
			} `json:"entity"`
		} `json:"subscription"`
	} `json:"payload"`
}

func getStatus(ctx context.Context, tenantID uint) (*Status, error) {
	t, err := common.FindTenantByID(ctx, tenantID)
	if err != nil {
		return nil, common.NewNotFound("this business has no subscription on file")
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

func subscribe(ctx context.Context, tenantID uint) (*SubscribeResult, error) {
	if (config.Razorpay == nil) || config.Razorpay.
		KeyID == "" {
		return nil, common.NewUnavailable("billing is not configured")
	}
	t, err := common.FindTenantByID(ctx, tenantID)
	if err != nil {
		return nil, common.NewNotFound("this business has no subscription on file")
	}
	if t.RazorpaySubscriptionID != "" && t.Status != commonModels.StatusSuspended && t.Status != "cancelled" {
		return nil, common.NewConflict("this business already has an active subscription")
	}
	tier := t.Tier
	if tier.PriceInPaise <= 0 {
		return nil, common.NewConflict("this business's plan has no billing price configured — contact support")
	}
	if tier.RazorpayPlanID == "" {
		plan, err := config.Razorpay.
			CreatePlan(tier.PriceInPaise, tier.Name+" plan")
		if err != nil {
			return nil, fmt.Errorf("creating razorpay plan: %w", err)
		}
		tier.RazorpayPlanID = plan.ID
		if err := common.SaveTier(ctx, &tier); err != nil {
			return nil, fmt.Errorf("saving plan id: %w", err)
		}
	}
	sub, err := config.Razorpay.
		CreateSubscription(tier.RazorpayPlanID)
	if err != nil {
		return nil, fmt.Errorf("creating razorpay subscription: %w", err)
	}
	t.RazorpaySubscriptionID = sub.ID
	if err := common.PersistTenant(ctx, t); err != nil {
		return nil, err
	}
	return &SubscribeResult{SubscriptionID: sub.ID, KeyID: config.Razorpay.
		KeyID}, nil
}

func confirmSubscription(ctx context.Context, tenantID uint, subscriptionID, paymentID, signature string) error {
	if config.Razorpay == nil {
		return common.NewUnavailable("billing is not configured")
	}
	if !config.Razorpay.
		VerifySubscriptionSignature(subscriptionID, paymentID, signature) {
		return ErrWebhookSignatureInvalid
	}
	t, err := common.FindTenantByID(ctx, tenantID)
	if err != nil {
		return common.NewNotFound("this business has no subscription on file")
	}
	if t.RazorpaySubscriptionID != subscriptionID {
		return common.NewBadRequest("subscription does not belong to this business")
	}
	if t.Status == commonModels.StatusSuspended {
		t.Status = commonModels.StatusActive
	}
	t.GracePeriodEndsAt = nil
	return common.PersistTenant(ctx, t)
}

func handleWebhook(ctx context.Context, body []byte, signature string) error {
	if config.Razorpay == nil {
		return common.NewUnavailable("billing is not configured")
	}
	if !config.Razorpay.
		VerifyWebhookSignature(body, signature) {
		return ErrWebhookSignatureInvalid
	}
	var evt razorpayWebhookEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		return common.NewBadRequest("malformed webhook payload")
	}
	sub := evt.Payload.Subscription.Entity
	if sub.ID == "" {
		return nil
	}
	tenantCtx := config.AllowCrossTenant(ctx)
	t, err := common.FindByRazorpaySubscriptionID(tenantCtx, sub.ID)
	if err != nil {
		return nil
	}
	switch evt.Event {
	case "subscription.activated", "subscription.charged":
		t.Status = commonModels.StatusActive
		if sub.CurrentEnd > 0 {
			end := time.Unix(sub.CurrentEnd, 0).UTC()
			t.SubscriptionExpiresAt = &end
		}
		t.GracePeriodEndsAt = nil
		t.SubscriptionNotifiedAt = nil
	case "subscription.pending":
		t.Status = "grace"
		graceEnd := time.Now().UTC().Add(72 * time.Hour)
		t.GracePeriodEndsAt = &graceEnd
	case "subscription.halted", "subscription.cancelled", "subscription.completed":
		t.Status = commonModels.StatusSuspended
	default:
		return nil
	}
	return common.PersistTenant(tenantCtx, t)
}

func NotifyExpiringSubscriptions(ctx context.Context) {
	all, err := common.FindTenants(config.AllowCrossTenant(ctx))
	if err != nil {
		return
	}
	now := time.Now().UTC()
	for i := range all {
		t := all[i]
		if t.Status == "cancelled" {
			continue
		}
		if t.SubscriptionExpiresAt == nil {
			continue // never subscribed, or a comped/unbilled tier — nothing to remind about
		}
		if t.SubscriptionExpiresAt.After(now.Add(expiryReminderWindow)) {
			continue
		}
		if t.SubscriptionNotifiedAt != nil && now.Sub(*t.SubscriptionNotifiedAt) < reminderCooldown {
			continue
		}
		tenantCtx := config.WithTenant(ctx, t.ID)
		notifyAdmins(tenantCtx, t, now)
		t.SubscriptionNotifiedAt = &now
		_ = common.PersistTenant(config.AllowCrossTenant(ctx), &t)
	}
}

func notifyAdmins(ctx context.Context, t commonModels.Tenant, now time.Time) {
	admins, err := common.FindByRole(ctx, "Administrator")
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
		if err := common.CheckAndRecordUsage(config.BaseDB,
			t.ID, "whatsapp"); err != nil {
			continue
		}
		sendErr := config.WhatsApp.
			Send(ctx, admin.Phone, message)
		{
			logRec := &commonModels.CommunicationLog{
				RecipientName:     admin.Name,
				RecipientPhone:    admin.Phone,
				ChatID:            common.NormalizeChatID(admin.Phone),
				Channel:           commonModels.ChannelWhatsApp,
				TriggerType:       "billing_reminder",
				MessageBody:       message,
				RelatedEntityType: "tenant",
				RelatedEntityID:   t.ID,
				Status:            commonModels.StatusSent,
			}
			if sendErr != nil {
				logRec.Status = commonModels.StatusFailed
				logRec.ErrorMessage = sendErr.Error()
			}
			_ = common.InsertCommLog(ctx, logRec)
		}
	}
}

func GetBillingStatus(c echo.Context) error {
	ctx := auth.RequestContext(c)
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return common.FailErr(c, common.NewBadRequest("no business on this session"))
	}
	status, err := getStatus(ctx, tenantID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, status)
}

func Subscribe(c echo.Context) error {
	ctx := auth.RequestContext(c)
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return common.FailErr(c, common.NewBadRequest("no business on this session"))
	}
	res, err := subscribe(ctx, tenantID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, res)
}

func ConfirmSubscription(c echo.Context) error {
	ctx := auth.RequestContext(c)
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return common.FailErr(c, common.NewBadRequest("no business on this session"))
	}
	var req confirmRequest
	if err := common.BindJSON(c, &req); err != nil {
		return common.FailErr(c, common.NewBadRequest("razorpay_subscription_id, razorpay_payment_id and razorpay_signature are required"))
	}
	if err := confirmSubscription(ctx, tenantID, req.RazorpaySubscriptionID, req.RazorpayPaymentID, req.RazorpaySignature); err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"confirmed": true})
}

func RazorpayWebhook(c echo.Context) error {
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		c.Response().WriteHeader(http.StatusBadRequest)
		return nil
	}
	signature := c.Request().Header.Get("X-Razorpay-Signature")
	ctx := config.AllowCrossTenant(c.Request().Context())
	if err := handleWebhook(ctx, body, signature); err != nil {
		if err == ErrWebhookSignatureInvalid {
			c.Response().WriteHeader(http.StatusBadRequest)
			return nil
		}
	}
	c.Response().WriteHeader(http.StatusOK)
	return nil
}
