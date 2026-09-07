package platform

import (
	"context"

	"github.com/gin-gonic/gin"
)

// tenantCtxKey is unexported and of a private type, so nothing outside this
// package can put a tenant into a context by guessing a string key. The only
// way in is WithTenant below.
type tenantCtxKey struct{}

// crossTenantCtxKey marks a context deliberately exempt from tenant
// filtering. See AllowCrossTenant.
type crossTenantCtxKey struct{}

// WithTenant returns a context carrying the tenant a request belongs to.
// Set once, by AuthMiddleware, from the authenticated token — never from
// anything the caller supplies.
func WithTenant(ctx context.Context, tenantID uint) context.Context {
	return context.WithValue(ctx, tenantCtxKey{}, tenantID)
}

// TenantFromContext returns the tenant carried by ctx, and whether one was
// present at all.
//
// The bool matters: "no tenant" and "tenant 0" must never be conflated. A
// missing tenant means the query is running outside any request — a
// background job, a migration — and the caller has to decide deliberately
// what that means, rather than silently filtering on 0 and returning an
// empty result that looks like "this business has no data".
func TenantFromContext(ctx context.Context) (uint, bool) {
	if ctx == nil {
		return 0, false
	}
	v, ok := ctx.Value(tenantCtxKey{}).(uint)
	if !ok || v == 0 {
		return 0, false
	}
	return v, true
}

// AllowCrossTenant marks a context as exempt from automatic tenant
// filtering, for the few operations that legitimately span businesses:
// migrations, the superadmin console, and background jobs that iterate tenants
// explicitly.
//
// This is deliberately verbose and greppable. `grep -rn AllowCrossTenant`
// should return a short list that a reviewer can read in full — every entry
// is a place where the isolation guarantee is being set aside on purpose.
// If that list ever grows long, the isolation has stopped being a boundary
// and become a suggestion.
func AllowCrossTenant(ctx context.Context) context.Context {
	return context.WithValue(ctx, crossTenantCtxKey{}, true)
}

// IsCrossTenantAllowed reports whether ctx was marked by AllowCrossTenant.
func IsCrossTenantAllowed(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	v, _ := ctx.Value(crossTenantCtxKey{}).(bool)
	return v
}

// TenantFromGin reads the tenant AuthMiddleware stored on the gin context.
func TenantFromGin(c *gin.Context) (uint, bool) {
	v, ok := c.Get("tenantId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	if !ok || id == 0 {
		return 0, false
	}
	return id, true
}

// RequestContext returns the request's context.Context carrying its tenant,
// ready to hand to gorm's WithContext so the automatic filter can see it.
//
// This is the bridge between the HTTP layer and the database layer, and it
// is why handlers must pass a context down rather than relying on the
// long-lived *gorm.DB the repositories were built with at boot: a shared DB
// handle has no request on it, so the filter has nothing to read.
func RequestContext(c *gin.Context) context.Context {
	ctx := c.Request.Context()
	if id, ok := TenantFromGin(c); ok {
		ctx = WithTenant(ctx, id)
	}
	return ctx
}
