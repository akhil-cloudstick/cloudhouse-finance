package controllers

import (
	"cloudhouse/backend/auth"
	"cloudhouse/backend/config"
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/labstack/echo/v4"
)

const AuthCookieName = "cloudhouse_files"

func sanitizeHeaderValue(s string) string {
	s = strings.ReplaceAll(s, `"`, "")
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", "")
	if s == "" {
		return "file"
	}
	return s
}

func tenantFromCookie(c echo.Context) (tenantID, customerID uint, ok bool) {
	raw := ""
	if h := c.Request().Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		raw = strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	if raw == "" {
		cookie, err := c.Cookie(AuthCookieName)
		if err != nil || cookie.Value == "" {
			return 0, 0, false
		}
		raw, _ = url.QueryUnescape(cookie.Value)
	}
	if claims, err := auth.ParseToken(raw, config.Env.JWTSecret); err == nil && claims.TenantID != 0 {
		if session, ok := CurrentSession(config.WithTenant(c.Request().Context(), claims.TenantID), claims.EmployeeID); !ok || !session.IsActive {
			return 0, 0, false
		}
		return claims.TenantID, 0, true
	}
	if claims, err := auth.ParseCustomerToken(raw, config.Env.JWTSecret); err == nil && claims.TenantID != 0 && claims.CustomerID != 0 {
		return claims.TenantID, claims.CustomerID, true
	}
	return 0, 0, false
}

func customerOwnsUpload(ctx context.Context, customerID uint, url string) bool {
	var owns bool
	err := config.DB.
		WithContext(ctx).Raw(`SELECT EXISTS (SELECT 1 FROM customers WHERE id = ? AND deleted_at IS NULL AND ? IN (photo_url, identity_proof_url, address_proof_url, kyc_document_url))
			OR EXISTS (SELECT 1 FROM loans WHERE customer_id = ? AND deleted_at IS NULL AND indemnity_bond_signed_url = ?)
			OR EXISTS (SELECT 1 FROM ornament_images oi JOIN ornaments o ON o.id = oi.ornament_id JOIN loans l ON l.id = o.loan_id WHERE l.customer_id = ? AND l.deleted_at IS NULL AND oi.image_url = ?)`,
		customerID, url, customerID, url, customerID, url).Scan(&owns).Error
	return err == nil && owns
}

func SetAuthCookie(c echo.Context, token string, maxAgeSeconds int) {
	c.SetCookie(authCookie(c, token, maxAgeSeconds))
}

func ClearAuthCookie(c echo.Context) {
	c.SetCookie(authCookie(c, "", -1))
}

func authCookie(c echo.Context, value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     AuthCookieName,
		Value:    url.QueryEscape(value),
		MaxAge:   maxAge,
		Path:     "/uploads",
		Secure:   isSecureRequest(c),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	}
}

func isSecureRequest(c echo.Context) bool {
	if c.Request().TLS != nil {
		return true
	}
	return strings.EqualFold(c.Request().Header.Get("X-Forwarded-Proto"), "https")
}

func ServeUpload(c echo.Context) error {
	key := strings.TrimPrefix(c.Param("key"), "/")
	if key == "" || strings.ContainsAny(key, `/\`) || key == "." || key == ".." {
		return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "file not found"})
	}
	tenantID, customerID, ok := tenantFromCookie(c)
	if !ok {
		return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "file not found"})
	}
	ctx := config.WithTenant(c.Request().Context(), tenantID)
	rec, err := findByStorageKey(ctx, key)
	if err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "file not found"})
	}
	if customerID != 0 && !customerOwnsUpload(ctx, customerID, "/uploads/"+rec.StorageKey) {
		return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "file not found"})
	}
	// Content-Type comes from the sniffed value recorded at upload, never from the extension.
	c.Response().Header().Set("Content-Type", rec.ContentType)
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	c.Response().Header().Set("Content-Disposition", "inline; filename=\""+sanitizeHeaderValue(rec.OriginalName)+"\"")
	c.Response().Header().Set("Cache-Control", "private, max-age=300")
	return c.File(ResolveReadPath(config.Env.UploadsDir,
		tenantID, rec.StorageKey))
}
