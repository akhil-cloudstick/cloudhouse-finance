package controllers

import (
	"fmt"
	"reflect"
	"strings"
	"time"
)

var timeType = reflect.TypeOf(time.Time{})

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
