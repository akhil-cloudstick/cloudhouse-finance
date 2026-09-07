package platform

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// RazorpayClient calls Razorpay's Orders API
// (https://razorpay.com/docs/api/orders/) to create orders for customer-app
// online loan payments, and verifies the checkout signature Razorpay hands
// back after a successful payment. KeyID/KeySecret come from
// Config.RazorpayKeyID/RazorpayKeySecret (plain env vars — see
// platform/config.go).
type RazorpayClient struct {
	KeyID     string
	KeySecret string
	// WebhookSecret is the SEPARATE secret Razorpay signs webhook payloads
	// with (configured on the Razorpay dashboard's webhook settings, not the
	// same value as KeySecret) — used only by VerifyWebhookSignature.
	WebhookSecret string
	HTTPClient    *http.Client
}

// NewRazorpayClient builds a RazorpayClient from the app Config.
func NewRazorpayClient(cfg Config) *RazorpayClient {
	return &RazorpayClient{
		KeyID:         cfg.RazorpayKeyID,
		KeySecret:     cfg.RazorpayKeySecret,
		WebhookSecret: cfg.RazorpayWebhookSecret,
		HTTPClient:    &http.Client{Timeout: 15 * time.Second},
	}
}

// RazorpayOrder is the normalized result of a successful order creation.
type RazorpayOrder struct {
	ID       string `json:"id"`
	Amount   int64  `json:"amount"` // paise
	Currency string `json:"currency"`
	Receipt  string `json:"receipt"`
	Status   string `json:"status"`
}

// razorpayErrorResponse mirrors Razorpay's error envelope.
type razorpayErrorResponse struct {
	Error struct {
		Code        string `json:"code"`
		Description string `json:"description"`
	} `json:"error"`
}

// CreateOrder creates a Razorpay order for amountPaise (INR paise, i.e.
// rupees * 100) tagged with receipt (the loan number, so it shows up
// against the right loan in the Razorpay dashboard). Uses Razorpay's
// standard HTTP Basic Auth (KeyID:KeySecret) — no OAuth dance needed.
func (c *RazorpayClient) CreateOrder(amountPaise int64, receipt string) (*RazorpayOrder, error) {
	if c.KeyID == "" || c.KeySecret == "" {
		return nil, fmt.Errorf("razorpay: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set")
	}
	if amountPaise <= 0 {
		return nil, fmt.Errorf("razorpay: amount must be greater than zero")
	}

	body, err := json.Marshal(map[string]interface{}{
		"amount":   amountPaise,
		"currency": "INR",
		"receipt":  receipt,
	})
	if err != nil {
		return nil, fmt.Errorf("razorpay: encode request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.razorpay.com/v1/orders", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("razorpay: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(c.KeyID, c.KeySecret)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("razorpay: request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("razorpay: read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var errResp razorpayErrorResponse
		if jsonErr := json.Unmarshal(respBody, &errResp); jsonErr == nil && errResp.Error.Description != "" {
			return nil, fmt.Errorf("razorpay: %s (%s)", errResp.Error.Description, errResp.Error.Code)
		}
		return nil, fmt.Errorf("razorpay: unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var order RazorpayOrder
	if err := json.Unmarshal(respBody, &order); err != nil {
		return nil, fmt.Errorf("razorpay: decode response: %w (body=%s)", err, string(respBody))
	}
	return &order, nil
}

// VerifySignature checks the signature Razorpay's checkout returns after a
// successful payment: HMAC-SHA256 of "orderID|paymentID" keyed by
// KeySecret, hex-encoded, compared to signature in constant time so a
// timing attack can't be used to guess it byte-by-byte.
func (c *RazorpayClient) VerifySignature(orderID, paymentID, signature string) bool {
	if c.KeySecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(c.KeySecret))
	mac.Write([]byte(orderID + "|" + paymentID))
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

// --- Subscriptions API (plan Step 10 — per-business recurring billing) ---
//
// A separate, smaller surface from the Orders API above: a Plan is the
// recurring price (created once per tier, cached as Tier.RazorpayPlanID), a
// Subscription binds one business to that Plan and is what the customer
// checkout widget actually opens against. Razorpay then auto-charges on
// schedule and reports outcomes via webhook (see VerifyWebhookSignature) —
// there is no "poll for payment" step the way the one-off Orders flow has.

// RazorpayPlan is the normalized result of creating a recurring Plan.
type RazorpayPlan struct {
	ID string `json:"id"`
}

// CreatePlan creates a monthly recurring Plan at amountPaise. One Plan is
// meant to be created per tier and reused for every business subscribing to
// it — see Tier.RazorpayPlanID's doc comment for why that caching happens
// lazily rather than up front.
func (c *RazorpayClient) CreatePlan(amountPaise int64, name string) (*RazorpayPlan, error) {
	if c.KeyID == "" || c.KeySecret == "" {
		return nil, fmt.Errorf("razorpay: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set")
	}
	if amountPaise <= 0 {
		return nil, fmt.Errorf("razorpay: plan amount must be greater than zero")
	}
	body, err := json.Marshal(map[string]interface{}{
		"period":   "monthly",
		"interval": 1,
		"item": map[string]interface{}{
			"name":     name,
			"amount":   amountPaise,
			"currency": "INR",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("razorpay: encode plan request: %w", err)
	}
	var plan RazorpayPlan
	if err := c.doJSON(http.MethodPost, "https://api.razorpay.com/v1/plans", body, &plan); err != nil {
		return nil, err
	}
	return &plan, nil
}

// RazorpaySubscription is the normalized result of creating a Subscription.
type RazorpaySubscription struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// subscriptionTotalCount is passed to Razorpay as the number of billing
// cycles to authorize up front. Razorpay's Subscriptions API requires a
// finite count rather than accepting "indefinite" — 120 monthly cycles (10
// years) is the practical stand-in for that, renewed by creating a fresh
// subscription well before it would ever run out.
const subscriptionTotalCount = 120

// CreateSubscription creates a Subscription for one business against planID.
// The returned ID is what the frontend's Razorpay checkout widget opens
// against (subscription_id, not order_id) to collect the customer's
// authorization for the recurring charge.
func (c *RazorpayClient) CreateSubscription(planID string) (*RazorpaySubscription, error) {
	if c.KeyID == "" || c.KeySecret == "" {
		return nil, fmt.Errorf("razorpay: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set")
	}
	if planID == "" {
		return nil, fmt.Errorf("razorpay: planID is required")
	}
	body, err := json.Marshal(map[string]interface{}{
		"plan_id":         planID,
		"total_count":     subscriptionTotalCount,
		"customer_notify": 1,
	})
	if err != nil {
		return nil, fmt.Errorf("razorpay: encode subscription request: %w", err)
	}
	var sub RazorpaySubscription
	if err := c.doJSON(http.MethodPost, "https://api.razorpay.com/v1/subscriptions", body, &sub); err != nil {
		return nil, err
	}
	return &sub, nil
}

// VerifySubscriptionSignature checks the signature Razorpay's checkout
// returns after a subscription's first authorizing payment: HMAC-SHA256 of
// "paymentID|subscriptionID" — note the field order differs from the plain
// Orders flow's "orderID|paymentID" in VerifySignature above; Razorpay
// defines each independently and they are not interchangeable.
func (c *RazorpayClient) VerifySubscriptionSignature(subscriptionID, paymentID, signature string) bool {
	if c.KeySecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(c.KeySecret))
	mac.Write([]byte(paymentID + "|" + subscriptionID))
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

// VerifyWebhookSignature checks the X-Razorpay-Signature header Razorpay
// sends with every webhook delivery: HMAC-SHA256 of the exact raw request
// body, keyed by WebhookSecret (a DIFFERENT secret than KeySecret — see its
// field doc comment). Never trust a webhook payload this fails on; a
// webhook is an unauthenticated POST from the public internet whose ONLY
// proof of origin is this signature.
func (c *RazorpayClient) VerifyWebhookSignature(body []byte, signature string) bool {
	if c.WebhookSecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(c.WebhookSecret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

// doJSON is the shared request/response plumbing CreatePlan and
// CreateSubscription both need — basic auth, JSON body, Razorpay's error
// envelope on failure. CreateOrder above predates this helper and is left
// as its own inline flow rather than risking a behavior change on the
// payment path real customer money already goes through.
func (c *RazorpayClient) doJSON(method, url string, body []byte, out interface{}) error {
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("razorpay: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(c.KeyID, c.KeySecret)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("razorpay: request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("razorpay: read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		var errResp razorpayErrorResponse
		if jsonErr := json.Unmarshal(respBody, &errResp); jsonErr == nil && errResp.Error.Description != "" {
			return fmt.Errorf("razorpay: %s (%s)", errResp.Error.Description, errResp.Error.Code)
		}
		return fmt.Errorf("razorpay: unexpected status %d: %s", resp.StatusCode, string(respBody))
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("razorpay: decode response: %w (body=%s)", err, string(respBody))
	}
	return nil
}
