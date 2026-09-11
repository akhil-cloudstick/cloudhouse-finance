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
)

// Public is what an unauthenticated caller may learn about a business from
// its sign-in code. An explicit whitelist, not a filtered Tenant: status,
// tier, subscription state and billing identifiers must never appear here,
// and a struct that lists what IS exposed cannot leak a field added later.
type Public struct {
	Name       string `json:"name"`
	LegalName  string `json:"legalName"`
	BrandColor string `json:"brandColor"`
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
}

// publicOf projects a tenant, applying the platform fallbacks. logoURL is
// passed in rather than derived here because only the handler knows the code
// the caller reached us by.
func publicOf(t *tenant.Tenant, logoURL string) Public {
	p := Public{
		Name:       t.Name,
		LegalName:  t.LegalName,
		BrandColor: t.BrandColor,
		LogoURL:    logoURL,
		AppURL:     t.AppURL,
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
	if p.BrandColor == "" {
		p.BrandColor = DefaultBrandColor
	}
	return p
}

// defaultPublic is the answer for a code that matches no business. See the
// package doc: indistinguishable from a real business with no branding set.
func defaultPublic() Public {
	return Public{Name: DefaultName, LegalName: DefaultLegalName, BrandColor: DefaultBrandColor}
}
