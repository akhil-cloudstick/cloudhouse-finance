package branding

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/internal/upload"
)

// ErrNoLogo is returned when a business has not set a logo, or has set one
// whose file has since gone missing. Both are a 404 for the same reason: the
// caller asked for an image that is not there, and which case it is tells
// them nothing useful.
var ErrNoLogo = httpx.NewNotFound("no logo for this business")

// Service reads branding. It has no write methods at all — branding is set
// by the vendor through internal/superadmin, which is where the audit trail
// and the mandatory reason live.
type Service struct {
	tenants    *tenant.Repository
	files      *upload.Repository
	uploadsDir string
	// connect holds the short-lived mobile connect codes (see connect.go).
	connect *connectStore
}

func NewService(tenants *tenant.Repository, files *upload.Repository, uploadsDir string) *Service {
	return &Service{tenants: tenants, files: files, uploadsDir: uploadsDir, connect: newConnectStore()}
}

// PublicByCode answers the login page. It NEVER returns an error for an
// unknown code — see the package doc on enumeration.
//
// The lookup runs under AllowCrossTenant because there is no session yet to
// scope it to; resolving a business from its code is the one thing this call
// exists to do, exactly as auth.Service.resolveTenant does at login.
func (s *Service) PublicByCode(ctx context.Context, code string) Public {
	t, err := s.tenants.FindByCode(platform.AllowCrossTenant(ctx), code)
	if err != nil {
		return defaultPublic()
	}
	return publicOf(t, t.LogoPath())
}

// PublicByHost answers the login page when it is reached at a business's own
// subdomain rather than a slugged /:code path — e.g.
// https://ambika.cloudhousefinance.com. Mirrors PublicByCode exactly,
// including never returning an error for an unresolvable host (see the
// package doc on enumeration): a host that names no business (the shared
// domain, an IP, a reserved label) gets the same defaultPublic() an unknown
// :code does, so this cannot be used to probe which subdomains are taken.
func (s *Service) PublicByHost(ctx context.Context, host string) Public {
	t, err := s.tenants.FindByHostLabel(platform.AllowCrossTenant(ctx), host)
	if err != nil {
		return defaultPublic()
	}
	return publicOf(t, t.LogoPath())
}

// ForTenant answers a signed-in app. The tenant comes from the caller's
// token via the context, never from a parameter — there is deliberately no
// way to ask this for a business other than your own.
func (s *Service) ForTenant(ctx context.Context) (*Self, error) {
	id, ok := platform.TenantFromContext(ctx)
	if !ok || id == 0 {
		return nil, httpx.NewUnauthorized("no business in session")
	}
	t, err := s.tenants.FindByID(platform.AllowCrossTenant(ctx), id)
	if err != nil {
		return nil, err
	}
	return &Self{
		Public:       publicOf(t, t.LogoPath()),
		AddressLine:  t.AddressLine,
		KMLRegNo:     t.KMLRegNo,
		Modules:      t.EffectiveModuleList(),
		Languages:    t.LanguageList(),
		SingleBranch: t.SingleBranch,
	}, nil
}

// LogoFile resolves a business's logo to an on-disk path and the content type
// recorded when it was uploaded.
//
// The key is taken from the TENANT ROW and looked up under that tenant's own
// scope, so the only file this can ever return is the one that business
// nominated as its logo. A caller supplying a key gets nowhere near here.
func (s *Service) LogoFile(ctx context.Context, code string) (path, contentType string, err error) {
	t, err := s.tenants.FindByCode(platform.AllowCrossTenant(ctx), code)
	if err != nil {
		return "", "", ErrNoLogo
	}
	if t.LogoStorageKey == "" {
		return "", "", ErrNoLogo
	}
	f, err := s.files.FindByStorageKey(platform.WithTenant(ctx, t.ID), t.LogoStorageKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", "", ErrNoLogo
		}
		return "", "", err
	}
	// upload.ResolvePath, not a bare filepath.Join(s.uploadsDir, f.StorageKey):
	// a logo written after the per-tenant upload split (see
	// upload.TenantDir) lives at <uploadsDir>/<tenantID>/<key>, and the naive
	// join 404'd every tenant's logo by looking for it at <uploadsDir>/<key>
	// instead. ResolvePath tries the per-tenant path first, falling back to
	// the flat legacy layout for files written before the split.
	return upload.ResolvePath(s.uploadsDir, t.ID, f.StorageKey), f.ContentType, nil
}
