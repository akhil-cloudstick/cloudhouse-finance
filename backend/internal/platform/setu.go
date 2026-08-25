package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// SetuClient calls Setu's Data Gateway PAN verification API
// (https://docs.setu.co/data). BaseURL points at the sandbox
// (https://dg-sandbox.setu.co) or production (https://dg.setu.co) host —
// see Config.SetuBaseURL.
type SetuClient struct {
	ClientID        string
	ClientSecret    string
	ProductInstance string
	BaseURL         string
	HTTPClient      *http.Client
}

// NewSetuClient builds a SetuClient from the app Config.
func NewSetuClient(cfg Config) *SetuClient {
	return &SetuClient{
		ClientID:        cfg.SetuClientID,
		ClientSecret:    cfg.SetuClientSecret,
		ProductInstance: cfg.SetuProductInstance,
		BaseURL:         cfg.SetuBaseURL,
		HTTPClient:      &http.Client{Timeout: 15 * time.Second},
	}
}

// IsSandbox reports whether BaseURL points at Setu's sandbox host. Sandbox
// always returns the same fixed dummy name for any test PAN, regardless of
// which real customer it's checked against — callers that compare the
// returned name to a customer's on-file name (see
// internal/customer.namesMatch) should skip that comparison in sandbox
// mode, since it would misfire on every real customer name.
func (c *SetuClient) IsSandbox() bool {
	return strings.Contains(c.BaseURL, "sandbox")
}

// PANVerificationResult is the normalized result of a PAN verification call.
type PANVerificationResult struct {
	Verification         string `json:"verification"` // "SUCCESS" or "failed"
	Message              string `json:"message"`
	FullName             string `json:"full_name,omitempty"`
	Category             string `json:"category,omitempty"`
	AadhaarSeedingStatus string `json:"aadhaar_seeding_status,omitempty"`
	TraceID              string `json:"traceId,omitempty"`
}

// setuPANResponse mirrors the raw success envelope from
// POST /api/verify/pan (see Success-ValidPAN in Setu's OpenAPI spec).
type setuPANResponse struct {
	Data struct {
		AadhaarSeedingStatus string `json:"aadhaar_seeding_status"`
		Category             string `json:"category"`
		FullName             string `json:"full_name"`
	} `json:"data"`
	Message      string `json:"message"`
	Verification string `json:"verification"`
	TraceID      string `json:"traceId"`
}

// setuErrorResponse mirrors Setu's error envelope (400/500 responses).
type setuErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Detail  string `json:"detail"`
		TraceID string `json:"traceId"`
	} `json:"error"`
}

// VerifyPAN calls Setu's PAN verification endpoint. reason must be at
// least 20 characters (Setu rejects shorter reasons with
// insufficient_reason_length).
func (c *SetuClient) VerifyPAN(pan, reason string) (*PANVerificationResult, error) {
	if c.ClientID == "" || c.ClientSecret == "" || c.ProductInstance == "" {
		return nil, fmt.Errorf("setu: SETU_CLIENT_ID, SETU_CLIENT_SECRET and SETU_PRODUCT_INSTANCE_ID must be set")
	}

	body, err := json.Marshal(map[string]string{
		"pan":     pan,
		"consent": "Y",
		"reason":  reason,
	})
	if err != nil {
		return nil, fmt.Errorf("setu: encode request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/verify/pan", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("setu: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-client-id", c.ClientID)
	req.Header.Set("x-client-secret", c.ClientSecret)
	req.Header.Set("x-product-instance-id", c.ProductInstance)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("setu: request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("setu: read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var errResp setuErrorResponse
		if jsonErr := json.Unmarshal(respBody, &errResp); jsonErr == nil && errResp.Error.Code != "" {
			return nil, fmt.Errorf("setu: %s (%s) [trace=%s]", errResp.Error.Detail, errResp.Error.Code, errResp.Error.TraceID)
		}
		return nil, fmt.Errorf("setu: unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var okResp setuPANResponse
	if err := json.Unmarshal(respBody, &okResp); err != nil {
		return nil, fmt.Errorf("setu: decode response: %w (body=%s)", err, string(respBody))
	}

	return &PANVerificationResult{
		Verification:         okResp.Verification,
		Message:              okResp.Message,
		FullName:             okResp.Data.FullName,
		Category:             okResp.Data.Category,
		AadhaarSeedingStatus: okResp.Data.AadhaarSeedingStatus,
		TraceID:              okResp.TraceID,
	}, nil
}
