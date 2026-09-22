package tenant

import (
	"context"
	"net/url"
	"strings"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// NormalizeHost reduces a Host header or an AppURL to a bare comparable
// hostname: lowercased, scheme removed, port removed, trailing dot and path
// removed.
//
// Both sides of the comparison go through this, so a business stored as
// "https://ambika.example.com/" matches a request arriving with
// "Ambika.example.com:443".
func NormalizeHost(v string) string {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return ""
	}
	if strings.Contains(v, "//") {
		if u, err := url.Parse(v); err == nil && u.Host != "" {
			v = u.Host
		}
	}
	v = strings.TrimSuffix(v, "/")
	if i := strings.IndexAny(v, "/?#"); i >= 0 {
		v = v[:i]
	}
	// Strip the port. Bracketed IPv6 literals keep theirs.
	if !strings.HasPrefix(v, "[") {
		if i := strings.LastIndex(v, ":"); i >= 0 && !strings.Contains(v[i+1:], ":") {
			v = v[:i]
		}
	}
	return strings.TrimSuffix(v, ".")
}

// BaseDomain is the platform's shared domain that each business is given a
// subdomain of (e.g. "ambika" -> ambika.cloudhousesupport.site). Set once at
// boot from platform.Config.BaseDomain (see SetBaseDomain) — a package
// variable rather than a parameter threaded through every caller, since
// SubdomainLabel is called from request-handling code that has no config
// object of its own to carry it in.
var BaseDomain = "cloudhousesupport.site"

// SetBaseDomain overrides BaseDomain from the resolved app config. A blank
// value is ignored, so BaseDomain always resolves to something usable.
func SetBaseDomain(domain string) {
	domain = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
	if domain != "" {
		BaseDomain = domain
	}
}

// ReservedHostLabels are subdomain labels that never name a business — the
// platform's own bare/marketing/admin subdomains. "demo" is deliberately NOT
// here: it is an ordinary tenant code, reached at demo.<BaseDomain> like any
// other business.
var ReservedHostLabels = map[string]bool{
	"www":        true,
	"api":        true,
	"admin":      true,
	"superadmin": true,
}

// SubdomainLabel reads a tenant code off a single-level subdomain of
// BaseDomain: "ambika.cloudhousesupport.site" -> ("ambika", true).
//
// Returns ok=false when host does not end in "."+BaseDomain, when there is
// more than one label in front of BaseDomain (e.g.
// "a.b.cloudhousesupport.site" — not a single-level subdomain), or when the
// label is reserved (see ReservedHostLabels). Like FindByAppURL below, this
// only ever NARROWS or REFUSES which business a request names — it is never
// authorization.
func SubdomainLabel(host string) (label string, ok bool) {
	h := NormalizeHost(host)
	if h == "" || BaseDomain == "" {
		return "", false
	}
	suffix := "." + BaseDomain
	if !strings.HasSuffix(h, suffix) {
		return "", false
	}
	candidate := strings.TrimSuffix(h, suffix)
	if candidate == "" || strings.Contains(candidate, ".") {
		return "", false
	}
	if ReservedHostLabels[candidate] {
		return "", false
	}
	return candidate, true
}

// FindByAppURL resolves the business whose own frontend is served from host.
//
// # What this may and may not be used for
//
// The Host header is supplied by the client and is not authentication. This
// lookup therefore exists to NARROW or REFUSE, never to grant:
//
//   - Narrow: a borrower signing in at their lender's URL no longer has to
//     supply a business code, and the code cannot be swapped for another
//     business's. The OTP still has to reach their phone.
//   - Refuse: a session issued for one business, replayed against another
//     business's frontend, is rejected (platform.RequireHostMatchesTenant).
//
// Nothing is authorised because of the host. A forged Host can at most point
// a request at a business it then still has no valid token for — which is
// exactly where it started.
//
// Returns gorm.ErrRecordNotFound when the host matches no business, which
// callers must treat as "no hint available", not as an error: the API is
// reachable on hosts that belong to no particular business (the shared
// domain, an IP, localhost in development).
func (r *Repository) FindByAppURL(ctx context.Context, host string) (*Tenant, error) {
	h := NormalizeHost(host)
	if h == "" {
		return nil, gorm.ErrRecordNotFound
	}

	// Compared in Go rather than SQL because app_url is stored as a full URL
	// with scheme, optional port and optional trailing slash, and normalising
	// that in SQL would be a string-manipulation expression no index could
	// serve anyway. The tenant count is small and this runs once per sign-in.
	var all []Tenant
	if err := r.db.WithContext(platform.AllowCrossTenant(ctx)).
		Where("app_url <> ''").Find(&all).Error; err != nil {
		return nil, err
	}
	for i := range all {
		if NormalizeHost(all[i].AppURL) == h {
			return &all[i], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

// TenantIDForHost implements platform.TenantHostResolver.
//
// Returns false when the host belongs to no business, which callers must
// treat as "no opinion" rather than as a denial — see FindByAppURL.
func (r *Repository) TenantIDForHost(ctx context.Context, host string) (uint, bool) {
	t, err := r.FindByAppURL(ctx, host)
	if err != nil || t == nil {
		return 0, false
	}
	return t.ID, true
}
