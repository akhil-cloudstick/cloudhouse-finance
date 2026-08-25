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

// DigilockerClient calls Setu's DigiLocker Aadhaar-verification API
// (https://docs.setu.co/data/digilocker). Unlike SetuClient's PAN verify
// (a single request/response server-to-server call), this is a 3-step
// redirect flow: create a request (get back a login URL), the CUSTOMER
// (not the caller) logs into DigiLocker with their Aadhaar + OTP in their
// own browser, then the caller polls status and fetches the Aadhaar data
// once authenticated. DigiLocker auto-provisions a new account on first
// login — the customer does NOT need a pre-existing DigiLocker account.
type DigilockerClient struct {
	ClientID        string
	ClientSecret    string
	ProductInstance string
	BaseURL         string
	HTTPClient      *http.Client
}

// NewDigilockerClient builds a DigilockerClient from the app Config.
func NewDigilockerClient(cfg Config) *DigilockerClient {
	return &DigilockerClient{
		ClientID:        cfg.SetuDigilockerClientID,
		ClientSecret:    cfg.SetuDigilockerClientSecret,
		ProductInstance: cfg.SetuDigilockerProductInstance,
		BaseURL:         cfg.SetuDigilockerBaseURL,
		HTTPClient:      &http.Client{Timeout: 15 * time.Second},
	}
}

// IsSandbox reports whether BaseURL points at Setu's sandbox host — see
// SetuClient.IsSandbox's doc comment for why callers care about this.
func (c *DigilockerClient) IsSandbox() bool {
	return strings.Contains(c.BaseURL, "sandbox")
}

func (c *DigilockerClient) configured() bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.ProductInstance != ""
}

func (c *DigilockerClient) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-client-id", c.ClientID)
	req.Header.Set("x-client-secret", c.ClientSecret)
	req.Header.Set("x-product-instance-id", c.ProductInstance)
}

// digilockerErrorResponse mirrors Setu's error envelope (400/401/500).
type digilockerErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Detail  string `json:"detail"`
		TraceID string `json:"traceId"`
	} `json:"error"`
}

func decodeDigilockerResponse(resp *http.Response, out any) error {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("digilocker: read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		var errResp digilockerErrorResponse
		if jsonErr := json.Unmarshal(body, &errResp); jsonErr == nil && errResp.Error.Code != "" {
			return fmt.Errorf("digilocker: %s (%s) [trace=%s]", errResp.Error.Detail, errResp.Error.Code, errResp.Error.TraceID)
		}
		return fmt.Errorf("digilocker: unexpected status %d: %s", resp.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("digilocker: decode response: %w (body=%s)", err, string(body))
	}
	return nil
}

// DigilockerRequest is the result of creating (or polling) a DigiLocker
// verification request.
type DigilockerRequest struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	ValidUpto string `json:"validUpto"`
	// Status is "unauthenticated" until the customer completes DigiLocker
	// login, then "authenticated".
	Status string `json:"status"`
}

// CreateRequest starts a new DigiLocker verification: returns a login URL
// the CUSTOMER must open (in their own browser/device) to authenticate with
// DigiLocker via their Aadhaar number + OTP sent to their Aadhaar-linked
// mobile. redirectURL is where DigiLocker sends the customer back to after
// login (success or failure) — typically a small "you're done, close this
// tab" page your frontend serves.
func (c *DigilockerClient) CreateRequest(redirectURL string) (*DigilockerRequest, error) {
	if !c.configured() {
		return nil, fmt.Errorf("digilocker: SETU_DIGILOCKER_CLIENT_ID, SETU_DIGILOCKER_CLIENT_SECRET and SETU_DIGILOCKER_PRODUCT_INSTANCE_ID must be set")
	}
	body, err := json.Marshal(map[string]string{"redirectUrl": redirectURL})
	if err != nil {
		return nil, fmt.Errorf("digilocker: encode request: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/digilocker", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("digilocker: build request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("digilocker: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out DigilockerRequest
	if err := decodeDigilockerResponse(resp, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DigilockerStatus is the result of polling a request's authentication
// status (GET /api/digilocker/{requestId}/status).
type DigilockerStatus struct {
	ID                    string `json:"id"`
	URL                   string `json:"url"`
	ValidUpto             string `json:"validUpto"`
	Status                string `json:"status"` // "unauthenticated" | "authenticated"
	DigilockerUserDetails struct {
		DigilockerID string `json:"digilockerId"`
		Email        string `json:"email"`
		PhoneNumber  string `json:"phoneNumber"`
	} `json:"digilockerUserDetails"`
	TraceID string `json:"traceId"`
}

// GetStatus polls whether the customer has completed DigiLocker login yet.
// The caller's UI should poll this after sending the customer the
// CreateRequest URL, since login happens on the customer's own device.
func (c *DigilockerClient) GetStatus(requestID string) (*DigilockerStatus, error) {
	if !c.configured() {
		return nil, fmt.Errorf("digilocker: SETU_DIGILOCKER_CLIENT_ID, SETU_DIGILOCKER_CLIENT_SECRET and SETU_DIGILOCKER_PRODUCT_INSTANCE_ID must be set")
	}
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+"/api/digilocker/"+requestID+"/status", nil)
	if err != nil {
		return nil, fmt.Errorf("digilocker: build request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("digilocker: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out DigilockerStatus
	if err := decodeDigilockerResponse(resp, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// AadhaarXML mirrors the e-Aadhaar data returned once a request is
// authenticated (GET /api/digilocker/{requestId}/aadhaar).
type AadhaarXML struct {
	Aadhaar struct {
		Address struct {
			CareOf      string `json:"careOf"`
			Country     string `json:"country"`
			District    string `json:"district"`
			House       string `json:"house"`
			Landmark    string `json:"landmark"`
			Locality    string `json:"locality"`
			PIN         string `json:"pin"`
			PostOffice  string `json:"postOffice"`
			State       string `json:"state"`
			Street      string `json:"street"`
			SubDistrict string `json:"subDistrict"`
			VTC         string `json:"vtc"`
		} `json:"address"`
		DateOfBirth  string `json:"dateOfBirth"`
		Gender       string `json:"gender"`
		Name         string `json:"name"`
		MaskedNumber string `json:"maskedNumber"`
	} `json:"aadhaar"`
	ID     string `json:"id"`
	Status string `json:"status"`
}

// GetAadhaar fetches the customer's e-Aadhaar details once GetStatus
// reports "authenticated". Calling this before authentication completes
// returns an error from Setu.
func (c *DigilockerClient) GetAadhaar(requestID string) (*AadhaarXML, error) {
	if !c.configured() {
		return nil, fmt.Errorf("digilocker: SETU_DIGILOCKER_CLIENT_ID, SETU_DIGILOCKER_CLIENT_SECRET and SETU_DIGILOCKER_PRODUCT_INSTANCE_ID must be set")
	}
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+"/api/digilocker/"+requestID+"/aadhaar", nil)
	if err != nil {
		return nil, fmt.Errorf("digilocker: build request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("digilocker: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out AadhaarXML
	if err := decodeDigilockerResponse(resp, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
