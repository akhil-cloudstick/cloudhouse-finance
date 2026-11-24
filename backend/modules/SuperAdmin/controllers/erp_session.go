package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/SuperAdmin/models"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

/* ERP console sign-in.
 *
 * The CloudHouse ERP hosts this product's super admin console. An ERP
 * employee who is signed in to the ERP (and holds the ERP's console
 * permission) gets a 60-second ES256 token signed with the ERP's private key;
 * the ERP frontend posts it here and receives an ordinary Gold super admin
 * token in exchange. Every existing super admin route and middleware is
 * unchanged — they simply see a normal super admin session.
 *
 * Each ERP employee maps to their own superadmin_users row
 * ("erp:<employee_id>") so the audit log names the real person. Those rows
 * have an unusable password hash, so they can never sign in through the
 * password login. Setting is_active=false on a row blocks that employee here.
 *
 * Disabled (404) unless ERP_CONSOLE_PUBLIC_KEY(_FILE) is configured. */

const erpUsernamePrefix = "erp:"

// unusablePasswordHash is not a valid bcrypt hash, so bcrypt.Compare always
// fails and the password login can never match an ERP-mapped account.
const unusablePasswordHash = "!erp-console"

type erpSessionRequest struct {
	Token string `json:"token"`
}

func ERPSession(c echo.Context) error {
	if config.Env.ERPConsolePublicKey == "" {
		return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "not found"})
	}
	var req erpSessionRequest
	if err := common.BindJSON(c, &req); err != nil || strings.TrimSpace(req.Token) == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid input"})
	}
	token, u, err := erpSession(auth.RequestContext(c), strings.TrimSpace(req.Token))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{
		"token":            token,
		"expires_in":       int(config.Env.ERPConsoleExpiry.Seconds()),
		"super_admin_user": echo.Map{"id": u.ID, "name": u.Name, "username": u.Username},
	})
}

func erpSession(ctx context.Context, erpToken string) (string, *models.SuperAdminUser, error) {
	claims, err := auth.ParseERPConsoleToken(erpToken, config.Env.ERPConsolePublicKey, config.Env.ERPConsoleAudience)
	if err != nil {
		return "", nil, common.NewUnauthorized("your ERP session could not be verified — please sign in to the ERP again")
	}
	username := fmt.Sprintf("%s%d", erpUsernamePrefix, claims.EmployeeID)
	if claims.System {
		username, claims.Name = erpUsernamePrefix+"system", "ERP (automatic)"
	}
	u, err := upsertERPSuperAdmin(ctx, username, claims.Name)
	if err != nil {
		return "", nil, err
	}
	if !u.IsActive {
		return "", nil, common.NewForbidden("console access for this ERP user has been disabled")
	}
	token, err := auth.IssueSuperAdminToken(u.ID, u.Name, config.Env.JWTSecret, config.Env.ERPConsoleExpiry)
	if err != nil {
		return "", nil, err
	}
	return token, u, nil
}

func upsertERPSuperAdmin(ctx context.Context, username, name string) (*models.SuperAdminUser, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "ERP user " + strings.TrimPrefix(username, erpUsernamePrefix)
	}
	if len(name) > 120 {
		name = name[:120]
	}
	db := config.BaseDB.WithContext(config.AllowCrossTenant(ctx))

	u, err := findSuperAdminUserByUsername(ctx, username)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		u = &models.SuperAdminUser{Name: name, Username: username, PasswordHash: unusablePasswordHash, IsActive: true}
		if err := db.Create(u).Error; err != nil {
			// Two first sign-ins racing on the unique username: take the winner's row.
			if again, findErr := findSuperAdminUserByUsername(ctx, username); findErr == nil {
				return again, nil
			}
			return nil, err
		}
		return u, nil
	}
	if err != nil {
		return nil, err
	}
	if u.Name != name {
		if err := db.Model(u).Update("name", name).Error; err != nil {
			return nil, err
		}
		u.Name = name
	}
	return u, nil
}
