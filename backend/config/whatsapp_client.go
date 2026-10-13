package config

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"time"
)

var WhatsApp SMSSender

var nonDigits = regexp.MustCompile(`\D`)

type SMSSender interface {
	Send(ctx context.Context, phone, message string) error
}

type WhatsAppConfig struct {
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey"`
	SessionID string `json:"sessionId"`
}

type WhatsAppConfigLoader func(ctx context.Context) (WhatsAppConfig, error)

type OpenWASender struct {
	loadConfig WhatsAppConfigLoader
	client     *http.Client
}

type sendTextRequest struct {
	ChatID string `json:"chatId"`
	Text   string `json:"text"`
}

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

func NewOpenWASender(loadConfig WhatsAppConfigLoader) *OpenWASender {
	return &OpenWASender{
		loadConfig: loadConfig,
		client:     &http.Client{Timeout: 15 * time.Second},
	}
}

func toChatID(phone string) string {
	digits := nonDigits.ReplaceAllString(phone, "")
	if len(digits) == 11 && digits[0] == '0' {
		digits = digits[1:]
	}
	if len(digits) == 10 {
		digits = "91" + digits
	}
	return digits + "@c.us"
}

func (o *OpenWASender) Send(ctx context.Context, phone, message string) error {
	cfg, err := o.loadConfig(ctx)
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
