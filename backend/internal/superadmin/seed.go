package superadmin

import (
	"context"
	"log"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// SeedBootstrapUser ensures at least one superadmin login exists, from
// environment variables rather than a hardcoded constant — unlike
// employee.SeedAdmin's fixed "admin@123", there is no safe fixed password to
// bake in for the console that can create and suspend every business on the
// deployment.
//
// Create-only: if any superadmin user already exists, this does nothing at all,
// even if the env vars differ from what's stored. A superadmin user is a real
// account from that point on, managed like any other — this exists purely
// to open the very first door on a fresh database. If username/password are
// unset, this logs a warning and returns nil rather than failing the boot:
// a fresh install with no superadmin console configured yet should still serve
// the tenant-facing product.
func SeedBootstrapUser(db *gorm.DB, username, password, name string) error {
	ctx := context.Background()
	repo := NewRepository(db)

	n, err := repo.CountSuperAdminUsers(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil // already bootstrapped — never touch an existing superadmin user
	}
	if username == "" || password == "" {
		log.Printf("superadmin: no superadmin user exists and SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD are unset — " +
			"the superadmin console has no way in until one is seeded or created")
		return nil
	}
	if name == "" {
		name = username
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost+2)
	if err != nil {
		return err
	}
	u := &SuperAdminUser{Name: name, Username: username, PasswordHash: string(hash), IsActive: true}
	if err := repo.CreateSuperAdminUser(ctx, u); err != nil {
		return err
	}
	log.Printf("superadmin: seeded the first superadmin login (id=%d): %s", u.ID, username)
	return nil
}
