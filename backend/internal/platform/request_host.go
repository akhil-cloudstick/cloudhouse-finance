package platform

import (
	"context"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform/httpx"
)

type requestHostCtxKey struct{}

// WithRequestHost records the host a request arrived on.
//
// Client-supplied, and treated as such everywhere it is read: it may narrow
// which business a sign-in applies to, or cause a mismatched session to be
// refused, but it never grants access to anything. See tenant.FindByAppURL.
func WithRequestHost(ctx context.Context, host string) context.Context {
	if host == "" {
		return ctx
	}
	return context.WithValue(ctx, requestHostCtxKey{}, host)
}

// RequestHostFromContext returns the host the request arrived on, if any.
func RequestHostFromContext(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	h, ok := ctx.Value(requestHostCtxKey{}).(string)
	return h, ok && h != ""
}

// CarryRequestHost puts the request's host on its context for later lookups.
//
// Mounted globally and early, before authentication, because the borrower
// sign-in endpoints that use it are public by definition — they are how a
// session is obtained in the first place.
func CarryRequestHost() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request = c.Request.WithContext(WithRequestHost(c.Request.Context(), c.Request.Host))
		c.Next()
	}
}

// TenantHostResolver resolves the business whose frontend is served from a
// host. Implemented by tenant.Repository; an interface here so platform does
// not import internal/tenant.
type TenantHostResolver interface {
	TenantIDForHost(ctx context.Context, host string) (uint, bool)
}

// RequireHostMatchesTenant refuses a session that was issued for one business
// but presented against another business's frontend.
//
// Each business has its own URL, so a token minted at business A's app has no
// legitimate reason to arrive at business B's. Rejecting the combination
// closes off replaying a stolen or exported token through a different
// business's site, and it costs an honest caller nothing.
//
// It can only REFUSE. A host that matches no business — the shared API
// domain, an IP, localhost, a health check — is not a mismatch and passes
// through untouched, because the host is client-supplied and must never be
// the thing that decides a request is allowed.
//
// Mounted AFTER the auth middleware, since it compares against the business
// that authentication established.
func RequireHostMatchesTenant(resolver TenantHostResolver) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID, ok := TenantFromGin(c)
		if !ok {
			c.Next()
			return
		}
		hostTenant, matched := resolver.TenantIDForHost(c.Request.Context(), c.Request.Host)
		if matched && hostTenant != tenantID {
			// Deliberately the same message an expired session gets: a
			// caller probing with a borrowed token learns nothing about
			// which businesses exist or which host belongs to which.
			httpx.FailAbort(c, 401, "your session is no longer valid — please sign in again")
			return
		}
		c.Next()
	}
}
