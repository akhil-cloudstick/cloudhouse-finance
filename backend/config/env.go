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
	SurepassEsignSlipX       int
	SurepassEsignSlipY       int
	SurepassEsignWitness1X   int
	SurepassEsignWitness1Y   int
	SurepassEsignWitness2X   int
	SurepassEsignWitness2Y   int
	RazorpayKeyID            string
	RazorpayKeySecret        string
	RazorpayWebhookSecret    string
	WhatsAppOrigin           string
	WhatsAppAPIKey           string
	WhatsAppSessionID        string
	// ERPConsolePublicKey is the CloudHouse ERP's EC public key (PEM). Empty
	// disables the ERP console sign-in (POST /superadmin/erp-session → 404).
	ERPConsolePublicKey string
	ERPConsoleAudience  string
	ERPConsoleExpiry    time.Duration
}

func LoadConfig() Config {
	_ = godotenv.Load()
	return Config{
		FrontendDir:              getEnv("FRONTEND_DIR", "../frontend/out"),
		FrontendOrigin:           getEnv("FRONTEND_ORIGIN", "http://localhost:3004,http://localhost:3000,http://localhost:3100,http://wails.localhost:34115,http://wails.localhost"),
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
		SurepassEsignSlipX:       getEnvInt("SUREPASS_ESIGN_SLIP_X", 103),
		SurepassEsignSlipY:       getEnvInt("SUREPASS_ESIGN_SLIP_Y", 600),
		SurepassEsignWitness1X:   getEnvInt("SUREPASS_ESIGN_WITNESS1_X", 103),
		SurepassEsignWitness1Y:   getEnvInt("SUREPASS_ESIGN_WITNESS1_Y", 338),
		SurepassEsignWitness2X:   getEnvInt("SUREPASS_ESIGN_WITNESS2_X", 396),
		SurepassEsignWitness2Y:   getEnvInt("SUREPASS_ESIGN_WITNESS2_Y", 338),
		RazorpayKeyID:            getEnv("RAZORPAY_KEY_ID", ""),
		RazorpayKeySecret:        getEnv("RAZORPAY_KEY_SECRET", ""),
		RazorpayWebhookSecret:    getEnv("RAZORPAY_WEBHOOK_SECRET", ""),
		WhatsAppOrigin:           getEnv("WHATSAPP_ORIGIN", "http://127.0.0.1:2785"),
		WhatsAppAPIKey:           getEnv("WHATSAPP_API_KEY", ""),
		WhatsAppSessionID:        getEnv("WHATSAPP_SESSION_ID", ""),
		ERPConsolePublicKey:      getERPConsolePublicKey(),
		ERPConsoleAudience:       getEnv("ERP_CONSOLE_AUDIENCE", "gold-finance"),
		ERPConsoleExpiry:         parseERPConsoleExpiry(getEnv("ERP_CONSOLE_EXPIRY", "")),
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

// getERPConsolePublicKey reads the ERP public key from ERP_CONSOLE_PUBLIC_KEY_FILE
// (a path to the ERP's public_ec.pem) or, failing that, ERP_CONSOLE_PUBLIC_KEY
// (the PEM inline; a literal "\n" is accepted for single-line .env values).
func getERPConsolePublicKey() string {
	if path := strings.TrimSpace(os.Getenv("ERP_CONSOLE_PUBLIC_KEY_FILE")); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			log.Printf("WARNING: ERP_CONSOLE_PUBLIC_KEY_FILE=%q could not be read: %v — using the built-in ERP key", path, err)
			return erpConsoleBuiltInPublicKey
		}
		return strings.TrimSpace(string(b))
	}
	if inline := strings.TrimSpace(strings.ReplaceAll(os.Getenv("ERP_CONSOLE_PUBLIC_KEY"), `\n`, "\n")); inline != "" {
		return inline
	}
	return erpConsoleBuiltInPublicKey
}

// erpConsoleBuiltInPublicKey is the CloudHouse ERP's public key (internalprojectmanagementsystem/cloudhouse/public_ec.pem,
// the same file local and live). It is used when no ERP_CONSOLE_PUBLIC_KEY_FILE / ERP_CONSOLE_PUBLIC_KEY is set, so a
// deploy needs no key setting. A public key can only check ERP sign-ins, never make one. If the ERP key is ever
// changed, update it here (or set ERP_CONSOLE_PUBLIC_KEY_FILE).
const erpConsoleBuiltInPublicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/Br0Hj6p9tU7BWxn6ZFJkejAYb15
jgEivdbfymJevBKj4T2keIn/958zOU/x6OeLbgqHqoyaxTpo5jMwV2vQsw==
-----END PUBLIC KEY-----`

const defaultERPConsoleExpiry = 2 * time.Hour

func parseERPConsoleExpiry(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultERPConsoleExpiry
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		log.Printf("WARNING: ERP_CONSOLE_EXPIRY=%q is invalid, falling back to %s", raw, defaultERPConsoleExpiry)
		return defaultERPConsoleExpiry
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

func EnvTrimmed(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}
