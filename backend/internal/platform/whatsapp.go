package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"time"
)

// WhatsAppConfig is what the admin enters via the Settings page's WhatsApp
// row (settings.CategoryWhatsApp), stored as a single JSON blob in that
// row's encrypted Value — an OpenWA instance's base URL, its API key, and
// the sessionId of the WhatsApp number to send from (see
// https://github.com/rmyndharis/OpenWA).
type WhatsAppConfig struct {
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey"`
	SessionID string `json:"sessionId"`
}

// ParseWhatsAppConfig decodes the Settings page's stored JSON value. Empty
// input (never configured) is not an error — it returns a zero-value config,
// which OpenWASender.Send below turns into a clear "not configured" error at
// send time.
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

// OpenWASender implements SMSSender against a self-hosted OpenWA instance
// (see https://github.com/rmyndharis/OpenWA) — the sole SMSSender
// implementation now that the log-only stub is gone, wherever an SMSSender
// is injected (e.g. auth.Service's forgot-password OTP), plus a Send method
// usable directly for anything WhatsApp-only (reminders, auction alerts).
type OpenWASender struct {
	loadConfig WhatsAppConfigLoader
	client     *http.Client
}

func NewOpenWASender(loadConfig WhatsAppConfigLoader) *OpenWASender {
	return &OpenWASender{
		loadConfig: loadConfig,
		client:     &http.Client{Timeout: 15 * time.Second},
	}
}

var nonDigits = regexp.MustCompile(`\D`)

// toChatID turns a stored 10-digit Indian phone number (or one already
// carrying a country code / punctuation) into OpenWA's WhatsApp chat id
// format, "<countrycode><number>@c.us". Bare 10-digit numbers are assumed
// Indian (91) — the only country this app's employee/customer phone fields
// are entered in today.
func toChatID(phone string) string {
	digits := nonDigits.ReplaceAllString(phone, "")
	// A leading 0 is a domestic trunk-prefix habit (STD-code style dialing),
	// never part of the actual mobile number — strip it before the 10-digit
	// check below. Without this, an 11-digit "0XXXXXXXXXX" entry skips the
	// check entirely (it's not exactly 10 digits) and falls through to
	// return an invalid, country-code-less chat id that OpenWA can't
	// resolve — the message silently never reaches that customer while a
	// clean 10-digit number sent alongside it works fine.
	if len(digits) == 11 && digits[0] == '0' {
		digits = digits[1:]
	}
	if len(digits) == 10 {
		digits = "91" + digits
	}
	return digits + "@c.us"
}

type sendTextRequest struct {
	ChatID string `json:"chatId"`
	Text   string `json:"text"`
}

// Send delivers message as a WhatsApp text to phone, via the configured
// OpenWA session's /messages/send-text endpoint.
func (o *OpenWASender) Send(phone, message string) error {
	cfg, err := o.loadConfig()
	if err != nil {
		return fmt.Errorf("whatsapp: loading config: %w", err)
	}
	if cfg.BaseURL == "" || cfg.APIKey == "" || cfg.SessionID == "" {
		return fmt.Errorf("whatsapp: not configured — set base URL, API key and session ID under Settings > WhatsApp")
	}

	body, err := json.Marshal(sendTextRequest{ChatID: toChatID(phone), Text: message})
	if err != nil {
		return fmt.Errorf("whatsapp: encoding request: %w", err)
	}

	url := fmt.Sprintf("%s/api/sessions/%s/messages/send-text", cfg.BaseURL, cfg.SessionID)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("whatsapp: building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)

	resp, err := o.client.Do(req)
	if err != nil {
		return fmt.Errorf("whatsapp: request to OpenWA failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("whatsapp: OpenWA returned %s", resp.Status)
	}
	return nil
}
