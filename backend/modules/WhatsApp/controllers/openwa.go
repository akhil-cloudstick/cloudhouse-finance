package controllers

import (
	"bytes"
	common "cloudhouse/backend/common/controllers"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// /start blocks while OpenWA launches the WhatsApp engine (~12s here, longer on a cold or busy host)
var openwaClient = &http.Client{Timeout: 60 * time.Second}

type openwaSession struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Phone  string `json:"phone"`
}

type openwaQR struct {
	QRCode string `json:"qrCode"`
	Status string `json:"status"`
}

type openwaPairing struct {
	PairingCode string `json:"pairingCode"`
	Status      string `json:"status"`
}

type openwaError struct {
	status int
	msg    string
}

func (e *openwaError) Error() string { return e.msg }

// openwaCall talks to the OpenWA REST API with the server-held API key; the key
// never leaves the backend. A non-2xx answer comes back as *openwaError.
func openwaCall(method, path string, body, out any) error {
	cfg, err := common.WhatsAppServerConfig()
	if err != nil {
		return fmt.Errorf("whatsapp: loading config: %w", err)
	}
	if cfg.BaseURL == "" || cfg.APIKey == "" {
		return common.NewUnavailable("WhatsApp is not set up on this server yet")
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, strings.TrimRight(cfg.BaseURL, "/")+"/api"+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	resp, err := openwaClient.Do(req)
	if err != nil {
		return common.NewUnavailable("WhatsApp service is unreachable, try again shortly")
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		var e struct {
			Message any `json:"message"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := "WhatsApp service returned " + resp.Status
		switch m := e.Message.(type) {
		case string:
			msg = m
		case []any:
			if len(m) > 0 {
				msg = fmt.Sprint(m[0])
			}
		}
		return &openwaError{status: resp.StatusCode, msg: msg}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func isOpenWAStatus(err error, status int) bool {
	var e *openwaError
	return errors.As(err, &e) && e.status == status
}

// Status keeps OpenWA's own auth failures (401/403) from reaching the browser,
// where they would read as the business session expiring.
func (e *openwaError) Status() int {
	switch e.status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity:
		return e.status
	}
	return http.StatusBadGateway
}
