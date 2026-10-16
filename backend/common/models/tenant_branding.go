package models

import (
	"strings"

	"gorm.io/gorm"
)

const (
	ModuleSettings      = "settings"
	ModuleBranches      = "branches"
	ModulePersonalLoans = "personal_loans"
	ModuleInvestments   = "investments"
	ModuleWhatsApp      = "whatsapp"
)

var KnownModules = []string{ModuleSettings, ModuleBranches, "demo_reset", ModulePersonalLoans, ModuleInvestments, ModuleWhatsApp}

const (
	LangEnglish = "en"
)

const (
	PolicyKML = "kml"
	PolicyGML = "gml"
	PolicyTML = "tml"
)

var KnownPolicies = []string{PolicyKML, PolicyGML, PolicyTML}

var PolicyLabels = map[string]string{
	PolicyKML: "KML — Kerala Money Lenders",
	PolicyGML: "GML — Gujarat Money Lenders",
	PolicyTML: "TML — Tamil Nadu Money Lenders",
}

var PolicyLanguages = map[string][]string{
	PolicyKML: {LangEnglish, "ml"},
	PolicyGML: {LangEnglish, "gu"},
	PolicyTML: {LangEnglish, "ta"},
}

func PolicyOrDefault(policy string) string {
	p := strings.ToLower(strings.TrimSpace(policy))
	if ValidatePolicy(p) {
		return p
	}
	return PolicyKML
}

func ValidatePolicy(policy string) bool {
	for _, p := range KnownPolicies {
		if p == policy {
			return true
		}
	}
	return false
}

func LanguagesForPolicy(policy string) []string {
	langs, ok := PolicyLanguages[PolicyOrDefault(policy)]
	if !ok {
		langs = []string{LangEnglish}
	}
	out := make([]string, len(langs))
	copy(out, langs)
	return out
}

func TenantModuleList(t *Tenant) []string { return FilterKnown(t.EnabledModules, KnownModules) }

func TenantLanguageList(t *Tenant) []string {
	out := FilterKnown(t.DocumentLanguages, LanguagesForPolicy(t.Policy))
	for _, c := range out {
		if c == LangEnglish {
			return out
		}
	}
	return append([]string{LangEnglish}, out...)
}

func (t *Tenant) AfterFind(*gorm.DB) error {
	SyncTenant(t)
	return nil
}

func TenantLogoPath(t *Tenant) string {
	if t.LogoStorageKey == "" || t.Code == "" {
		return ""
	}
	return "/api/v1/public/branding/" + t.Code + "/logo?v=" + t.LogoStorageKey
}

func SyncTenant(t *Tenant) {
	t.LogoURL = TenantLogoPath(t)
	t.HasSignature = t.SignatureStorageKey != ""
	t.Modules = TenantModuleList(t)
	t.Languages = TenantLanguageList(t)
}

func splitCSV(s string) []string {
	out := make([]string, 0, 4)
	for _, part := range strings.Split(s, ",") {
		if p := strings.ToLower(strings.TrimSpace(part)); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func ContainsCSV(s, want string) bool {
	for _, v := range splitCSV(s) {
		if v == want {
			return true
		}
	}
	return false
}

func FilterKnown(s string, known []string) []string {
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
