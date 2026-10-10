package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"sort"
	"strings"
)

var KnownLanguages = []string{commonModels.LangEnglish, "ml", "gu"}

func ValidateModules(keys []string) []string { return unknownOf(keys, commonModels.KnownModules) }

func ValidateLanguages(codes []string) []string { return unknownOf(codes, KnownLanguages) }

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
