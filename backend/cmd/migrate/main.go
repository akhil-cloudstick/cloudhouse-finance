// Command migrate applies internal/migrate.Run standalone, from the
// configured database, without starting the HTTP server. Useful for CI or a
// migrate-only invocation: `go run ./cmd/migrate`. The API server
// (backend/main.go) calls the exact same internal/migrate.Run on every boot,
// so this command and the server can never drift apart.
package main

import (
	"log"

	"ambikagold/backend/internal/migrate"
	"ambikagold/backend/internal/platform"
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	if err := migrate.Run(db, cfg); err != nil {
		log.Fatalf("migration failed: %v", err)
	}
}
