package platform

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config holds all environment-driven settings for the application.
type Config struct {
	Port           string
	DBHost         string
	DBPort         string
	DBUser         string
	DBPassword     string
	DBName         string
	DBSSLMode      string
	FrontendDir    string
	FrontendOrigin string
	// SettingsEncryptionKey encrypts integration API keys at rest (see
	// internal/settings). Must be a base64-encoded 32-byte key for
	// AES-256-GCM. If unset, a fixed dev-only key is derived so values
	// stay decryptable across restarts — set a real one in production.
	SettingsEncryptionKey string
	// AadhaarEncryptionKey encrypts each customer's Aadhaar number at rest
	// (see internal/customer). Same format/fallback behavior as
	// SettingsEncryptionKey, deliberately a separate key/env var.
	AadhaarEncryptionKey string
	// UploadsDir is where uploaded files (customer photos/KYC documents,
	// ornament photos) are stored on local disk and served back from
	// under /uploads — see internal/upload.
	UploadsDir string
	// JWTSecret signs/verifies login JWTs (see internal/auth, platform/jwt.go).
	// No safe default is baked in here — if unset, platform.LoadConfig logs a
	// loud warning and falls back to a fixed dev-only secret purely so local
	// dev without a .env file still works. Set a real JWT_SECRET in
	// production.
	JWTSecret string
	// JWTExpiry is how long an issued login token stays valid. JWT_EXPIRY in
	// .env may be given as "3d"/"7d" (not valid Go duration syntax) or a
	// normal Go duration like "168h" — see parseJWTExpiry. Defaults to 168h
	// (7 days) if unset/unparseable.
	JWTExpiry time.Duration
	// SMTP* configure the outgoing mailer used for password-reset emails
	// (see platform/mailer.go).
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	SMTPFrom string
}

// LoadConfig reads a .env file if present (local/dev convenience) and
// returns the resolved Config. In deployed environments, real env vars are
// used directly and a missing .env file is not an error.
func LoadConfig() Config {
	_ = godotenv.Load()

	return Config{
		Port:        getEnv("PORT", "8080"),
		DBHost:      getEnv("DB_HOST", "localhost"),
		DBPort:      getEnv("DB_PORT", "5432"),
		DBUser:      getEnv("DB_USER", "ambikagold"),
		DBPassword:  getEnv("DB_PASSWORD", "ambikagold"),
		DBName:      getEnv("DB_NAME", "ambikagold"),
		DBSSLMode:   getEnv("DB_SSLMODE", "disable"),
		FrontendDir: getEnv("FRONTEND_DIR", "../frontend/out"),
		// FrontendOrigin is the Next.js dev server origin allowed to make
		// cross-origin API calls (`next dev` runs on its own port, separate
		// from this API). Not needed in production, where the built frontend
		// is served from this same binary/origin.
		FrontendOrigin: getEnv("FRONTEND_ORIGIN", "http://localhost:3000"),
		// No safe default here — internal/platform.NewSettingsCipher derives
		// a fixed dev-only key when this is empty, rather than baking a
		// literal fallback secret into this file.
		SettingsEncryptionKey: getEnv("SETTINGS_ENCRYPTION_KEY", ""),
		// No safe default here either — internal/platform.NewAadhaarCipher
		// derives its own fixed dev-only key when this is empty.
		AadhaarEncryptionKey: getEnv("AADHAAR_ENCRYPTION_KEY", ""),
		UploadsDir:           getEnv("UPLOADS_DIR", "./uploads"),
		JWTSecret:            getJWTSecret(),
		JWTExpiry:            parseJWTExpiry(getEnv("JWT_EXPIRY", "")),
		SMTPHost:             getEnv("SMTP_HOST", ""),
		SMTPPort:             getEnv("SMTP_PORT", "587"),
		SMTPUser:             getEnv("SMTP_USER", ""),
		SMTPPass:             getEnv("SMTP_PASS", ""),
		SMTPFrom:             getEnv("SMTP_FROM", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// jwtDevFallbackSecret is used only when JWT_SECRET is unset, so local dev
// without a .env file still works. Never rely on this in production — a
// real JWT_SECRET is already configured in backend/.env for this project.
const jwtDevFallbackSecret = "ambikagold-dev-only-jwt-secret-do-not-use-in-production"

func getJWTSecret() string {
	if v := os.Getenv("JWT_SECRET"); v != "" {
		return v
	}
	log.Println("WARNING: JWT_SECRET is not set — using a fixed, publicly-known dev-only secret. Set a real one before issuing real tokens.")
	return jwtDevFallbackSecret
}

// defaultJWTExpiry is used when JWT_EXPIRY is unset or unparseable.
const defaultJWTExpiry = 168 * time.Hour

// parseJWTExpiry parses a duration string that may use the non-standard
// "<n>d" (days) suffix in addition to normal Go duration syntax (e.g.
// "168h"). Falls back to defaultJWTExpiry (7 days) if raw is empty or
// unparseable.
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
