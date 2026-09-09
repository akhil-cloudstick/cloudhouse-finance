// Command seedadmin resets the single bootstrap Administrator login back to
// its default credentials: `go run ./cmd/seedadmin`.
//
// The admin is normally created for you — internal/migrate.Run seeds it on
// every server boot and on `go run ./cmd/migrate` — but only when it does
// not already exist, so a live account is never clobbered by a restart. This
// command is the deliberate "locked out, let me back in" escape hatch: it
// calls the same employee.SeedAdmin with reset=true, which resets the
// password and role of an existing admin instead of leaving it alone.
//
// It does not run AutoMigrate itself — run `go run ./cmd/migrate` first (or
// start the API server once) so the employees/branches tables exist.
package main

import (
	"log"

	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/platform"
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	if err := employee.SeedAdmin(db, true); err != nil {
		log.Fatalf("admin seed failed: %v", err)
	}

	log.Printf("seeded admin login: %s / %s", employee.AdminUsername, employee.AdminPassword)
}
