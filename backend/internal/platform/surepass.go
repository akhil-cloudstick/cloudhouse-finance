package platform

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// surepassHTTP is the shared transport for the Surepass KYC APIs
// (https://app.surepass.app/docs/kyc): PAN verification (PANClient),
// DigiLocker Aadhaar verification (DigilockerClient) and Aadhaar eSign
// (EsignClient). All three use one JWT bearer token and one base URL —
// https://sandbox.surepass.app or https://kyc-api.surepass.app — see
// Config.SurepassBaseURL.
type surepassHTTP struct {
	Token      string
	BaseURL    string
	HTTPClient *http.Client
}

func newSurepassHTTP(cfg Config, timeout time.Duration) surepassHTTP {
	return surepassHTTP{
		Token:      cfg.SurepassToken,
		BaseURL:    strings.TrimRight(cfg.SurepassBaseURL, "/"),
		HTTPClient: &http.Client{Timeout: timeout},
	}
}

// IsSandbox reports whether BaseURL points at Surepass's sandbox host.
// Sandbox returns fixed dummy identities for any test input, regardless of
// which real customer is being checked — callers that compare the returned
// name to a customer's on-file name (see internal/customer.namesMatch) skip
// that comparison in sandbox mode, since it would misfire on every real
// customer name.
func (c *surepassHTTP) IsSandbox() bool {
	return strings.Contains(c.BaseURL, "sandbox")
}

func (c *surepassHTTP) configured() bool {
	return c.Token != ""
}

var errSurepassNotConfigured = fmt.Errorf("surepass: API token is not configured (SUREPASS_API_TOKEN / SUREPASS_ESIGN_TOKEN)")

// SurepassError is a non-success response from Surepass. Every Surepass
// endpoint answers with the same {data, status_code, success, message,
// message_code} envelope, so one error type covers them all.
type SurepassError struct {
	StatusCode  int
	Message     string
	MessageCode string
}

// Status maps the failure onto the HTTP status our own API answers with, so
// httpx.FailErr returns it instead of the generic 400: a rejected token or
// blocked gateway is OUR configuration problem (503), a 5xx is Surepass's (502),
// and anything else is a request problem the caller can act on (400).
func (e *SurepassError) Status() int {
	switch {
	case e.StatusCode == http.StatusUnauthorized || e.StatusCode == http.StatusForbidden:
		return http.StatusServiceUnavailable
	case e.StatusCode >= 500:
		return http.StatusBadGateway
	default:
		return http.StatusBadRequest
	}
}

// Error is the message shown to the staff member (httpx.FailErr returns it
// verbatim), so credential problems are described without vendor detail; the
// full Surepass answer is logged by do.
func (e *SurepassError) Error() string {
	switch e.Status() {
	case http.StatusServiceUnavailable:
		return "The KYC/eSign provider rejected this account's credentials. Please contact support."
	case http.StatusBadGateway:
		return "The KYC/eSign provider is not responding. Please try again shortly."
	}
	if e.Message != "" {
		return e.Message
	}
	return "The KYC/eSign provider could not process this request."
}

// publicRedirectURL returns u, or "" when u points at this machine. Surepass's
// gateway answers 403 to any request whose redirect_url is localhost or a
// loopback address, so in local development the redirect is simply left out
// (the customer is not sent back to the app after signing/login, and the
// caller's status polling works the same).
func publicRedirectURL(u string) string {
	parsed, err := url.Parse(u)
	if err != nil {
		return u
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || host == "::1" || strings.HasPrefix(host, "127.") {
		return ""
	}
	return u
}

// surepassEnvelope mirrors the common response wrapper; Data is decoded per
// endpoint by the caller.
type surepassEnvelope struct {
	Data        json.RawMessage `json:"data"`
	StatusCode  int             `json:"status_code"`
	Success     bool            `json:"success"`
	Message     string          `json:"message"`
	MessageCode string          `json:"message_code"`
}

// do sends one request and decodes the envelope's data into out (skipped when
// out is nil). contentType is set only when body is non-nil. Any non-success
// answer — by HTTP status or by the envelope's own success flag — comes back
// as *SurepassError.
func (c *surepassHTTP) do(method, path, contentType string, body io.Reader, out any) error {
	if !c.configured() {
		return errSurepassNotConfigured
	}
	req, err := http.NewRequest(method, c.BaseURL+path, body)
	if err != nil {
		return fmt.Errorf("surepass: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil && contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("surepass: request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("surepass: read response: %w", err)
	}

	var env surepassEnvelope
	if jsonErr := json.Unmarshal(raw, &env); jsonErr != nil {
		// Not the usual JSON envelope — typically the gateway's own HTML
		// error page (e.g. a 403 for a blocked request).
		log.Printf("surepass: %s %s -> http %d, non-JSON body: %.300s", method, path, resp.StatusCode, string(raw))
		if resp.StatusCode >= 400 {
			return &SurepassError{StatusCode: resp.StatusCode}
		}
		return fmt.Errorf("surepass: unexpected status %d: %.300s", resp.StatusCode, string(raw))
	}
	if resp.StatusCode >= 400 || !env.Success {
		code := env.StatusCode
		if code == 0 {
			code = resp.StatusCode
		}
		log.Printf("surepass: %s %s -> status=%d code=%q message=%q", method, path, code, env.MessageCode, env.Message)
		return &SurepassError{StatusCode: code, Message: env.Message, MessageCode: env.MessageCode}
	}
	if out != nil {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return fmt.Errorf("surepass: decode response: %w (body=%s)", err, string(raw))
		}
	}
	return nil
}

// PANClient calls Surepass's PAN Lite API (POST /api/v1/pan/pan).
type PANClient struct {
	surepassHTTP
}

// NewPANClient builds a PANClient from the app Config.
func NewPANClient(cfg Config) *PANClient {
	return &PANClient{newSurepassHTTP(cfg, 15*time.Second)}
}

// PANVerificationResult is the normalized result of a PAN verification call.
type PANVerificationResult struct {
	Verification string `json:"verification"` // "SUCCESS" or "failed"
	Message      string `json:"message"`
	FullName     string `json:"full_name,omitempty"`
	Category     string `json:"category,omitempty"`
	TraceID      string `json:"traceId,omitempty"`
}

// VerifyPAN checks a PAN. A PAN Surepass rejects as invalid (HTTP 422) is a
// normal "failed" result, not an error — errors are reserved for transport,
// auth and configuration problems.
func (c *PANClient) VerifyPAN(pan string) (*PANVerificationResult, error) {
	body, err := json.Marshal(map[string]string{"id_number": pan})
	if err != nil {
		return nil, fmt.Errorf("surepass: encode request: %w", err)
	}

	var data struct {
		PANNumber string `json:"pan_number"`
		FullName  string `json:"full_name"`
		ClientID  string `json:"client_id"`
		Category  string `json:"category"`
	}
	err = c.do(http.MethodPost, "/api/v1/pan/pan", "application/json", strings.NewReader(string(body)), &data)
	if err != nil {
		if se, ok := err.(*SurepassError); ok && se.StatusCode == http.StatusUnprocessableEntity {
			return &PANVerificationResult{Verification: "failed", Message: se.Message}, nil
		}
		return nil, err
	}

	return &PANVerificationResult{
		Verification: "SUCCESS",
		Message:      "PAN verified",
		FullName:     data.FullName,
		Category:     data.Category,
		TraceID:      data.ClientID,
	}, nil
}
