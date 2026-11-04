package controllers

import (
	"strings"

	"gorm.io/gorm"
)

// SearchTerms splits a typed search into its lower-cased words, dropping thousands commas so "15,000" finds 15000.
func SearchTerms(q string) []string {
	return strings.Fields(strings.ToLower(strings.ReplaceAll(q, ",", "")))
}

// ApplySearch narrows a query to rows where EVERY word of q appears in at least one of the given SQL expressions
// (columns, or expressions such as to_char(d,'DD-MM-YYYY') for a date shown that way on screen). Each expression is
// cast to text so amounts and dates can be searched like any other field.
func ApplySearch(db *gorm.DB, q string, exprs ...string) *gorm.DB {
	for _, term := range SearchTerms(q) {
		like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%"
		parts := make([]string, len(exprs))
		args := make([]any, len(exprs))
		for i, e := range exprs {
			parts[i] = "REPLACE(CAST(" + e + " AS text), ',', '') ILIKE ?"
			args[i] = like
		}
		db = db.Where("("+strings.Join(parts, " OR ")+")", args...)
	}
	return db
}

// MatchesSearch is ApplySearch for rows already computed in Go (values that are not database columns, such as a
// risk level or a live gold value): every word of q must appear in at least one field, case-insensitively.
func MatchesSearch(q string, fields ...string) bool {
	terms := SearchTerms(q)
	if len(terms) == 0 {
		return true
	}
	hay := strings.ToLower(strings.ReplaceAll(strings.Join(fields, "\n"), ",", ""))
	for _, t := range terms {
		if !strings.Contains(hay, t) {
			return false
		}
	}
	return true
}
