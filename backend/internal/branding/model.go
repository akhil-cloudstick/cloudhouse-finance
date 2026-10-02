// Package branding serves a business's visual and legal identity — its name,
// logo, primary colour, registered address — plus which optional modules and
// document languages it has been granted.
//
// # Why this is its own package
//
// internal/tenant deliberately exposes NO HTTP routes: its package doc
// explains that tenant administration reachable by an ordinary employee would
// put the most powerful operations in the system behind the wrong gate. That
// reasoning applies to WRITES, which stay in internal/superadmin. But the
// tenant app still has to READ its own branding, and the login page has to
// read it before anyone has authenticated at all. Those two reads get their
// own package rather than weakening tenant's rule.
//
// # The public endpoints are public on purpose
//
// A login page must render a business's logo and colour before there is a
// session to authorize. So /public/branding/:code answers unauthenticated.
// Two consequences were designed for rather than discovered:
//
//   - An unknown code returns the PLATFORM DEFAULT, never a 404. auth.Service
//     already answers a wrong business code and a wrong password identically
//     so businesses cannot be enumerated; a 404 here would hand that back.
//   - The logo is resolved from the tenant row's own LogoStorageKey, never
//     from a key in the URL. This route therefore cannot be pointed at
//     another business's customer KYC scans, which is exactly why
//     upload/serve.go refuses to serve anything without an auth cookie.
package branding

import "cloudhouse/backend/internal/tenant"

// Platform defaults, used when a business has not set its own. These mirror
// frontend/common/config/brand.ts — the frontend has the same fallbacks for
// the case where it cannot reach this endpoint at all, and the two should say
// the same thing.
const (
	DefaultName       = "CloudHouse Finance"
	DefaultLegalName  = "CloudHouse Finance"
	DefaultBrandColor = "#6054bf"
	// DefaultFontFamily/DefaultFontScale/DefaultLogoScale/DefaultLogoDisplay
	// mirror the frontend's own fallbacks in theme.ts — see that file's
	// header for why the two must agree.
	DefaultFontFamily  = "inter"
	DefaultFontScale   = "default"
	DefaultLogoScale   = "default"
	DefaultLogoDisplay = "transparent"
)

// Public is what an unauthenticated caller may learn about a business from
// its sign-in code. An explicit whitelist, not a filtered Tenant: status,
// tier, subscription state and billing identifiers must never appear here,
// and a struct that lists what IS exposed cannot leak a field added later.
type Public struct {
	Name      string `json:"name"`
	LegalName string `json:"legalName"`
	// ShortName is empty ONLY as a signal to the caller that it has not
	// been set — see publicOf's fallback (unlike LegalName/font/logo below,
	// this one falls back to the business's own Name, not a platform
	// constant, since "CloudHouse Finance" would be a strange short name to
	// show for a business that has not picked one).
	ShortName string `json:"shortName"`
	// LockupTagline is the sidebar's small second line. Unlike ShortName it
	// has NO fallback here: empty means "not set", which the frontend reads as
	// "use the business name, unless that would just repeat the headline".
	// Resolving it server-side would lose that distinction.
	LockupTagline string `json:"lockupTagline"`
	BrandColor    string `json:"brandColor"`
	// SecondaryColor/AccentColor/SidebarColor are empty when the business
	// has not set them, which the frontend reads as "derive from BrandColor
	// alone" — see theme.ts.
	SecondaryColor string `json:"secondaryColor"`
	AccentColor    string `json:"accentColor"`
	SidebarColor   string `json:"sidebarColor"`
	FontFamily     string `json:"fontFamily"`
	FontScale      string `json:"fontScale"`
	LogoScale      string `json:"logoScale"`
	LogoDisplay    string `json:"logoDisplay"`
	// LogoURL is empty when the business has no logo of its own, which the
	// frontend reads as "use the platform mark".
	LogoURL string `json:"logoUrl"`
	AppURL  string `json:"appUrl"`
}

// Self is what a signed-in employee's app needs: everything in Public, plus
// the document details that go on printed paperwork and the two grants that
// decide what the app renders at all.
type Self struct {
	Public
	AddressLine string   `json:"addressLine"`
	KMLRegNo    string   `json:"kmlRegNo"`
	Modules     []string `json:"modules"`
	Languages   []string `json:"languages"`
	// SingleBranch tells the app to lock every branch picker to the one
	// default branch and hide the branch switcher.
	SingleBranch bool `json:"singleBranch"`
}

// publicOf projects a tenant, applying the platform fallbacks. logoURL is
// passed in rather than derived here because only the handler knows the code
// the caller reached us by.
func publicOf(t *tenant.Tenant, logoURL string) Public {
	p := Public{
		Name:           t.Name,
		LegalName:      t.LegalName,
		ShortName:      t.ShortName,
		LockupTagline:  t.LockupTagline,
		BrandColor:     t.BrandColor,
		SecondaryColor: t.SecondaryColor,
		AccentColor:    t.AccentColor,
		SidebarColor:   t.SidebarColor,
		FontFamily:     t.FontFamily,
		FontScale:      t.FontScale,
		LogoScale:      t.LogoScale,
		LogoDisplay:    t.LogoDisplay,
		LogoURL:        logoURL,
		AppURL:         t.AppURL,
	}
	if p.Name == "" {
		p.Name = DefaultName
	}
	// Falls back to the business's own display name before the platform's:
	// a business that filled in one field and not the other is far better
	// served by its own name than by ours appearing on its paperwork.
	if p.LegalName == "" {
		p.LegalName = p.Name
	}
	if p.ShortName == "" {
		p.ShortName = p.Name
	}
	if p.BrandColor == "" {
		p.BrandColor = DefaultBrandColor
	}
	// SecondaryColor/AccentColor/SidebarColor deliberately do NOT fall back
	// to a default here — empty means "not set", read by the frontend as
	// "derive/auto", not "use the platform's".
	if p.FontFamily == "" {
		p.FontFamily = DefaultFontFamily
	}
	if p.FontScale == "" {
		p.FontScale = DefaultFontScale
	}
	if p.LogoScale == "" {
		p.LogoScale = DefaultLogoScale
	}
	if p.LogoDisplay == "" {
		p.LogoDisplay = DefaultLogoDisplay
	}
	return p
}

// defaultPublic is the answer for a code that matches no business. See the
// package doc: indistinguishable from a real business with no branding set.
func defaultPublic() Public {
	return Public{
		Name: DefaultName, LegalName: DefaultLegalName, ShortName: DefaultName, BrandColor: DefaultBrandColor,
		FontFamily: DefaultFontFamily, FontScale: DefaultFontScale,
		LogoScale: DefaultLogoScale, LogoDisplay: DefaultLogoDisplay,
	}
}
