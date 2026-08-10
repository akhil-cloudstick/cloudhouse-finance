package platform

import (
	"os"

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
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
