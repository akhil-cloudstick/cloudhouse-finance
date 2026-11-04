package controllers

import "testing"

func TestIsDigitQuery(t *testing.T) {
	for q, want := range map[string]bool{"": false, "8": true, "39": true, "007": true, "LN-1": false, "9 8": false, "ravi": false, "+91": false} {
		if got := IsDigitQuery(q); got != want {
			t.Errorf("IsDigitQuery(%q) = %v, want %v", q, got, want)
		}
	}
}

func TestNumericPrefixArg(t *testing.T) {
	for q, want := range map[string]string{"8": "8%", "39": "39%", "007": "7%", "0": "-%", "000": "-%"} {
		if got := NumericPrefixArg(q); got != want {
			t.Errorf("NumericPrefixArg(%q) = %q, want %q", q, got, want)
		}
	}
	if sql := NumericPrefixSQL("code"); sql != "ltrim(regexp_replace(code, '[^0-9]', '', 'g'), '0') LIKE ?" {
		t.Errorf("unexpected SQL fragment: %s", sql)
	}
}
