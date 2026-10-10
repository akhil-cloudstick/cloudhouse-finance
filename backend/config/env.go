package config

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

var Env Config

const defaultJWTExpiry = 168 * time.Hour

type Config struct {
	FrontendDir              string
	FrontendOrigin           string
	BaseDomain               string
	SettingsEncryptionKey    string
	AadhaarEncryptionKey     string
	UploadsDir               string
	JWTSecret                string
	JWTExpiry                time.Duration
	SMTPHost                 string
	SMTPPort                 string
	SMTPUser                 string
	SMTPPass                 string
	SMTPFrom                 string
	SurepassToken            string
	SurepassBaseURL          string
	SurepassEsignToken       string
	SurepassEsignBaseURL     string
	SurepassEsignSignX       int
	SurepassEsignSignY       int
	SurepassEsignYFromBottom bool
	RazorpayKeyID            string
	RazorpayKeySecret        string
	RazorpayWebhookSecret    string
	WhatsAppOrigin           string
	WhatsAppAPIKey           string
	WhatsAppSessionID        string
}

func LoadConfig() Config {
	_ = godotenv.Load()
	return Config{
		FrontendDir:              getEnv("FRONTEND_DIR", "../frontend/out"),
		FrontendOrigin:           getEnv("FRONTEND_ORIGIN", "http://localhost:3000,http://localhost:3100"),
		BaseDomain:               getEnv("BASE_DOMAIN", "cloudhousefinance.com"),
		SettingsEncryptionKey:    getEnv("SETTINGS_ENCRYPTION_KEY", ""),
		AadhaarEncryptionKey:     getEnv("AADHAAR_ENCRYPTION_KEY", ""),
		UploadsDir:               getEnv("UPLOADS_DIR", "./uploads"),
		JWTSecret:                getJWTSecret(),
		JWTExpiry:                parseJWTExpiry(getEnv("JWT_EXPIRY", "")),
		SMTPHost:                 getEnv("SMTP_HOST", ""),
		SMTPPort:                 getEnv("SMTP_PORT", "587"),
		SMTPUser:                 getEnv("SMTP_USER", ""),
		SMTPPass:                 getEnv("SMTP_PASS", ""),
		SMTPFrom:                 getEnv("SMTP_FROM", ""),
		SurepassToken:            getEnv("SUREPASS_API_TOKEN", ""),
		SurepassBaseURL:          getEnv("SUREPASS_BASE_URL", "https://sandbox.surepass.app"),
		SurepassEsignToken:       getEnv("SUREPASS_ESIGN_TOKEN", ""),
		SurepassEsignBaseURL:     getEnv("SUREPASS_ESIGN_BASE_URL", "https://prod-esign-api-v2.surepass.app"),
		SurepassEsignSignX:       getEnvInt("SUREPASS_ESIGN_SIGN_X", 110),
		SurepassEsignSignY:       getEnvInt("SUREPASS_ESIGN_SIGN_Y", 730),
		SurepassEsignYFromBottom: getEnv("SUREPASS_ESIGN_Y_FROM_BOTTOM", "true") != "false",
		RazorpayKeyID:            getEnv("RAZORPAY_KEY_ID", ""),
		RazorpayKeySecret:        getEnv("RAZORPAY_KEY_SECRET", ""),
		RazorpayWebhookSecret:    getEnv("RAZORPAY_WEBHOOK_SECRET", ""),
		WhatsAppOrigin:           getEnv("WHATSAPP_ORIGIN", "http://127.0.0.1:2785"),
		WhatsAppAPIKey:           getEnv("WHATSAPP_API_KEY", ""),
		WhatsAppSessionID:        getEnv("WHATSAPP_SESSION_ID", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getJWTSecret() string {
	if v := os.Getenv("JWT_SECRET"); v != "" {
		return v
	}
	log.Fatal("JWT_SECRET is not set")
	return ""
}

func parseJWTExpiry(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultJWTExpiry
	}
	if strings.HasSuffix(raw, "d") {
		numPart := strings.TrimSuffix(raw, "d")
		n, err := strconv.Atoi(numPart)
		if err != nil || n <= 0 {
			log.Printf("WARNING: JWT_EXPIRY=%q is invalid, falling back to %s", raw, defaultJWTExpiry)
			return defaultJWTExpiry
		}
		return time.Duration(n) * 24 * time.Hour
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		log.Printf("WARNING: JWT_EXPIRY=%q is invalid, falling back to %s", raw, defaultJWTExpiry)
		return defaultJWTExpiry
	}
	return d
}

func getEnvInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		log.Printf("WARNING: %s=%q is not a positive integer — using %d", key, v, fallback)
		return fallback
	}
	return n
}
