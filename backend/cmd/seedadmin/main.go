// Command seedadmin creates (or fixes up) a single Administrator login,
// standalone from the API server: `go run ./cmd/seedadmin`.
//
// It is idempotent — safe to re-run. If an employee with the target email
// already exists, its password/role are reset to match rather than erroring,
// so this doubles as a "reset the admin password" escape hatch.
//
// It does not run AutoMigrate itself — run `go run ./cmd/migrate` first (or
// start the API server once) so the employees/branches tables exist.
package main

import (
	"errors"
	"log"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/platform"
)

// Hardcoded per the one-off request this seeds — not read from env/flags
// since this is a single-purpose bootstrap command, not a general user
// creation tool (use the Employees UI/API for that).
const (
	adminEmail    = "admin@cloudstick.io"
	adminPassword = "admin@123"
	adminName     = "Admin"
	adminCode     = "EMP-ADMIN"
	adminRole     = "Administrator" // must match employee.ValidRoles exactly
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	branchRepo := branch.NewRepository(db)
	empRepo := employee.NewRepository(db)

	// employees.branch_id is NOT NULL — attach the admin to some branch
	// rather than requiring one to already exist and be picked by ID.
	b, err := branchRepo.FirstOrCreateByName("Head Office")
	if err != nil {
		log.Fatalf("branch lookup/create failed: %v", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost+2)
	if err != nil {
		log.Fatalf("password hash failed: %v", err)
	}

	existing, err := empRepo.FindByEmail(adminEmail)
	switch {
	case err == nil:
		existing.Role = adminRole
		existing.PasswordHash = string(hash)
		if err := empRepo.Update(existing); err != nil {
			log.Fatalf("admin update failed: %v", err)
		}
		log.Printf("admin employee already existed (id=%d) — role/password reset", existing.ID)

	case errors.Is(err, gorm.ErrRecordNotFound):
		emp := &employee.Employee{
			Code:         adminCode,
			Name:         adminName,
			Role:         adminRole,
			BranchID:     b.ID,
			Email:        adminEmail,
			PasswordHash: string(hash),
		}
		if err := empRepo.Create(emp); err != nil {
			log.Fatalf("admin create failed: %v", err)
		}
		log.Printf("admin employee created (id=%d)", emp.ID)

	default:
		log.Fatalf("admin lookup failed: %v", err)
	}

	log.Printf("seeded admin login: %s / %s", adminEmail, adminPassword)
}
