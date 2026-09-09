package employee

import (
	"context"
	"errors"
	"log"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform"
)

// Bootstrap Administrator credentials. Hardcoded rather than read from
// env/flags: this is a single-purpose "there must be one way in on a fresh
// database" bootstrap, not a general user-creation path (use the Employees
// UI/API for that).
const (
	AdminUsername = "admin"
	AdminEmail    = "admin@cloudstick.io"
	AdminPassword = "admin@123"
	AdminName     = "Admin"
	AdminCode     = "EMP-ADMIN"
	AdminRole     = "Administrator" // must match ValidRoles exactly
)

// SeedAdmin ensures a single Administrator login exists, so a freshly
// migrated database is never left with no way to sign in. It is called from
// internal/migrate.Run, which means it runs on every server boot and on
// `go run ./cmd/migrate`.
//
// reset controls what happens when the account already exists:
//
//   - false (the migration's behavior) — leave it completely untouched. An
//     administrator who changed their password, role or username must not
//     have it silently reverted on the next server restart.
//   - true (`go run ./cmd/seedadmin`) — reset the password/role/username back
//     to the constants above, the deliberate "locked out, let me back in"
//     escape hatch.
//
// Idempotent either way. Requires the employees/branches tables to exist,
// so it must run after AutoMigrate.
func SeedAdmin(db *gorm.DB, reset bool) error {
	// Boot-time seeding runs outside any request, so it has no tenant.
	// Marked cross-tenant deliberately — see platform.AllowCrossTenant.
	ctx := platform.AllowCrossTenant(context.Background())
	repo := NewRepository(db)

	// Look up by username first, then by email. The email fallback matters
	// for databases seeded by the older cmd/seedadmin, which set Email but
	// no Username — creating a second row for those would collide with the
	// partial unique index on email and fail the whole migration.
	existing, err := repo.FindByUsername(ctx, AdminUsername)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		existing, err = repo.FindByEmail(ctx, AdminEmail)
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err == nil {
		// Repair a legacy admin that has no username even when reset is
		// false: without one it cannot log in at all (auth.Login matches on
		// username or phone, never email), so filling it in restores access
		// rather than overwriting anything the user chose.
		if existing.Username == "" {
			existing.Username = AdminUsername
			if err := repo.Update(ctx, existing); err != nil {
				return err
			}
			log.Printf("admin employee (id=%d) had no username — set to %q so it can log in", existing.ID, AdminUsername)
		}
		if !reset {
			return nil // already bootstrapped — never clobber a live password
		}
		hash, hErr := hashAdminPassword()
		if hErr != nil {
			return hErr
		}
		existing.Role = AdminRole
		existing.Username = AdminUsername
		existing.PasswordHash = hash
		if err := repo.Update(ctx, existing); err != nil {
			return err
		}
		log.Printf("admin employee already existed (id=%d) — username/role/password reset", existing.ID)
		return nil
	}

	// employees.branch_id is NOT NULL — attach the admin to some branch
	// rather than requiring one to already exist and be picked by ID.
	b, err := branch.NewRepository(db).FirstOrCreateByName(ctx, "Head Office")
	if err != nil {
		return err
	}
	hash, err := hashAdminPassword()
	if err != nil {
		return err
	}
	emp := &Employee{
		Code:         AdminCode,
		Name:         AdminName,
		Role:         AdminRole,
		BranchID:     b.ID,
		Username:     AdminUsername,
		Email:        AdminEmail,
		PasswordHash: hash,
	}
	if err := repo.Create(ctx, emp); err != nil {
		return err
	}
	log.Printf("seeded admin login (id=%d): %s / %s", emp.ID, AdminUsername, AdminPassword)
	return nil
}

func hashAdminPassword() (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(AdminPassword), bcrypt.DefaultCost+2)
	return string(h), err
}
