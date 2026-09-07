// Command seedphoneadmin creates (or updates) a one-off Administrator login
// identified by phone number rather than the fixed bootstrap admin/admin@123
// account in internal/employee.SeedAdmin. Ad hoc — not wired into
// internal/migrate — run manually with: go run ./cmd/seedphoneadmin
package main

import (
	"context"
	"errors"
	"log"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/platform"
)

const (
	phone    = "8078532691"
	password = "admin123"
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	// Runs outside any request, so it has no tenant. Marked cross-tenant
	// deliberately — see platform.AllowCrossTenant.
	ctx := platform.AllowCrossTenant(context.Background())

	repo := employee.NewRepository(db)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost+2)
	if err != nil {
		log.Fatalf("hash password failed: %v", err)
	}

	existing, err := repo.FindByPhone(ctx, phone)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Fatalf("lookup failed: %v", err)
	}
	if err == nil {
		existing.Role = "Administrator"
		existing.PasswordHash = string(hash)
		if err := repo.Update(ctx, existing); err != nil {
			log.Fatalf("update failed: %v", err)
		}
		log.Printf("updated existing employee (id=%d) to Administrator with new password, phone=%s", existing.ID, phone)
		return
	}

	// Prefer whatever branch already exists rather than
	// FirstOrCreateByName's "Head Office", which fails when a legacy branch
	// with a blank code already occupies the single-blank-code slot.
	var b branch.Branch
	if err := db.Order("id").First(&b).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Fatalf("branch lookup failed: %v", err)
		}
		created, cErr := branch.NewRepository(db).FirstOrCreateByName(ctx, "Head Office")
		if cErr != nil {
			log.Fatalf("branch create failed: %v", cErr)
		}
		b = *created
	}

	emp := &employee.Employee{
		Code:         "EMP-ADMIN-" + phone,
		Name:         "Admin",
		Role:         "Administrator",
		BranchID:     b.ID,
		Phone:        phone,
		PasswordHash: string(hash),
	}
	if err := repo.Create(ctx, emp); err != nil {
		log.Fatalf("create failed: %v", err)
	}
	log.Printf("seeded admin login (id=%d): phone=%s / password=%s", emp.ID, phone, password)
}
