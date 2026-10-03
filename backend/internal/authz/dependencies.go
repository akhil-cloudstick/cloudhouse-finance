package authz

import (
	"sort"
	"strings"
	"sync"
)

// Permission hierarchy.
//
// A permission's PARENTS must all be granted before it can be: a child is
// useless without them (its screen can't load the data it needs, or its
// route sits behind the parent's). So the rules are:
//
//   - granting a child whose parent is off is refused (ErrParentDisabled);
//   - revoking a parent revokes every permission below it, transitively.
//
// Two kinds of parent:
//
//   - Within a module, "can view <noun> module" is the parent of every other
//     "can <verb> <noun>" — derived from Catalogue, so a new CRUD permission
//     is wired automatically.
//   - Across modules, extraParents below — a screen that needs another
//     module's data for a REQUIRED field (New Loan can't be filled without
//     schemes, customers, gold rate, purity standards and ornament types).
//
// softParents are the weaker links: the feature works without them but one
// dropdown or panel is empty. They are only shown as a warning.

// extraParents are the cross-module (and non-CRUD) parents. They REPLACE the
// derived module parent where they name one of their own (e.g. hard delete
// loan sits under delete loan, not directly under view loan).
var extraParents = map[string][]string{
	"can view branch ledger": {"can view branch module"},

	"can hard delete loan": {"can delete loan"},
	"can create loan": {
		"can view loan module", "can view customer module", "can view scheme module",
		"can view gold rate module", "can view purity standard module", "can view ornament type module",
	},
	"can create personal loan": {"can view personal loan module", "can view customer module"},
	"can create investment":    {"can view investment module", "can view customer module"},
	"can create reminder":      {"can view reminder module", "can view customer module"},

	// The Bank Re-Pledge page lists loans.
	"can view bank pledge module": {"can view loan module"},
	// Moving a packet picks its destination locker.
	"can update packet": {"can view packet module", "can view locker module"},

	// Service-checked loan steps, all behind the "can update loan" route gate.
	"can verify release checklist": {"can update loan"},
	// Topping up is not an edit of the loan: it only needs to see the loan.
	"can top up loan": {"can view loan module"},

	// Auctions are a facet of a loan, so seeing them needs the loan module;
	// every auction step also sits under seeing auctions at all.
	"can view auction module":              {"can view loan module"},
	"can mark loan auction eligible":       {"can update loan", "can view auction module"},
	"can issue auction notice":             {"can update loan", "can view auction module"},
	"can schedule auction":                 {"can update loan", "can view auction module"},
	"can record auction sale":              {"can update loan", "can view auction module"},
	"can settle auction":                   {"can update loan", "can view auction module"},
	"can decide auction partial repayment": {"can view auction module"},
	"can decide auction shortfall":         {"can view auction module"},

	"can create role": {"can view role and permission module"},
	"can update role": {"can view role and permission module"},
	"can delete role": {"can view role and permission module"},
}

// softParents: works without them, but a picker or panel comes up empty.
var softParents = map[string][]string{
	"can create loan":          {"can view locker module", "can create upload"},
	"can update loan":          {"can view bank module", "can view cash module", "can view packet module", "can view scheme module", "can view purity standard module"},
	"can create customer":      {"can create upload"},
	"can update customer":      {"can create upload"},
	"can create cash":          {"can view bank module", "can create upload"},
	"can create personal loan": {"can view cash module"},
	"can update personal loan": {"can view bank module"},
	"can update investment":    {"can view bank module"},
}

var crudVerbs = []string{"can create ", "can update ", "can delete ", "can hard delete "}

type hierarchy struct {
	parents    map[string][]string // direct
	dependents map[string][]string // direct children
}

var (
	hierarchyOnce sync.Once
	hier          hierarchy
)

func loadHierarchy() hierarchy {
	hierarchyOnce.Do(func() {
		names := make(map[string]bool, len(Catalogue))
		for _, def := range Catalogue {
			names[def.Name] = true
		}
		h := hierarchy{parents: map[string][]string{}, dependents: map[string][]string{}}
		for _, def := range Catalogue {
			var ps []string
			if extra, ok := extraParents[def.Name]; ok {
				ps = extra
			} else {
				for _, verb := range crudVerbs {
					if noun, ok := strings.CutPrefix(def.Name, verb); ok {
						if view := "can view " + noun + " module"; names[view] {
							ps = []string{view}
						}
						break
					}
				}
			}
			for _, p := range ps {
				if !names[p] {
					continue // a parent dropped from the catalogue gates nothing
				}
				h.parents[def.Name] = append(h.parents[def.Name], p)
				h.dependents[p] = append(h.dependents[p], def.Name)
			}
		}
		hier = h
	})
	return hier
}

// Parents returns name's direct hard parents.
func Parents(name string) []string {
	return loadHierarchy().parents[name]
}

// SoftParents returns name's warning-only parents still in the catalogue.
func SoftParents(name string) []string {
	return softParents[name]
}

// AllParents returns every permission above name, transitively, sorted.
func AllParents(name string) []string {
	return walk(name, loadHierarchy().parents)
}

// Dependents returns every permission below name, transitively, sorted —
// everything that must be revoked along with it.
func Dependents(name string) []string {
	return walk(name, loadHierarchy().dependents)
}

func walk(start string, edges map[string][]string) []string {
	seen := map[string]bool{}
	stack := append([]string(nil), edges[start]...)
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if seen[n] || n == start {
			continue
		}
		seen[n] = true
		stack = append(stack, edges[n]...)
	}
	out := make([]string, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// PermissionLabel is the short human name used in "<parent> is disabled"
// messages: "can view scheme module" -> "Scheme module",
// "can update loan" -> "Update loan".
func PermissionLabel(name string) string {
	s := name
	if inner, ok := strings.CutPrefix(s, "can view "); ok && strings.HasSuffix(inner, " module") {
		s = inner
	} else {
		s = strings.TrimPrefix(s, "can ")
	}
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
