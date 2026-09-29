package superadmin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// The superadmin's way back in for a business whose owner has forgotten their
// Administrator password (or username). The business's own forgot-password
// flow needs an SMS OTP to a phone on file; an admin created without a phone,
// or who has lost it, has no other route, so the vendor resets it from here.

var ErrAdminNotFound = httpx.NewNotFound("this business has no administrator login")

// AdminLogin is what the console shows for a business's Administrator. The
// password hash is never sent — the console only ever SETS a password.
type AdminLogin struct {
	EmployeeID uint   `json:"employeeId"`
	Name       string `json:"name"`
	Username   string `json:"username"`
	Phone      string `json:"phone"`
}

type UpdateAdminLoginInput struct {
	Name     string
	Username string
	// Password is optional: empty keeps the current one, so a username fix
	// does not force a password change.
	Password string
}

// inTenantTx runs fn in a transaction declared to Postgres as belonging to
// tenantID, with a context the tenant-scope filter stamps the same way. See
// CreateBusiness for why a superadmin request needs the set_config: it is not
// pinned to any business, so Row-Level Security would hide every employee row.
func (s *Service) inTenantTx(ctx context.Context, tenantID uint, fn func(tx *gorm.DB, tctx context.Context) error) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, fmt.Sprint(tenantID)).Error; err != nil {
			return fmt.Errorf("declaring the business to postgres: %w", err)
		}
		return fn(tx, platform.WithTenant(ctx, tenantID))
	})
}

// findAdmin picks THE administrator login: the EMP-ADMIN row CreateBusiness
// made if it still exists, otherwise the oldest Administrator. A business can
// have several Administrators; this is the owner's original login.
func findAdmin(tx *gorm.DB, tctx context.Context) (*employee.Employee, error) {
	var e employee.Employee
	err := tx.WithContext(tctx).
		Where("role = ?", employee.AdminRole).
		Order("CASE WHEN code = 'EMP-ADMIN' THEN 0 ELSE 1 END, id").
		First(&e).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrAdminNotFound
	}
	return &e, err
}

func (s *Service) GetAdminLogin(ctx context.Context, id uint) (*AdminLogin, error) {
	if _, err := s.tenantRepo.FindByID(ctx, id); err != nil {
		return nil, ErrBusinessNotFound
	}
	var out *AdminLogin
	err := s.inTenantTx(ctx, id, func(tx *gorm.DB, tctx context.Context) error {
		e, err := findAdmin(tx, tctx)
		if err != nil {
			return err
		}
		out = &AdminLogin{EmployeeID: e.ID, Name: e.Name, Username: e.Username, Phone: e.Phone}
		return nil
	})
	return out, err
}

// UpdateAdminLogin sets the Administrator's name, username and (optionally)
// password. The reason is optional, matching the wizard's other edits; the
// audit row is written either way and never contains the password.
//
// Sessions already signed in are NOT ended — staff JWTs carry no password
// version to invalidate. A new password takes effect at the next sign-in.
func (s *Service) UpdateAdminLogin(ctx context.Context, actor *SuperAdminUser, id uint, in UpdateAdminLoginInput, reason string) (*AdminLogin, error) {
	reason = optionalReason(reason)
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	username := strings.TrimSpace(in.Username)
	if username == "" {
		return nil, ErrAdminUsernameReq
	}
	if in.Password != "" && len(in.Password) < 8 {
		return nil, ErrAdminPasswordWeak
	}

	var out *AdminLogin
	var changes []string
	err = s.inTenantTx(ctx, id, func(tx *gorm.DB, tctx context.Context) error {
		e, err := findAdmin(tx, tctx)
		if err != nil {
			return err
		}
		updates := map[string]any{}
		if name := strings.TrimSpace(in.Name); name != "" && name != e.Name {
			updates["name"] = name
			changes = append(changes, fmt.Sprintf("name: %q -> %q", e.Name, name))
		}
		if username != e.Username {
			updates["username"] = username
			changes = append(changes, fmt.Sprintf("username: %q -> %q", e.Username, username))
		}
		if in.Password != "" {
			hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost+2)
			if err != nil {
				return err
			}
			updates["password_hash"] = string(hash)
			// A pending SMS reset code must not outlive the password it was for.
			updates["password_reset_token_hash"] = ""
			updates["password_reset_expires_at"] = nil
			changes = append(changes, "password reset")
		}
		if len(updates) > 0 {
			if err := tx.WithContext(tctx).Model(e).Updates(updates).Error; err != nil {
				if isUniqueViolation(err) {
					return httpx.NewConflict("that username is already used by another employee of this business")
				}
				return err
			}
		}
		if err := tx.WithContext(tctx).First(e, e.ID).Error; err != nil {
			return err
		}
		out = &AdminLogin{EmployeeID: e.ID, Name: e.Name, Username: e.Username, Phone: e.Phone}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(changes) > 0 {
		s.audit(ctx, actor, ActionUpdateAdminLogin, &t.ID, t.Name, strings.Join(changes, "; "), reason)
	}
	return out, nil
}
