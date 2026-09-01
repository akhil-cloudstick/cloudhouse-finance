package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"
)

// graphAPIVersion is pinned (never left to default to "latest") so a Meta
// API version bump can't silently change behavior underneath this package —
// bump it deliberately when moving to a newer version.
const graphAPIVersion = "v21.0"

// WhatsAppConfig is what the admin enters via the Settings page's WhatsApp
// row (settings.CategoryWhatsApp), stored as a single JSON blob in that
// row's encrypted Value — a WhatsApp Business Cloud API (Meta) permanent
// access token plus the sending phone number's Phone Number ID, both from
// the Meta App Dashboard's WhatsApp > API Setup page. WABAID (the WhatsApp
// Business Account ID) isn't needed to send messages — Phone Number ID
// alone addresses the /messages endpoint — but is kept alongside it since
// it's shown right next to Phone Number ID in the dashboard and is useful
// for anything that manages the account itself later (e.g. listing/
// requesting message templates).
type WhatsAppConfig struct {
	AccessToken   string `json:"accessToken"`
	PhoneNumberID string `json:"phoneNumberId"`
	WABAID        string `json:"wabaId"`
}

// ParseWhatsAppConfig decodes the Settings page's stored JSON value. Empty
// input (never configured) is not an error — it returns a zero-value config,
// which MetaCloudSender.Send below turns into a clear "not configured" error
// at send time.
func ParseWhatsAppConfig(raw string) (WhatsAppConfig, error) {
	var cfg WhatsAppConfig
	if raw == "" {
		return cfg, nil
	}
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return cfg, fmt.Errorf("whatsapp: invalid stored config: %w", err)
	}
	return cfg, nil
}

// WhatsAppConfigLoader fetches the current WhatsApp config on every send, so
// an admin editing it via the Settings page takes effect immediately with no
// restart. Wired in main.go as a thin closure over settings.Service — kept
// here as a func type (not an interface) so this package never imports
// internal/settings and risks an import cycle (settings already imports
// platform, for Cipher).
type WhatsAppConfigLoader func() (WhatsAppConfig, error)

// MetaCloudSender implements SMSSender against the official WhatsApp
// Business Cloud API (developers.facebook.com/docs/whatsapp/cloud-api) — the
// sole SMSSender implementation now that the log-only stub is gone, wherever
// an SMSSender is injected (e.g. auth.Service's forgot-password OTP), plus a
// Send method usable directly for anything WhatsApp-only (reminders,
// auction alerts).
//
// IMPORTANT — the 24-hour session window: Meta only allows freeform text
// (what Send below sends) to a recipient who messaged this business number
// within the last 24 hours. Every message sent *outside* that window — the
// common case for this app, since customers never message the business
// first — must instead be a pre-approved message template (Meta Business
// Manager > Account Tools > Message Templates), sent via a different
// request shape ({"type":"template","template":{"name":...,"language":...}}
// with the template's own placeholder args). Send below will get back a
// clear Graph API error (code 131047, "re-engagement message") on any
// customer/employee whose window has expired — this package doesn't
// attempt to fall back to a template automatically, since a template's
// content depends on the caller's own message, not just the phone number.
type MetaCloudSender struct {
	loadConfig WhatsAppConfigLoader
	client     *http.Client
}

func NewMetaCloudSender(loadConfig WhatsAppConfigLoader) *MetaCloudSender {
	return &MetaCloudSender{
		loadConfig: loadConfig,
		client:     &http.Client{Timeout: 15 * time.Second},
	}
}

var nonDigits = regexp.MustCompile(`\D`)

// toE164Digits turns a stored 10-digit Indian phone number (or one already
// carrying a country code / punctuation) into the bare digit string the
// Cloud API's `to` field expects (no "+", no "@c.us" suffix — that was
// OpenWA's WhatsApp-Web-derived chat-id format, not something Meta's API
// uses at all). Bare 10-digit numbers are assumed Indian (91) — the only
// country this app's employee/customer phone fields are entered in today.
func toE164Digits(phone string) string {
	digits := nonDigits.ReplaceAllString(phone, "")
	// A leading 0 is a domestic trunk-prefix habit (STD-code style dialing),
	// never part of the actual mobile number — strip it before the 10-digit
	// check below. Without this, an 11-digit "0XXXXXXXXXX" entry skips the
	// check entirely (it's not exactly 10 digits) and falls through to
	// return an invalid, country-code-less number Meta can't resolve — the
	// message silently never reaches that customer while a clean 10-digit
	// number sent alongside it works fine.
	if len(digits) == 11 && digits[0] == '0' {
		digits = digits[1:]
	}
	if len(digits) == 10 {
		digits = "91" + digits
	}
	return digits
}

type textMessagePayload struct {
	Body string `json:"body"`
}

type sendTextRequest struct {
	MessagingProduct string             `json:"messaging_product"`
	To               string             `json:"to"`
	Type             string             `json:"type"`
	Text             textMessagePayload `json:"text"`
}

type graphErrorBody struct {
	Error struct {
		Message      string `json:"message"`
		Code         int    `json:"code"`
		ErrorSubcode int    `json:"error_subcode"`
	} `json:"error"`
}

// Send delivers message as a WhatsApp text to phone, via the configured
// Cloud API phone number's /messages endpoint. See the MetaCloudSender
// doc comment above for the 24-hour-window / template caveat.
func (m *MetaCloudSender) Send(phone, message string) error {
	cfg, err := m.loadConfig()
	if err != nil {
		return fmt.Errorf("whatsapp: loading config: %w", err)
	}
	if cfg.AccessToken == "" || cfg.PhoneNumberID == "" {
		return fmt.Errorf("whatsapp: not configured — set access token and phone number ID under Settings > WhatsApp")
	}

	body, err := json.Marshal(sendTextRequest{
		MessagingProduct: "whatsapp",
		To:               toE164Digits(phone),
		Type:             "text",
		Text:             textMessagePayload{Body: message},
	})
	if err != nil {
		return fmt.Errorf("whatsapp: encoding request: %w", err)
	}

	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", graphAPIVersion, cfg.PhoneNumberID)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("whatsapp: building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)

	resp, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("whatsapp: request to Meta Graph API failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		var ge graphErrorBody
		if json.Unmarshal(raw, &ge) == nil && ge.Error.Message != "" {
			return fmt.Errorf("whatsapp: Meta Graph API error (code %d/%d): %s", ge.Error.Code, ge.Error.ErrorSubcode, ge.Error.Message)
		}
		return fmt.Errorf("whatsapp: Meta Graph API returned %s", resp.Status)
	}
	return nil
}
