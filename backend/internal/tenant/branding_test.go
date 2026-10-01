package tenant

import (
	"reflect"
	"testing"
)

// These helpers decide whether a business can reach an optional module and
// which languages it may issue binding customer documents in, so the cases
// that matter most here are the ones where a WRONG answer grants something:
// an empty column must never mean "everything", and an unknown key must
// never slip through as enabled.

func TestHasModule(t *testing.T) {
	cases := []struct {
		name    string
		stored  string
		key     string
		want    bool
		because string
	}{
		{"empty grants nothing", "", ModuleSettings, false,
			"empty is the default for every existing business; if it meant 'all', the migration would silently switch every optional module on"},
		{"single match", "settings", ModuleSettings, true, ""},
		{"single non-match", "settings", ModuleBranches, false, ""},
		{"both enabled", "settings,branches", ModuleBranches, true, ""},
		{"whitespace tolerated", " settings , branches ", ModuleBranches, true,
			"a hand-edited column must not silently disable a module"},
		{"case-insensitive", "SETTINGS", ModuleSettings, true, ""},
		{"prefix is not a match", "settingsx", ModuleSettings, false,
			"substring matching would grant a module the vendor never ticked"},
		{"unknown key never matches", "settings,branches", "billing", false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tn := &Tenant{EnabledModules: tc.stored}
			if got := tn.HasModule(tc.key); got != tc.want {
				t.Errorf("HasModule(%q) with %q = %v, want %v. %s", tc.key, tc.stored, got, tc.want, tc.because)
			}
		})
	}
}

func TestHasLanguageAlwaysAllowsEnglish(t *testing.T) {
	// English is the fallback every template has. A business that could not
	// print its own pledge agreement in any language would be unable to hand
	// a borrower their own paperwork, so no stored value may produce that.
	for _, stored := range []string{"", "ml", "gu", "ml,gu"} {
		tn := &Tenant{DocumentLanguages: stored}
		if !tn.HasLanguage(LangEnglish) {
			t.Errorf("HasLanguage(en) = false with DocumentLanguages=%q; English must never be revocable", stored)
		}
	}
}

func TestHasLanguage(t *testing.T) {
	tn := &Tenant{DocumentLanguages: "ml"}
	if !tn.HasLanguage(LangMalayalam) {
		t.Error("granted language reported as not granted")
	}
	if tn.HasLanguage(LangGujarati) {
		t.Error("ungranted language reported as granted — this gates a binding contract's language")
	}
	empty := &Tenant{}
	if empty.HasLanguage(LangMalayalam) {
		t.Error("empty DocumentLanguages granted Malayalam; empty must mean English only")
	}
}

func TestSetModulesCanonicalisesAndDropsUnknown(t *testing.T) {
	tn := &Tenant{}
	// Reverse order, a duplicate, and a key outside the closed set.
	tn.SetModules([]string{"branches", "settings", "branches", "nonsense"})

	// Stored in KnownModules order regardless of input order, so the column
	// has one canonical form rather than one per caller.
	if tn.EnabledModules != "settings,branches" {
		t.Errorf("EnabledModules = %q, want %q", tn.EnabledModules, "settings,branches")
	}
	if tn.HasModule("nonsense") {
		t.Error("an unknown key survived SetModules")
	}
	if !reflect.DeepEqual(tn.Modules, []string{ModuleSettings, ModuleBranches}) {
		t.Errorf("derived Modules = %v, want [settings branches]", tn.Modules)
	}
}

func TestEffectiveModuleListHidesBranchesForSingleBranch(t *testing.T) {
	multi := &Tenant{EnabledModules: "settings,branches"}
	if !reflect.DeepEqual(multi.EffectiveModuleList(), []string{ModuleSettings, ModuleBranches}) {
		t.Errorf("multi-branch EffectiveModuleList = %v; must match the stored grants", multi.EffectiveModuleList())
	}

	single := &Tenant{EnabledModules: "settings,branches", SingleBranch: true}
	if !reflect.DeepEqual(single.EffectiveModuleList(), []string{ModuleSettings}) {
		t.Errorf("single-branch EffectiveModuleList = %v, want [settings]", single.EffectiveModuleList())
	}
	// The stored grant is untouched, so flipping back to multi-branch
	// restores Branch Management without the vendor re-ticking it.
	if !single.HasModule(ModuleBranches) {
		t.Error("SingleBranch must not rewrite the stored module column")
	}
}

func TestSetLanguagesAlwaysStoresEnglish(t *testing.T) {
	tn := &Tenant{}
	tn.SetLanguages([]string{"ml"}) // caller omitted English entirely
	if !containsCSV(tn.DocumentLanguages, LangEnglish) {
		t.Errorf("DocumentLanguages = %q; English must be stored even when the caller omits it", tn.DocumentLanguages)
	}

	// Clearing everything still leaves English issuable.
	tn.SetLanguages(nil)
	if !tn.HasLanguage(LangEnglish) {
		t.Error("clearing all languages left English unissuable")
	}
	if tn.HasLanguage(LangMalayalam) {
		t.Error("clearing all languages left Malayalam granted")
	}
}

func TestLanguageListIncludesEnglishWhenColumnDoesNot(t *testing.T) {
	// A row written before English was force-stored (or edited by hand)
	// must still report English as issuable.
	tn := &Tenant{DocumentLanguages: "ml"}
	got := tn.LanguageList()
	want := []string{LangEnglish, LangMalayalam}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("LanguageList() = %v, want %v", got, want)
	}
}

func TestValidateRejectsUnknownAndAcceptsKnown(t *testing.T) {
	if bad := ValidateModules([]string{"settings", "branches"}); len(bad) != 0 {
		t.Errorf("ValidateModules rejected known keys: %v", bad)
	}
	bad := ValidateModules([]string{"settings", "wat", "nope"})
	if !reflect.DeepEqual(bad, []string{"nope", "wat"}) {
		t.Errorf("ValidateModules = %v, want [nope wat] (sorted, so the error message is stable)", bad)
	}
	if bad := ValidateLanguages([]string{"en", "ml", "gu"}); len(bad) != 0 {
		t.Errorf("ValidateLanguages rejected known codes: %v", bad)
	}
	if bad := ValidateLanguages([]string{"fr"}); !reflect.DeepEqual(bad, []string{"fr"}) {
		t.Errorf("ValidateLanguages = %v, want [fr]", bad)
	}
}

// TestPolicyBoundsLanguages pins the rule that makes policy the primary axis:
// a business can only be granted a language its document family has a
// template for. Without this a KML business could be entitled to Gujarati,
// which has no KML template — the grant would look saved in the console and
// then silently render another language at print time.
func TestPolicyBoundsLanguages(t *testing.T) {
	kml := &Tenant{Policy: PolicyKML}
	kml.SetLanguages([]string{"en", "ml", "gu"})
	if got, want := kml.LanguageList(), []string{"en", "ml"}; !reflect.DeepEqual(got, want) {
		t.Errorf("KML LanguageList() = %v, want %v (Gujarati has no KML template)", got, want)
	}
	if kml.HasLanguage("gu") {
		t.Error("KML business reports Gujarati as issuable")
	}

	gml := &Tenant{Policy: PolicyGML}
	gml.SetLanguages([]string{"en", "ml", "gu"})
	if got, want := gml.LanguageList(), []string{"en", "gu"}; !reflect.DeepEqual(got, want) {
		t.Errorf("GML LanguageList() = %v, want %v (Malayalam has no GML template)", got, want)
	}
	if gml.HasLanguage("ml") {
		t.Error("GML business reports Malayalam as issuable")
	}
}

// TestSetPolicyRefiltersLanguages covers the switch case: a business moved to
// another family must not keep an entitlement the new family cannot print.
func TestSetPolicyRefiltersLanguages(t *testing.T) {
	tn := &Tenant{Policy: PolicyKML}
	tn.SetLanguages([]string{"en", "ml"})
	tn.SetPolicy(PolicyGML)
	if tn.HasLanguage("ml") {
		t.Error("Malayalam survived the switch to GML, which has no Malayalam template")
	}
	if !tn.HasLanguage("en") {
		t.Error("English must survive every policy switch")
	}
}

// TestEmptyPolicyIsKML pins the empty-means-KML rule every tenant row
// predating the policy column relies on.
func TestEmptyPolicyIsKML(t *testing.T) {
	tn := &Tenant{}
	if got := tn.PolicyOrDefault(); got != PolicyKML {
		t.Errorf("PolicyOrDefault() = %q, want %q", got, PolicyKML)
	}
	tn.SetLanguages([]string{"en", "ml"})
	if !tn.HasLanguage("ml") {
		t.Error("an unset policy should behave as KML, which grants Malayalam")
	}
}

// TestEveryPolicyHasEnglish is the invariant PolicyLanguages' own doc comment
// states and bondDocFor's fallback chain depends on: HasLanguage grants
// English unconditionally, so a policy without an English template would
// describe a business that cannot print its own paperwork.
func TestEveryPolicyHasEnglish(t *testing.T) {
	for _, p := range KnownPolicies {
		found := false
		for _, l := range LanguagesForPolicy(p) {
			if l == LangEnglish {
				found = true
			}
		}
		if !found {
			t.Errorf("policy %q has no English document language", p)
		}
	}
}
