// Command migrate applies GORM AutoMigrate for all domain models against
// the configured database, standalone from the API server. Useful for CI
// or first-time local setup: `go run ./cmd/migrate`.
package main

import (
	"log"

	"ambikagold/backend/internal/cash"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/scheme"
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	if err := db.AutoMigrate(
		&scheme.Scheme{},
		&goldrate.GoldRate{},
		&employee.Employee{},
		&cash.CashMovement{},
		&cash.Expense{},
	); err != nil {
		log.Fatalf("auto-migrate failed: %v", err)
	}

	log.Println("migrations applied successfully")
}
