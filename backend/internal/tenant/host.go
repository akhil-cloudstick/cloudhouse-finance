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
