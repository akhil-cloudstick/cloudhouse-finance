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
// ModuleDemoReset is the exception to the "gates a page, never the data"
// rule above, and the exception is the whole point of it. Every other module
// hides a management screen while the records carry on existing; this one
// governs an action that DELETES the business down to its admin login.
//
// It is off unless the vendor turns it on, which is the correct default for
// a demo tenancy that has become a real client: the reset is a sales tool
// for rehearsing a pitch, and there is no version of a live client wanting
// it. Granting it says "this business is still a demo".
const (
	ModuleSettings  = "settings"
	ModuleBranches  = "branches"
	ModuleDemoReset = "demo_reset"

	// ModulePersonalLoans/ModuleInvestments gate the Personal Loans and
	// Investments product lines end to end — the nav page, the reports
	// list, and (see internal/app/app.go's route registration) the API
	// routes themselves, not just what the frontend chooses to draw. Off by
	// default, same as every other optional module: a business that has
	// not been sold Personal Loans or Investments should not see either
	// exist, not just have the button greyed out.
	ModulePersonalLoans = "personal_loans"
	ModuleInvestments   = "investments"
)

// KnownModules is the closed set. Adding an entry here is the only way a new
// module becomes toggleable, so this slice is the answer to "what can the
// vendor turn on?" — there is no second list to keep in step.
var KnownModules = []string{ModuleSettings, ModuleBranches, ModuleDemoReset, ModulePersonalLoans, ModuleInvestments}

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

// Document policies — the regulatory regime a business lends under, which
// decides WHICH FAMILY of customer-facing paperwork it issues. This is a
// different axis from language: KML and GML are not translations of one
// document, they are different documents (see backend/templates — the
// kml-* files are a promissory-pledge letter, the gml-* files a movable
// property pledge deed). A business signs borrowers onto one family only.
const (
	PolicyKML = "kml"
	PolicyGML = "gml"
)

// KnownPolicies is the closed set, same contract as KnownModules: adding an
// entry here (plus the template files it names) is the only way a new policy
// becomes selectable.
var KnownPolicies = []string{PolicyKML, PolicyGML}

// PolicyLanguages says which document languages each policy actually has
// templates for. This is what narrows the language checkboxes in the console
// — policy is chosen first, and only the languages under it are offered, so a
// business can never be entitled to a document that does not exist.
//
// English is in every entry and must stay that way: HasLanguage guarantees
// English unconditionally, so a policy without an English template would
// describe a business that cannot print its own paperwork.
var PolicyLanguages = map[string][]string{
	PolicyKML: {LangEnglish, LangMalayalam},
	PolicyGML: {LangEnglish, LangGujarati},
}

// PolicyOrDefault normalises a stored policy value. Empty means KML: every
// tenant row predating this column was issuing the kml-* documents, so that
// is what "unset" has always meant in practice.
func PolicyOrDefault(policy string) string {
	p := strings.ToLower(strings.TrimSpace(policy))
	if ValidatePolicy(p) {
		return p
	}
	return PolicyKML
}

// ValidatePolicy reports whether policy is one of KnownPolicies. Unlike
// ValidateModules/ValidateLanguages (which return the unrecognised entries of
// a set) this takes a single value, because a business has exactly one.
func ValidatePolicy(policy string) bool {
	for _, p := range KnownPolicies {
		if p == policy {
			return true
		}
	}
	return false
}

// LanguagesForPolicy returns the languages issuable under policy, in
// KnownLanguages order, always including English. An unrecognised policy is
// read as the default rather than returning nothing, so a bad stored value
// degrades to KML paperwork rather than to a business that can print none.
func LanguagesForPolicy(policy string) []string {
	langs, ok := PolicyLanguages[PolicyOrDefault(policy)]
	if !ok {
		langs = []string{LangEnglish}
	}
	out := make([]string, len(langs))
	copy(out, langs)
	return out
}

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
// A language the business's POLICY has no template for is refused even when
// the stored column names it — see LanguageList for why a stored column can
// say that. English stays unconditional: every policy has an English
// template, and that is a rule PolicyLanguages documents and must keep.
func (t *Tenant) HasLanguage(code string) bool {
	if code == LangEnglish {
		return true
	}
	if !containsCSV(t.DocumentLanguages, code) {
		return false
	}
	for _, l := range LanguagesForPolicy(t.Policy) {
		if l == code {
			return true
		}
	}
	return false
}

// PolicyOrDefault is the single read path for the Policy column, the way
// HasModule/HasLanguage are for the other two. Never read t.Policy directly:
// empty means KML, and every call site forgetting that is a business issuing
// the wrong family of paperwork.
func (t *Tenant) PolicyOrDefault() string { return PolicyOrDefault(t.Policy) }

// ModuleList returns the enabled modules, in KnownModules order.
func (t *Tenant) ModuleList() []string { return filterKnown(t.EnabledModules, KnownModules) }

// LanguageList returns the issuable languages, in KnownLanguages order and
// always including English.
//
// Filtered by the business's POLICY as well as by KnownLanguages: a stored
// column that predates the policy column, or one written before the policy
// was changed, can name a language this business's document family has no
// template for. Filtering on read (not only on write) means such a row can
// never hand a caller a language that would fall back to another policy's
// paperwork.
func (t *Tenant) LanguageList() []string {
	out := filterKnown(t.DocumentLanguages, LanguagesForPolicy(t.Policy))
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
//
// Filtered by the business's policy as well, so the column can never describe
// a business entitled to a language its document family has no template for.
// Set the policy FIRST (SetPolicy re-filters what is already stored, so the
// order only matters within one write).
func (t *Tenant) SetLanguages(codes []string) {
	t.DocumentLanguages = strings.Join(
		filterKnown(strings.Join(append(codes, LangEnglish), ","), LanguagesForPolicy(t.Policy)), ",")
	t.syncDerived()
}

// SetPolicy switches the document family and re-filters the stored languages
// through the new one, dropping any that the new family has no template for.
// Doing it here rather than leaving it to callers is what stops a business
// switched from KML to GML keeping a Malayalam entitlement it can no longer
// print.
func (t *Tenant) SetPolicy(policy string) {
	t.Policy = PolicyOrDefault(policy)
	t.SetLanguages(t.LanguageList())
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
