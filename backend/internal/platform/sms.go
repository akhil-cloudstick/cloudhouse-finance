package platform

// SMSSender sends a short text message to a phone number. Used today by
// internal/auth's forgot-password flow (a 6-digit OTP), loan/reminder
// notifications, and auction alerts. Implemented as a narrow interface so
// callers don't depend on the concrete delivery mechanism — the sole
// implementation is OpenWASender (see whatsapp.go), which sends via a
// self-hosted OpenWA/WhatsApp instance.
type SMSSender interface {
	Send(phone, message string) error
}
