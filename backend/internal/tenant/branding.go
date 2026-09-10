package tenant

import (
	"sort"
	"strings"

	"gorm.io/gorm"
)

// This file owns the two closed sets a Tenant's profile can hold — optional
// modules and document languages — and the only code that is allowed to read
// or write the comma-separated columns backing them.
//
// Why CSV columns rather than JSON or a child table: both sets are small,
// closed, and validated in Go on every write, so the value of a join table
// (referential integrity over an open set) does not apply, while its cost
// (another table in tenantScopedTables, another thing to migrate) does. This
// matches how Status and superadmin.Action* are already modelled here —
// a fixed vocabulary of short strings, enumerable in one place.

// Optional modules. A module in this set is HIDDEN until the vendor enables
// it for a business; see Tenant.EnabledModules for why empty means none.
//
// These gate a *management page*, never the underlying data. Disabling
// ModuleBranches hides Branch Management and refuses branch writes — it does
// not stop branches existing, being listed in a dropdown, or being switched
// between, all of which the rest of the app depends on.
const (
	ModuleSettings = "settings"
	ModuleBranches = "branches"
)

// KnownModules is the closed set. Adding an entry here is the only way a new
// module becomes toggleable, so this slice is the answer to "what can the
// vendor turn on?" — there is no second list to keep in step.
var KnownModules = []string{ModuleSettings, ModuleBranches}

// Document languages for customer-facing paperwork (the pledge agreement and
// release form).
const (
	LangEnglish   = "en"
	LangMalayalam = "ml"
	LangGujarati  = "gu"
)

// KnownLanguages is the closed set. English leads it and is never removable —
// see HasLanguage.
var KnownLanguages = []string{LangEnglish, LangMalayalam, LangGujarati}

// HasModule reports whether an optional module is enabled for this business.
//
// Reads the stored column rather than the derived Modules slice, so it is
// correct on a Tenant built by hand or mid-write, not only on one that has
// been through AfterFind.
func (t *Tenant) HasModule(key string) bool {
	return containsCSV(t.EnabledModules, key)
}

// HasLanguage reports whether a document may be issued in this language.
//
// English is always true regardless of what is stored: it is the fallback
// every template has, and a business with no issuable language at all would
// be unable to hand a borrower their own agreement.
func (t *Tenant) HasLanguage(code string) bool {
	if code == LangEnglish {
		return true
	}
	return containsCSV(t.DocumentLanguages, code)
}

// ModuleList returns the enabled modules, in KnownModules order.
func (t *Tenant) ModuleList() []string { return filterKnown(t.EnabledModules, KnownModules) }

// LanguageList returns the issuable languages, in KnownLanguages order and
// always including English.
func (t *Tenant) LanguageList() []string {
	out := filterKnown(t.DocumentLanguages, KnownLanguages)
	for _, c := range out {
		if c == LangEnglish {
			return out
		}
	}
	return append([]string{LangEnglish}, out...)
}

// SetModules replaces the enabled modules, silently dropping anything outside
// KnownModules. Callers that need to REJECT an unknown key (the superadmin
// handlers do, so a typo is a 400 rather than a silent no-op) must validate
// with ValidateModules first.
func (t *Tenant) SetModules(keys []string) {
	t.EnabledModules = strings.Join(filterKnown(strings.Join(keys, ","), KnownModules), ",")
	t.syncDerived()
}

// SetLanguages replaces the issuable languages. English is always stored,
// whether or not the caller included it, so the column can never describe a
// business that cannot print its own paperwork.
func (t *Tenant) SetLanguages(codes []string) {
	t.DocumentLanguages = strings.Join(
		filterKnown(strings.Join(append(codes, LangEnglish), ","), KnownLanguages), ",")
	t.syncDerived()
}

// ValidateModules returns the unrecognised entries in keys, if any.
func ValidateModules(keys []string) []string { return unknownOf(keys, KnownModules) }

// ValidateLanguages returns the unrecognised entries in codes, if any.
func ValidateLanguages(codes []string) []string { return unknownOf(codes, KnownLanguages) }

// AfterFind fills the JSON-facing Modules/Languages slices from the stored
// columns on every read, so no handler has to remember to do it and none can
// forget. GORM calls this for First/Find/Preload alike.
func (t *Tenant) AfterFind(*gorm.DB) error {
	t.syncDerived()
	return nil
}

// LogoPath builds the public URL a business's logo is served from. Keyed by
// the business CODE, never by the storage key, so the bytes are always
// re-resolved from this row rather than from a value that travelled through
// a client. The storage key rides along only as a cache-buster: replacing a
// logo changes it, so a browser holding the old image fetches the new one.
//
// Must stay in step with internal/branding's route registration.
func (t *Tenant) LogoPath() string {
	if t.LogoStorageKey == "" || t.Code == "" {
		return ""
	}
	return "/api/v1/public/branding/" + t.Code + "/logo?v=" + t.LogoStorageKey
}

func (t *Tenant) syncDerived() {
	t.LogoURL = t.LogoPath()
	t.Modules = t.ModuleList()
	t.Languages = t.LanguageList()
}

// --- CSV helpers ------------------------------------------------------------
//
// Deliberately unexported: the stored format is this file's business, and a
// caller reaching for it directly is the bug these helpers exist to prevent.

func splitCSV(s string) []string {
	out := make([]string, 0, 4)
	for _, part := range strings.Split(s, ",") {
		if p := strings.ToLower(strings.TrimSpace(part)); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func containsCSV(s, want string) bool {
	for _, v := range splitCSV(s) {
		if v == want {
			return true
		}
	}
	return false
}

// filterKnown intersects a CSV value with a closed set, de-duplicating and
// returning the result in the closed set's own order — so the stored string is
// canonical regardless of the order a caller happened to send.
func filterKnown(s string, known []string) []string {
	present := map[string]bool{}
	for _, v := range splitCSV(s) {
		present[v] = true
	}
	out := make([]string, 0, len(known))
	for _, k := range known {
		if present[k] {
			out = append(out, k)
		}
	}
	return out
}

// unknownOf returns the entries of got that are not in known, sorted so an
// error message reads the same way every time.
func unknownOf(got, known []string) []string {
	valid := map[string]bool{}
	for _, k := range known {
		valid[k] = true
	}
	seen := map[string]bool{}
	var bad []string
	for _, g := range got {
		v := strings.ToLower(strings.TrimSpace(g))
		if v == "" || valid[v] || seen[v] {
			continue
		}
		seen[v] = true
		bad = append(bad, v)
	}
	sort.Strings(bad)
	return bad
}
