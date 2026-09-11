package superadmin

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/internal/upload"
)

// The vendor-only branding and entitlement levers.
//
// These live here rather than in internal/branding for the same reason every
// other business-wide change does: internal/branding only READS, and a write
// that can rename a business on its own legal paperwork, or grant it a module
// it has not paid for, belongs behind SuperAdminAuthMiddleware with a
// mandatory reason and an audit row. See this package's doc comment.

var (
	ErrInvalidBrandColor = httpx.NewBadRequest("brand colour must be a hex value like #6054bf")
	ErrNoLogoFile        = httpx.NewBadRequest("no logo file provided (expected multipart field \"file\")")
)

// brandColorPattern matches "#rrggbb" only. Three-digit shorthand and named
// colours are refused rather than normalised: this value is echoed straight
// into a CSS custom property and used to derive a whole palette, so one
// canonical form means the derivation has exactly one input shape to handle.
var brandColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// ProfileInput carries the business's identity as it appears to its own
// customers. Code is absent on purpose — it is part of the sign-in URL every
// staff member has bookmarked, and is documented as immutable on
// tenant.Tenant.Code.
type ProfileInput struct {
	Name        string
	LegalName   string
	AddressLine string
	KMLRegNo    string
	AppURL      string
}

// UpdateProfile renames a business and sets the legal identity printed on its
// customer documents.
//
// This is the first endpoint that can change Tenant.Name after creation. That
// name is substituted into every borrower SMS (loan.Service.brandedMessage)
// and onto the pledge agreement, so the change is always audited — but the
// reason is OPTIONAL here, unlike suspension or a tier change. See
// optionalReason for why the two are treated differently.
func (s *Service) UpdateProfile(ctx context.Context, actor *SuperAdminUser, id uint, in ProfileInput, reason string) (*tenant.Tenant, error) {
	reason = optionalReason(reason)
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, ErrNameRequired
	}
	beforeName := t.Name
	t.Name = name
	t.LegalName = strings.TrimSpace(in.LegalName)
	t.AddressLine = strings.TrimSpace(in.AddressLine)
	t.KMLRegNo = strings.TrimSpace(in.KMLRegNo)
	t.AppURL = strings.TrimSpace(in.AppURL)
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	detail := fmt.Sprintf("legalName=%q kmlRegNo=%q appUrl=%q", t.LegalName, t.KMLRegNo, t.AppURL)
	if beforeName != t.Name {
		detail = fmt.Sprintf("name: %s -> %s; ", beforeName, t.Name) + detail
	}
	s.audit(ctx, actor, ActionUpdateProfile, &t.ID, t.Name, detail, reason)
	return t, nil
}

// SetBrandColor sets the ONE colour a business's whole palette is derived
// from. There is deliberately no way to set the individual ramp steps: the
// frontend generates deep/mid/light/pale/faint from this value so the derived
// shades always keep the same tonal relationship, whatever hue is chosen (see
// frontend/common/config/theme.ts).
//
// An empty value clears it back to the platform default rather than being
// rejected — "undo my colour" has to be expressible.
func (s *Service) SetBrandColor(ctx context.Context, actor *SuperAdminUser, id uint, color, reason string) (*tenant.Tenant, error) {
	reason = optionalReason(reason)
	color = strings.TrimSpace(strings.ToLower(color))
	if color != "" && !brandColorPattern.MatchString(color) {
		return nil, ErrInvalidBrandColor
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	before := t.BrandColor
	if before == "" {
		before = "default"
	}
	t.BrandColor = color
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	after := color
	if after == "" {
		after = "default"
	}
	s.audit(ctx, actor, ActionSetBranding, &t.ID, t.Name,
		fmt.Sprintf("brandColor: %s -> %s", before, after), reason)
	return t, nil
}

// SetLogo stores a business's logo and points the tenant row at it.
//
// Two things worth knowing:
//
//   - The bytes go through upload.SaveBytesRecorded, so they are validated by
//     upload.ValidateBytes, which REFUSES SVG deliberately (an SVG can carry
//     a script element, and serving one from this origin runs it with the
//     viewer's session). Tenant logos are therefore PNG, JPEG or WebP.
//   - The write runs under platform.WithTenant(ctx, id), NOT AllowCrossTenant,
//     so the uploaded_files row is stamped to the business it belongs to by
//     the ordinary create callback — the same path a staff upload takes.
//     CreateBusiness makes the same choice for the same reason.
//
// A replaced logo leaves the previous file on disk. That is intentional:
// deleting it would mean proving nothing else references it, and an orphaned
// image costs far less than a wrongly deleted one.
func (s *Service) SetLogo(ctx context.Context, actor *SuperAdminUser, id uint, filename string, data []byte, reason string) (*tenant.Tenant, error) {
	reason = optionalReason(reason)
	if len(data) == 0 {
		return nil, ErrNoLogoFile
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	if s.files == nil || s.uploadsDir == "" {
		return nil, httpx.NewBadRequest("file storage is not configured on this server")
	}
	url, err := upload.SaveBytesRecorded(platform.WithTenant(ctx, t.ID), s.files, s.uploadsDir, filename, data)
	if err != nil {
		return nil, err
	}
	before := t.LogoStorageKey
	if before == "" {
		before = "none"
	}
	t.LogoStorageKey = strings.TrimPrefix(url, "/uploads/")
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, ActionSetLogo, &t.ID, t.Name,
		fmt.Sprintf("logo: %s -> %s (%d bytes)", before, t.LogoStorageKey, len(data)), reason)
	return t, nil
}

// SetModules replaces the optional modules a business has been granted.
//
// An unknown key is a 400 rather than being silently dropped: the caller is
// the vendor's own console, so a key we do not recognise means a typo or a
// version mismatch, and quietly ignoring it would look like the tick worked.
func (s *Service) SetModules(ctx context.Context, actor *SuperAdminUser, id uint, modules []string, reason string) (*tenant.Tenant, error) {
	reason = optionalReason(reason)
	if bad := tenant.ValidateModules(modules); len(bad) > 0 {
		return nil, httpx.NewBadRequest("unknown module(s): " + strings.Join(bad, ", "))
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	before := t.EnabledModules
	if before == "" {
		before = "none"
	}
	t.SetModules(modules)
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	after := t.EnabledModules
	if after == "" {
		after = "none"
	}
	s.audit(ctx, actor, ActionSetModules, &t.ID, t.Name,
		fmt.Sprintf("modules: %s -> %s", before, after), reason)
	return t, nil
}

// SetLanguages replaces the languages a business may issue customer documents
// in. English is always retained by tenant.Tenant.SetLanguages — a business
// that could not print its own pledge agreement in any language would be a
// configuration with no legitimate use.
func (s *Service) SetLanguages(ctx context.Context, actor *SuperAdminUser, id uint, languages []string, reason string) (*tenant.Tenant, error) {
	reason = optionalReason(reason)
	if bad := tenant.ValidateLanguages(languages); len(bad) > 0 {
		return nil, httpx.NewBadRequest("unknown language(s): " + strings.Join(bad, ", "))
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	before := t.DocumentLanguages
	if before == "" {
		before = tenant.LangEnglish
	}
	t.SetLanguages(languages)
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, ActionSetLanguages, &t.ID, t.Name,
		fmt.Sprintf("languages: %s -> %s", before, t.DocumentLanguages), reason)
	return t, nil
}

// CatalogueResponse is the closed sets the console renders checkboxes from.
type CatalogueResponse struct {
	Modules   []string `json:"modules"`
	Languages []string `json:"languages"`
}

// Catalogue returns what the vendor can toggle. Served from
// tenant.KnownModules/KnownLanguages so the console cannot offer a key the
// backend would then reject, and adding a module stays a one-line change in
// one file.
func (s *Service) Catalogue() CatalogueResponse {
	return CatalogueResponse{Modules: tenant.KnownModules, Languages: tenant.KnownLanguages}
}

// noReasonGiven is what lands in the audit log when an edit is saved without
// a stated justification.
//
// The column is NOT NULL and the log is append-only, so "no reason" still has
// to be recorded as something — and recording it explicitly is better than an
// empty string, which reads like a bug rather than a choice.
const noReasonGiven = "(none given)"

// optionalReason is validateReason's counterpart for the BRANDING and PROFILE
// edits, where a justification is not required.
//
// The distinction is deliberate: creating, suspending, reactivating or
// re-tiering a business changes what it may DO, and those keep a mandatory
// reason. Editing its address or its brand colour does not, so demanding a
// typed justification for every colour tweak only trains operators to type
// "update" — which is worse for the audit trail than an honest "(none given)".
// The row is still written either way; only the requirement changes.
func optionalReason(reason string) string {
	if strings.TrimSpace(reason) == "" {
		return noReasonGiven
	}
	return reason
}
