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
	Port       string
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
	DBSSLMode  string
	// DBStatementTimeout and DBIdleTxTimeout bound how long a single query,
	// and an abandoned open transaction, may hold server resources. Both are
	// Postgres durations applied per connection in the DSN (see NewDatabase).
	//
	// Empty means "no limit", which is Postgres's own default and what this
	// deployment ran with until now. They are deliberately OFF by default
	// rather than set to a sensible-looking number: migrate.Run issues
	// AutoMigrate and table rewrites on the same pool the API serves from, and
	// a statement timeout short enough to be useful against a runaway report
	// is short enough to kill an index build on a large table halfway through.
	// Set them in production, and run `go run ./cmd/migrate` with them unset.
	DBStatementTimeout string
	DBIdleTxTimeout    string
	// DBMaxOpenConns bounds the connection pool. Since platform.PinTenantConn
	// holds one connection for each authenticated request, this is effectively
	// the cap on concurrent authenticated requests — raise it together with
	// Postgres's own max_connections, never past it.
	DBMaxOpenConns int
	DBMaxIdleConns int
	FrontendDir    string
	// FrontendOrigin is a comma-separated list of origins allowed to make
	// cross-origin API calls in dev — each Next app runs `next dev` on its
	// own port, separate from this API. Now two by default: the tenant
	// frontend (3000) and the superadmin console, extracted into its own
	// app/origin so it can later be embedded in an external ERP rather than
	// sharing the tenant app's build/session (see corsMiddleware). Not
	// needed in production if a reverse proxy serves both static builds from
	// this same origin's domain; set explicitly there if they are deployed
	// on separate origins instead.
	FrontendOrigin string
	// BaseDomain is the platform's shared domain that each business is given
	// a subdomain of (e.g. "ambika" -> ambika.cloudhousefinance.com) — see
	// tenant.SubdomainLabel, which strips this suffix off the request Host to
	// find a tenant's code. Defaults to the domain this deployment actually
	// runs on; override only for a differently-domained deployment.
	BaseDomain string
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
	// Setu* configure the Setu Data Gateway PAN verification API (see
	// platform/setu.go). SetuBaseURL switches between sandbox
	// (https://dg-sandbox.setu.co) and production (https://dg.setu.co).
	SetuClientID        string
	SetuClientSecret    string
	SetuProductInstance string
	SetuBaseURL         string
	// SetuDigilocker* configure the separate DigiLocker Aadhaar-verification
	// product instance (see platform/setu_digilocker.go). A different Setu
	// product from PAN verification above, so its own client-id/secret/
	// product-instance-id, though the sandbox/production host pattern is
	// the same.
	SetuDigilockerClientID        string
	SetuDigilockerClientSecret    string
	SetuDigilockerProductInstance string
	SetuDigilockerBaseURL         string
	// SetuEsign* configure the separate Aadhaar eSign product instance (see
	// platform/setu_esign.go) — used to digitally sign the loan indemnity
	// bond. A different Setu product from PAN/DigiLocker above, so its own
	// client-id/secret/product-instance-id, though the sandbox/production
	// host pattern is the same.
	SetuEsignClientID        string
	SetuEsignClientSecret    string
	SetuEsignProductInstance string
	SetuEsignBaseURL         string
	// Razorpay* configure the Razorpay Orders API used for customer-app
	// online loan payments (see platform/razorpay.go). Plain env vars,
	// following the same convention as Setu* above, rather than the
	// encrypted internal/settings table.
	RazorpayKeyID     string
	RazorpayKeySecret string
	// RazorpayWebhookSecret is the separate secret configured on Razorpay's
	// dashboard for signing webhook payloads (Subscriptions events — plan
	// Step 10) — NOT the same value as RazorpayKeySecret. Left empty,
	// billing.Service's webhook handler refuses every event rather than
	// trusting an unverifiable payload.
	RazorpayWebhookSecret string

	// SuperAdmin* bootstrap the FIRST superadmin console login on a fresh database
	// (see internal/superadmin.SeedBootstrapUser) — create-only, and only used
	// when no superadmin user exists yet. Left empty, a fresh install simply has
	// no way into the superadmin console until one is created directly; the
	// tenant-facing product is unaffected either way. Env vars rather than a
	// hardcoded constant (unlike employee.SeedAdmin's fixed "admin@123")
	// because there is no safe fixed password to ship for the console that
	// can create and suspend every business on the deployment.
	SuperAdminBootstrapUsername string
	SuperAdminBootstrapPassword string
	SuperAdminBootstrapName     string

	// WhatsAppOrigin is where the OpenWA service (./OpenWA) listens —
	// reverse-proxied under /admin/whatsapp so the browser only ever talks
	// to this one origin. OpenWA itself stays unaware of that prefix: see
	// internal/webstatic's WhatsApp proxy, which strips it before
	// forwarding.
	WhatsAppOrigin string

	// WhatsAppAPIKey and WhatsAppSessionID are a temporary .env-driven
	// fallback for OpenWASender.Send, used only when Settings > WhatsApp
	// (settings.CategoryWhatsApp) has never been configured — see app.go's
	// whatsappLoader. WhatsAppOrigin doubles as the send path's base URL in
	// that fallback, so this never introduces a second "where is OpenWA"
	// setting alongside it.
	WhatsAppAPIKey    string
	WhatsAppSessionID string
}

// LoadConfig reads a .env file if present (local/dev convenience) and
// returns the resolved Config. In deployed environments, real env vars are
// used directly and a missing .env file is not an error.
func LoadConfig() Config {
	_ = godotenv.Load()

	return Config{
		Port:   getEnv("PORT", "8080"),
		DBHost: getEnv("DB_HOST", "localhost"),
		DBPort: getEnv("DB_PORT", "5432"),
		// Deliberately still the pre-rebrand names: these are the role and
		// database that the existing installation's data actually lives in,
		// and a default is only useful if it connects to something real.
		// Renaming a live Postgres role/database is a migration to run
		// separately, not a side effect of rebranding. .env.example shows the
		// CloudHouse names for a fresh setup.
		DBUser:     getEnv("DB_USER", "ambikagold"),
		DBPassword: getEnv("DB_PASSWORD", "ambikagold"),
		DBName:     getEnv("DB_NAME", "ambikagold"),
		DBSSLMode:  getEnv("DB_SSLMODE", "disable"),
		// Off by default — see the field comments. "30s" / "60s" are sensible
		// production values once migrations are run separately.
		DBStatementTimeout: getEnv("DB_STATEMENT_TIMEOUT", ""),
		DBIdleTxTimeout:    getEnv("DB_IDLE_TX_TIMEOUT", ""),
		DBMaxOpenConns:     getEnvInt("DB_MAX_OPEN_CONNS", 25),
		DBMaxIdleConns:     getEnvInt("DB_MAX_IDLE_CONNS", 5),
		FrontendDir:        getEnv("FRONTEND_DIR", "../frontend/out"),
		// FrontendOrigin is the Next.js dev server origin allowed to make
		// cross-origin API calls (`next dev` runs on its own port, separate
		// from this API). Not needed in production, where the built frontend
		// is served from this same binary/origin.
		FrontendOrigin: getEnv("FRONTEND_ORIGIN", "http://localhost:3000,http://localhost:3100"),
		BaseDomain:     getEnv("BASE_DOMAIN", "cloudhousefinance.com"),
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
		SetuClientID:         getEnv("SETU_CLIENT_ID", ""),
		SetuClientSecret:     getEnv("SETU_CLIENT_SECRET", ""),
		SetuProductInstance:  getEnv("SETU_PRODUCT_INSTANCE_ID", ""),
		SetuBaseURL:          getEnv("SETU_BASE_URL", "https://dg-sandbox.setu.co"),

		SetuDigilockerClientID:        getEnv("SETU_DIGILOCKER_CLIENT_ID", ""),
		SetuDigilockerClientSecret:    getEnv("SETU_DIGILOCKER_CLIENT_SECRET", ""),
		SetuDigilockerProductInstance: getEnv("SETU_DIGILOCKER_PRODUCT_INSTANCE_ID", ""),
		SetuDigilockerBaseURL:         getEnv("SETU_DIGILOCKER_BASE_URL", "https://dg-sandbox.setu.co"),

		SetuEsignClientID:        getEnv("SETU_ESIGN_CLIENT_ID", ""),
		SetuEsignClientSecret:    getEnv("SETU_ESIGN_CLIENT_SECRET", ""),
		SetuEsignProductInstance: getEnv("SETU_ESIGN_PRODUCT_INSTANCE_ID", ""),
		SetuEsignBaseURL:         getEnv("SETU_ESIGN_BASE_URL", "https://dg-sandbox.setu.co"),

		RazorpayKeyID:         getEnv("RAZORPAY_KEY_ID", ""),
		RazorpayKeySecret:     getEnv("RAZORPAY_KEY_SECRET", ""),
		RazorpayWebhookSecret: getEnv("RAZORPAY_WEBHOOK_SECRET", ""),

		SuperAdminBootstrapUsername: getEnv("SUPERADMIN_USERNAME", ""),
		SuperAdminBootstrapPassword: getEnv("SUPERADMIN_PASSWORD", ""),
		SuperAdminBootstrapName:     getEnv("SUPERADMIN_NAME", ""),

		WhatsAppOrigin:    getEnv("WHATSAPP_ORIGIN", "http://127.0.0.1:2785"),
		WhatsAppAPIKey:    getEnv("WHATSAPP_API_KEY", ""),
		WhatsAppSessionID: getEnv("WHATSAPP_SESSION_ID", ""),
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
const jwtDevFallbackSecret = "cloudhouse-dev-only-jwt-secret-do-not-use-in-production"

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

// getEnvInt reads an integer env var, falling back when unset or unparseable.
// Unparseable is treated as unset rather than fatal, matching how every other
// value in this file degrades to its default.
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
