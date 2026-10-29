package controllers

import (
	"fmt"
	"strings"
)

// ledgerRowMatches reports whether a ledger line matches the search box: the
// needle may be part of the date (DD-MM-YYYY or YYYY-MM-DD), ref no,
// particulars, mode/method, bank, party or the debit/credit amount. needle is
// already lower-cased and trimmed.
func ledgerRowMatches(r ledgerSourceRow, needle string) bool {
	for _, text := range []string{
		r.Date.Format("02-01-2006"),
		r.Date.Format("2006-01-02"),
		r.Reference,
		r.Description,
		r.Method,
		r.BankName,
		r.CustomerName,
	} {
		if strings.Contains(strings.ToLower(text), needle) {
			return true
		}
	}
	if r.Memo {
		return false
	}
	// "5,000" and "5000" both find a 5000.00 line.
	amount := strings.ReplaceAll(needle, ",", "")
	return amount != "" && strings.Contains(fmt.Sprintf("%.2f", r.Amount), amount)
}

// withLedgerSearch narrows keep's result to the lines matching search. With no
// search it is keep unchanged. The result is a fresh slice, so it never
// disturbs keep's own in-place filtering.
func withLedgerSearch(keep func([]ledgerSourceRow) []ledgerSourceRow, search string) func([]ledgerSourceRow) []ledgerSourceRow {
	needle := strings.ToLower(strings.TrimSpace(search))
	if needle == "" {
		return keep
	}
	return func(rows []ledgerSourceRow) []ledgerSourceRow {
		if keep != nil {
			rows = keep(rows)
		}
		kept := make([]ledgerSourceRow, 0, len(rows))
		for _, r := range rows {
			if ledgerRowMatches(r, needle) {
				kept = append(kept, r)
			}
		}
		return kept
	}
}
