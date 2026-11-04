package controllers

import (
	"strings"
	"testing"
)

func TestErrCustomerHasLinkedRecords_NamesEveryRecord(t *testing.T) {
	err := errCustomerHasLinkedRecords([]string{
		"Gold loan LN-00001 (Active)",
		"Personal loan PL-00002 (Closed)",
		"Investment INV-00003 (Active)",
	})
	msg := err.Error()
	for _, want := range []string{"LN-00001", "PL-00002", "INV-00003"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message %q must name %s", msg, want)
		}
	}
}
