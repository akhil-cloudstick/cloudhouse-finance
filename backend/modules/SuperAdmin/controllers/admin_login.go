package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/SuperAdmin/models"
	"context"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AdminLogin struct {
	EmployeeID uint   `json:"employee_id"`
	Name       string `json:"name"`
	Username   string `json:"username"`
	Phone      string `json:"phone"`
}

type UpdateAdminLoginInput struct {
	Name     string
	Username string
	Password string
}

func inTenantTx(ctx context.Context, tenantID uint, fn func(tx *gorm.DB, tctx context.Context) error) error {
	return config.BaseDB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, fmt.Sprint(tenantID)).Error; err != nil {
			return fmt.Errorf("declaring the business to postgres: %w", err)
		}
		return fn(tx, config.WithTenant(ctx, tenantID))
	})
}

func findAdmin(tx *gorm.DB, tctx context.Context) (*commonModels.Employee, error) {
	var e commonModels.Employee
	err := tx.WithContext(tctx).
		Where("role = ?", "Administrator").
		Order("CASE WHEN code = 'EMP-ADMIN' THEN 0 ELSE 1 END, id").
		First(&e).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, common.NewNotFound("this business has no administrator login")
	}
	return &e, err
}

func getAdminLogin(ctx context.Context, id uint) (*AdminLogin, error) {
	if _, err := common.FindTenantByID(ctx, id); err != nil {
		return nil, common.NewNotFound("business not found")
	}
	var out *AdminLogin
	err := inTenantTx(ctx, id, func(tx *gorm.DB, tctx context.Context) error {
		e, err := findAdmin(tx, tctx)
		if err != nil {
			return err
		}
		out = &AdminLogin{EmployeeID: e.ID, Name: e.Name, Username: e.Username, Phone: e.Phone}
		return nil
	})
	return out, err
}

func updateAdminLogin(ctx context.Context, actor *models.SuperAdminUser, id uint, in UpdateAdminLoginInput, reason string) (*AdminLogin, error) {
	reason = optionalReason(reason)
	t, err := common.FindTenantByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	username := strings.TrimSpace(in.Username)
	if username == "" {
		return nil, common.NewBadRequest("an initial administrator username is required")
	}
	if in.Password != "" && len(in.Password) < 8 {
		return nil, common.NewBadRequest("the initial administrator password must be at least 8 characters")
	}
	var out *AdminLogin
	var changes []string
	err = inTenantTx(ctx, id, func(tx *gorm.DB, tctx context.Context) error {
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
					return common.NewConflict("that username is already used by another employee of this business")
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
		auditBusiness(ctx, actor, "update_admin_login", &t.ID, t.Name, strings.Join(changes, "; "), reason)
	}
	return out, nil
}
