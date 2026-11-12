package controllers

import "strings"

// IsDigitQuery reports whether a search term is made only of digits, i.e. someone
// typing a number ("8", "39", "148") to find a record by its ID or phone number.
func IsDigitQuery(q string) bool {
	if q == "" {
		return false
	}
	for _, r := range q {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// NumericPrefixSQL is a WHERE fragment (one "?" placeholder) that is true when the
// digits inside a code column, without leading zeros, start with the typed number:
// "LN-00148" and "CUST-01" are read as 148 and 1. Pair it with NumericPrefixArg.
func NumericPrefixSQL(col string) string {
	return "ltrim(regexp_replace(" + col + ", '[^0-9]', '', 'g'), '0') LIKE ?"
}

// NumericPrefixArg is the argument for NumericPrefixSQL. A term of only zeros has
// no significant digits, so it matches nothing rather than everything.
func NumericPrefixArg(q string) string {
	stripped := strings.TrimLeft(q, "0")
	if stripped == "" {
		return "-%"
	}
	return stripped + "%"
}

// NumericExactFirstOrder is an ORDER BY fragment that puts the record whose code number IS the typed
// number ahead of the ones that merely start with it or match a phone ("9" lists CUST-09 before
// CUST-90 and before every phone starting 9). Pair it with NumericExactFirstArg.
func NumericExactFirstOrder(col string) string {
	return "(ltrim(regexp_replace(" + col + ", '[^0-9]', '', 'g'), '0') = ?) DESC"
}

// NumericExactFirstArg is the argument for NumericExactFirstOrder; a term of only zeros matches nothing.
func NumericExactFirstArg(q string) string {
	if stripped := strings.TrimLeft(q, "0"); stripped != "" {
		return stripped
	}
	return "-"
}
