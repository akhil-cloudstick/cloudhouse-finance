package config

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

var Razorpay *RazorpayClient

type RazorpayClient struct {
	KeyID         string
	KeySecret     string
	WebhookSecret string
	HTTPClient    *http.Client
}

type RazorpayOrder struct {
	ID       string `json:"id"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	Receipt  string `json:"receipt"`
	Status   string `json:"status"`
}

type razorpayErrorResponse struct {
	Error struct {
		Code        string `json:"code"`
		Description string `json:"description"`
	} `json:"error"`
}

type RazorpayPlan struct {
	ID string `json:"id"`
}

type RazorpaySubscription struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func NewRazorpayClient(cfg Config) *RazorpayClient {
	return &RazorpayClient{
		KeyID:         cfg.RazorpayKeyID,
		KeySecret:     cfg.RazorpayKeySecret,
		WebhookSecret: cfg.RazorpayWebhookSecret,
		HTTPClient:    &http.Client{Timeout: 15 * time.Second},
	}
}

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

func (c *RazorpayClient) VerifySignature(orderID, paymentID, signature string) bool {
	if c.KeySecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(c.KeySecret))
	mac.Write([]byte(orderID + "|" + paymentID))
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

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

func (c *RazorpayClient) CreateSubscription(planID string) (*RazorpaySubscription, error) {
	if c.KeyID == "" || c.KeySecret == "" {
		return nil, fmt.Errorf("razorpay: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set")
	}
	if planID == "" {
		return nil, fmt.Errorf("razorpay: planID is required")
	}
	body, err := json.Marshal(map[string]interface{}{
		"plan_id":         planID,
		"total_count":     120,
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

func (c *RazorpayClient) VerifySubscriptionSignature(subscriptionID, paymentID, signature string) bool {
	if c.KeySecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(c.KeySecret))
	mac.Write([]byte(paymentID + "|" + subscriptionID))
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func (c *RazorpayClient) VerifyWebhookSignature(body []byte, signature string) bool {
	if c.WebhookSecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(c.WebhookSecret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

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
