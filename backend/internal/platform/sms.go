package platform

import "log"

// SMSSender sends a short text message to a phone number. Used today by
// internal/auth's forgot-password flow (a 6-digit OTP). Implemented as a
// narrow interface so a real gateway (MSG91/Twilio/Fast2SMS/etc.) can be
// swapped in later — via the existing internal/settings "sms" API-key
// category — without touching any caller.
type SMSSender interface {
	Send(phone, message string) error
}

// LogSMSSender is a stand-in implementation that just logs the message
// server-side instead of actually sending it — no SMS gateway is wired up
// yet. This keeps the forgot-password flow fully testable end-to-end
// (the OTP is visible in the backend's console output) until a real
// provider is configured.
type LogSMSSender struct{}

func NewLogSMSSender() *LogSMSSender { return &LogSMSSender{} }

func (s *LogSMSSender) Send(phone, message string) error {
	log.Printf("[SMS STUB] would send to %s: %s", phone, message)
	return nil
}
