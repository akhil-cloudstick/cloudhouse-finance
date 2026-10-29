package controllers

import "strings"

// searchAmountLike turns the search box text into a LIKE pattern for a numeric
// column cast to text, so "5,000" and "5000" both find 5000.00.
func searchAmountLike(search string) string {
	return "%" + strings.ReplaceAll(search, ",", "") + "%"
}
