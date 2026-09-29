package reports

import (
	"fmt"
	"reflect"
	"strings"
	"time"
)

// MatchRows keeps the rows in which any exported field's rendered value
// contains q (case-insensitive) — the generic free-text search behind every
// report endpoint's `q` param. An empty q returns rows unchanged.
//
// Report rows are flat DTOs (see model.go), so a reflection walk over their
// fields is enough: strings match directly, time.Time matches on its
// YYYY-MM-DD form (what the report tables display), pointers are followed,
// nested structs are walked, and every other scalar (ids, amounts, counts)
// matches on its fmt %v rendering. This lets one helper serve every report
// instead of a hand-written WHERE clause per query.
//
// Report services call it on the scanned rows BEFORE computing Totals, so
// the totals describe the searched set; respond also applies it before
// Paginate as a safety net for the few reports that build rows without a
// single scan (their Totals then stay computed over the pre-search set).
// Applying it twice is harmless — it is idempotent.
func MatchRows[T any](rows []T, q string) []T {
	needle := strings.ToLower(strings.TrimSpace(q))
	if needle == "" {
		return rows
	}
	kept := make([]T, 0, len(rows))
	for i := range rows {
		if valueMatches(reflect.ValueOf(rows[i]), needle, 0) {
			kept = append(kept, rows[i])
		}
	}
	return kept
}

var timeType = reflect.TypeOf(time.Time{})

// valueMatches reports whether v (or, for structs, any exported field of v)
// renders to text containing needle (already lower-cased). depth guards
// against pathological recursive types.
func valueMatches(v reflect.Value, needle string, depth int) bool {
	if depth > 4 || !v.IsValid() {
		return false
	}
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface:
		if v.IsNil() {
			return false
		}
		return valueMatches(v.Elem(), needle, depth+1)
	case reflect.String:
		return strings.Contains(strings.ToLower(v.String()), needle)
	case reflect.Struct:
		if v.Type() == timeType {
			t := v.Interface().(time.Time)
			if t.IsZero() {
				return false
			}
			return strings.Contains(t.Format("2006-01-02"), needle)
		}
		for i := 0; i < v.NumField(); i++ {
			if !v.Type().Field(i).IsExported() {
				continue
			}
			if valueMatches(v.Field(i), needle, depth+1) {
				return true
			}
		}
		return false
	case reflect.Slice, reflect.Array, reflect.Map, reflect.Func, reflect.Chan:
		return false
	default:
		return strings.Contains(strings.ToLower(fmt.Sprint(v.Interface())), needle)
	}
}
