package controllers

import (
	"slices"
	"testing"
)

func catalogueNames() map[string]bool {
	names := make(map[string]bool, len(AuthzCatalogue))
	for _, def := range AuthzCatalogue {
		names[def.Name] = true
	}
	return names
}

func TestHierarchyNamesExist(t *testing.T) {
	names := catalogueNames()
	for child, ps := range extraParents {
		if !names[child] {
			t.Errorf("extraParents child %q is not in the catalogue", child)
		}
		for _, p := range ps {
			if !names[p] {
				t.Errorf("extraParents[%q] parent %q is not in the catalogue", child, p)
			}
		}
	}
	for child, ps := range softParents {
		if !names[child] {
			t.Errorf("softParents child %q is not in the catalogue", child)
		}
		for _, p := range ps {
			if !names[p] {
				t.Errorf("softParents[%q] parent %q is not in the catalogue", child, p)
			}
		}
	}
}

func TestHierarchyHasNoCycles(t *testing.T) {
	for _, def := range AuthzCatalogue {
		if slices.Contains(AllParents(def.Name), def.Name) {
			t.Errorf("%q is its own ancestor", def.Name)
		}
	}
}

func TestCRUDUnderModuleView(t *testing.T) {
	cases := map[string]string{
		"can create branch":        "can view branch module",
		"can view branch ledger":   "can view branch module",
		"can hard delete customer": "can view customer module",
		"can hard delete loan":     "can view loan module",
		"can delete locker":        "can view locker module",
		"can create bank pledge":   "can view loan module",
		"can settle auction":       "can view loan module",
		"can update role":          "can view role and permission module",
	}
	for child, ancestor := range cases {
		if !slices.Contains(AllParents(child), ancestor) {
			t.Errorf("%q should sit under %q, has %v", child, ancestor, AllParents(child))
		}
	}
	for _, p := range []string{"can view scheme module", "can view gold rate module", "can view purity standard module", "can view ornament type module", "can view customer module", "can create upload"} {
		if !slices.Contains(Dependents(p), "can create loan") {
			t.Errorf("revoking %q should revoke create loan", p)
		}
	}
}

func TestRestrictionsInCatalogue(t *testing.T) {
	names := catalogueNames()
	for _, r := range Restrictions {
		if !names[r.PermissionName] {
			t.Errorf("restriction on %q, not in the catalogue", r.PermissionName)
		}
	}
}

func TestPermissionLabel(t *testing.T) {
	for in, want := range map[string]string{
		"can view scheme module": "Scheme module",
		"can update loan":        "Update loan",
		"can view branch ledger": "View branch ledger",
	} {
		if got := PermissionLabel(in); got != want {
			t.Errorf("PermissionLabel(%q) = %q, want %q", in, got, want)
		}
	}
}
