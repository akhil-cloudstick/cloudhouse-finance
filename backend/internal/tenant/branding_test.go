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
