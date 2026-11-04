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
