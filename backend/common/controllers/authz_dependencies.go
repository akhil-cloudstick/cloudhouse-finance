package controllers

import (
	"sort"
	"strings"
	"sync"
)

var extraParents = map[string][]string{
	"can view branch ledger": {"can view branch module"},
	"can hard delete loan":   {"can delete loan"},
	"can create loan": {
		"can view loan module", "can view customer module", "can view scheme module",
		"can view gold rate module", "can view purity standard module", "can view ornament type module",
	},
	"can create personal loan":       {"can view personal loan module", "can view customer module"},
	"can create investment":          {"can view investment module", "can view customer module"},
	"can create reminder":            {"can view reminder module", "can view customer module"},
	"can view bank pledge module":    {"can view loan module"},
	"can update packet":              {"can view packet module", "can view locker module"},
	"can verify release checklist":   {"can update loan"},
	"can top up loan":                {"can view loan module"},
	"can view auction module":        {"can view loan module"},
	"can mark loan auction eligible": {"can update loan", "can view auction module"},
	"can issue auction notice":       {"can update loan", "can view auction module"},
	"can schedule auction":           {"can update loan", "can view auction module"},
	"can record auction sale":        {"can update loan", "can view auction module"},
	"can settle auction":             {"can update loan", "can view auction module"},
	"can create role":                {"can view role and permission module"},
	"can update role":                {"can view role and permission module"},
	"can delete role":                {"can view role and permission module"},
}

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

var (
	hierarchyOnce sync.Once
	hier          hierarchy
)

type hierarchy struct {
	parents    map[string][]string
	dependents map[string][]string
}

func loadHierarchy() hierarchy {
	hierarchyOnce.Do(func() {
		names := make(map[string]bool, len(AuthzCatalogue))
		for _, def := range AuthzCatalogue {
			names[def.Name] = true
		}
		h := hierarchy{parents: map[string][]string{}, dependents: map[string][]string{}}
		for _, def := range AuthzCatalogue {
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
					continue
				}
				h.parents[def.Name] = append(h.parents[def.Name], p)
				h.dependents[p] = append(h.dependents[p], def.Name)
			}
		}
		hier = h
	})
	return hier
}

func Parents(name string) []string {
	return loadHierarchy().parents[name]
}

func SoftParents(name string) []string {
	return softParents[name]
}

func AllParents(name string) []string {
	return walk(name, loadHierarchy().parents)
}

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
