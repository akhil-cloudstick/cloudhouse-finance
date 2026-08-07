package platform

import (
	"os"

	"github.com/joho/godotenv"
)

// Config holds all environment-driven settings for the application.
type Config struct {
	Port        string
	DBHost      string
	DBPort      string
	DBUser      string
	DBPassword  string
	DBName      string
	DBSSLMode   string
	FrontendDir string
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
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
