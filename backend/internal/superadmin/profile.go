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
	// ShortName is the compact identity for tight spots — sidebar headline,
	// browser tab, the login page's "Staff access to X" line — e.g. "CTFI"
	// for "Chittilapilly Thommana Financiers & Investments". Empty falls
	// back to Name, same convention as LegalName.
	ShortName string
	// LockupTagline is the sidebar's small second line under the headline —
	// "Chittilapilly Thommana" under "CTFI", or "Gold Finance" under
	// "CloudHouse". Free text, because which of those two a business wants is
	// not derivable from its name. Empty is left empty (see tenant.Tenant).
	LockupTagline string
	AddressLine   string
	KMLRegNo      string
	AppURL        string
	// Policy is the document family, one of tenant.KnownPolicies. Empty is
	// read as the KML default rather than rejected, so a console that has not
	// been updated, or a caller that omits the field, leaves a business on
	// the paperwork it was already issuing.
	Policy string
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
	t.ShortName = strings.TrimSpace(in.ShortName)
	t.LockupTagline = strings.TrimSpace(in.LockupTagline)
	t.AddressLine = strings.TrimSpace(in.AddressLine)
	t.KMLRegNo = strings.TrimSpace(in.KMLRegNo)
	t.AppURL = strings.TrimSpace(in.AppURL)
	// SetPolicy, not a bare assignment: switching family re-filters the
	// stored languages through the new one, so a business moved from KML to
	// GML cannot keep a Malayalam entitlement it has no template for.
	beforePolicy := t.PolicyOrDefault()
	beforeLanguages := t.DocumentLanguages
	t.SetPolicy(in.Policy)
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	detail := fmt.Sprintf("legalName=%q kmlRegNo=%q appUrl=%q policy=%q", t.LegalName, t.KMLRegNo, t.AppURL, t.Policy)
	if beforePolicy != t.Policy {
		detail += fmt.Sprintf("; policy: %s -> %s (languages: %s -> %s)",
			beforePolicy, t.Policy, beforeLanguages, t.DocumentLanguages)
	}
	if beforeName != t.Name {
		detail = fmt.Sprintf("name: %s -> %s; ", beforeName, t.Name) + detail
	}
	s.audit(ctx, actor, ActionUpdateProfile, &t.ID, t.Name, detail, reason)
	return t, nil
}

// knownFontFamilies/knownFontScales/knownLogoScales/knownLogoDisplays are the
// closed sets the console may choose from — same reasoning as
// tenant.KnownModules: a fixed vocabulary the frontend has assets/CSS for,
// enumerable in one place, so a typo becomes a 400 rather than a silently
// unstyled page or (for FontFamily, if it were ever free text) a way to make
// this origin fetch an arbitrary remote font.
var (
	knownFontFamilies = []string{"inter", "system", "lora", "poppins"}
	knownFontScales   = []string{"compact", "default", "comfortable"}
	knownLogoScales   = []string{"small", "default", "large", "xlarge"}
	knownLogoDisplays = []string{"transparent", "light-pad", "dark-pad"}
)

func oneOf(value string, allowed []string) bool {
	if value == "" {
		return true // empty means "use the default" everywhere below
	}
	for _, a := range allowed {
		if value == a {
			return true
		}
	}
	return false
}

// ThemeInput carries every branding lever the console's theme panel edits in
// one request: the primary colour plus the optional second/third, typography,
// and how the logo sits in its slot. Grouped into one call (rather than one
// endpoint per field, as SetModules/SetLanguages are) because these are
// edited together as "the theme" and one audit row per save reads far better
// than five.
type ThemeInput struct {
	BrandColor     string
	SecondaryColor string
	AccentColor    string
	// SidebarColor is a DIRECTLY-SET colour for the sidebar/login-panel dark
	// ground, not derived from BrandColor — see tenant.Tenant.SidebarColor's
	// doc comment for why an auto-derived value was not good enough.
	SidebarColor string
	FontFamily   string
	FontScale    string
	LogoScale    string
	LogoDisplay  string
}

// SetTheme sets the business's whole visual theme: the colour(s) its palette
// is derived from, its typography, and how its logo is framed.
//
// There is deliberately no way to set a colour ramp's individual steps —
// frontend/common/config/theme.ts derives deep/mid/light/pale/faint from each
// picked colour independently, so the derived shades always keep the same
// tonal relationship, whatever hue is chosen. SecondaryColor/AccentColor are
// optional: most businesses set only BrandColor, and leaving the other two
// empty means "do not derive a second/third ramp" rather than "use a
// default" — see branding.publicOf.
//
// An empty value in any field clears it back to the platform default (or, for
// Secondary/AccentColor, to "unset") rather than being rejected — "undo my
// choice" has to stay expressible field by field.
func (s *Service) SetTheme(ctx context.Context, actor *SuperAdminUser, id uint, in ThemeInput, reason string) (*tenant.Tenant, error) {
	reason = optionalReason(reason)
	primary := strings.TrimSpace(strings.ToLower(in.BrandColor))
	secondary := strings.TrimSpace(strings.ToLower(in.SecondaryColor))
	accent := strings.TrimSpace(strings.ToLower(in.AccentColor))
	sidebar := strings.TrimSpace(strings.ToLower(in.SidebarColor))
	for _, c := range []string{primary, secondary, accent, sidebar} {
		if c != "" && !brandColorPattern.MatchString(c) {
			return nil, ErrInvalidBrandColor
		}
	}
	fontFamily := strings.TrimSpace(strings.ToLower(in.FontFamily))
	fontScale := strings.TrimSpace(strings.ToLower(in.FontScale))
	logoScale := strings.TrimSpace(strings.ToLower(in.LogoScale))
	logoDisplay := strings.TrimSpace(strings.ToLower(in.LogoDisplay))
	if !oneOf(fontFamily, knownFontFamilies) {
		return nil, httpx.NewBadRequest("unknown font family")
	}
	if !oneOf(fontScale, knownFontScales) {
		return nil, httpx.NewBadRequest("unknown font scale")
	}
	if !oneOf(logoScale, knownLogoScales) {
		return nil, httpx.NewBadRequest("unknown logo scale")
	}
	if !oneOf(logoDisplay, knownLogoDisplays) {
		return nil, httpx.NewBadRequest("unknown logo display")
	}

	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	before := fmt.Sprintf("brand=%s secondary=%s accent=%s sidebar=%s font=%s/%s logo=%s/%s",
		orDefault(t.BrandColor), orDefault(t.SecondaryColor), orDefault(t.AccentColor), orDefault(t.SidebarColor),
		orDefault(t.FontFamily), orDefault(t.FontScale), orDefault(t.LogoScale), orDefault(t.LogoDisplay))
	t.BrandColor = primary
	t.SecondaryColor = secondary
	t.AccentColor = accent
	t.SidebarColor = sidebar
	t.FontFamily = fontFamily
	t.FontScale = fontScale
	t.LogoScale = logoScale
	t.LogoDisplay = logoDisplay
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	after := fmt.Sprintf("brand=%s secondary=%s accent=%s sidebar=%s font=%s/%s logo=%s/%s",
		orDefault(t.BrandColor), orDefault(t.SecondaryColor), orDefault(t.AccentColor), orDefault(t.SidebarColor),
		orDefault(t.FontFamily), orDefault(t.FontScale), orDefault(t.LogoScale), orDefault(t.LogoDisplay))
	s.audit(ctx, actor, ActionSetBranding, &t.ID, t.Name,
		fmt.Sprintf("theme: %s -> %s", before, after), reason)
	return t, nil
}

func orDefault(s string) string {
	if s == "" {
		return "default"
	}
	return s
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

// outsidePolicy returns the entries of languages that policy has no document
// template for. Separate from tenant.ValidateLanguages, which answers "is
// this a language the app knows at all?" — this answers the narrower "is it
// one THIS business can actually print?", and both checks apply.
func outsidePolicy(policy string, languages []string) []string {
	allowed := tenant.LanguagesForPolicy(policy)
	var bad []string
	for _, code := range languages {
		ok := false
		for _, a := range allowed {
			if a == code {
				ok = true
				break
			}
		}
		if !ok {
			bad = append(bad, code)
		}
	}
	return bad
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
	// Rejected, not silently dropped: a language outside this business's
	// document policy has no template to render, and returning 400 tells the
	// operator that rather than saving a request that looks like it worked.
	if bad := outsidePolicy(t.PolicyOrDefault(), languages); len(bad) > 0 {
		return nil, httpx.NewBadRequest(fmt.Sprintf(
			"language(s) not available under the %s policy: %s",
			strings.ToUpper(t.PolicyOrDefault()), strings.Join(bad, ", ")))
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

// PolicyOption is one selectable document policy, with the languages that
// policy actually has templates for. The console narrows its language
// checkboxes to Languages once a policy is picked, so the mapping lives here
// (from tenant.PolicyLanguages) rather than being duplicated in TypeScript
// where it could drift out of step with what the renderer can produce.
type PolicyOption struct {
	Code      string   `json:"code"`
	Label     string   `json:"label"`
	Languages []string `json:"languages"`
}

// policyLabels are the console-facing names for tenant.KnownPolicies. Kept
// here rather than in the tenant package because they are presentation, not
// domain — the stored value is the code.
var policyLabels = map[string]string{
	tenant.PolicyKML: "KML — Kerala Money Lenders",
	tenant.PolicyGML: "GML — Gujarat Money Lenders",
}

// CatalogueResponse is the closed sets the console renders checkboxes from.
type CatalogueResponse struct {
	Modules   []string       `json:"modules"`
	Languages []string       `json:"languages"`
	Policies  []PolicyOption `json:"policies"`
}

// Catalogue returns what the vendor can toggle. Served from
// tenant.KnownModules/KnownLanguages/KnownPolicies so the console cannot
// offer a key the backend would then reject, and adding a module stays a
// one-line change in one file.
func (s *Service) Catalogue() CatalogueResponse {
	policies := make([]PolicyOption, 0, len(tenant.KnownPolicies))
	for _, code := range tenant.KnownPolicies {
		label, ok := policyLabels[code]
		if !ok {
			label = strings.ToUpper(code)
		}
		policies = append(policies, PolicyOption{
			Code:      code,
			Label:     label,
			Languages: tenant.LanguagesForPolicy(code),
		})
	}
	return CatalogueResponse{
		Modules:   tenant.KnownModules,
		Languages: tenant.KnownLanguages,
		Policies:  policies,
	}
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
