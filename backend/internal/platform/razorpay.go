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
	KeyID      string
	KeySecret  string
	HTTPClient *http.Client
}

// NewRazorpayClient builds a RazorpayClient from the app Config.
func NewRazorpayClient(cfg Config) *RazorpayClient {
	return &RazorpayClient{
		KeyID:      cfg.RazorpayKeyID,
		KeySecret:  cfg.RazorpayKeySecret,
		HTTPClient: &http.Client{Timeout: 15 * time.Second},
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
