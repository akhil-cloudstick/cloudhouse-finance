package customer

import "strings"

// normalizeName lowercases, strips punctuation, and collapses whitespace so
// "Anil K. Varma" and "anil  varma" compare as tokens rather than as
// byte-identical strings.
func normalizeName(name string) []string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r == ' ':
			b.WriteRune(r)
		default:
			b.WriteRune(' ')
		}
	}
	return strings.Fields(b.String())
}

// namesMatch reports whether the customer's on-file name and the name Setu
// returned for the verified PAN plausibly refer to the same person. This is
// deliberately NOT an exact-string match — real names legibly differ by
// middle names/initials/word order ("Anil Varma" vs "Anil Kumar Varma", or
// "Varma Anil") between what a customer types at registration and what's
// registered against their PAN. A PAN being valid ("verification":
// "SUCCESS" from Setu) only proves the PAN itself is real; it says nothing
// about whether it belongs to THIS customer — that's the check this
// function exists for. Match rule: every token of the shorter name must
// appear in the longer name's token set (a subset match), which catches an
// outright different person (no shared tokens) while tolerating a missing
// middle name/initial. This is intentionally permissive, not a strict
// identity check — flag for manual review rather than silently trusting it
// on a borderline case.
func namesMatch(customerName, setuName string) bool {
	a := normalizeName(customerName)
	b := normalizeName(setuName)
	if len(a) == 0 || len(b) == 0 {
		return false
	}
	shorter, longer := a, b
	if len(b) < len(a) {
		shorter, longer = b, a
	}
	longerSet := make(map[string]bool, len(longer))
	for _, tok := range longer {
		longerSet[tok] = true
	}
	for _, tok := range shorter {
		if !longerSet[tok] {
			return false
		}
	}
	return true
}
