package controllers

import (
	"strings"
	"testing"
	"time"

	commonModels "cloudhouse/backend/common/models"
)

// The release agreement is dated the day the loan was closed, not the day it is printed, in every language.
func TestReleaseAgreementUsesTheClosingDate(t *testing.T) {
	closed := time.Date(2025, time.March, 5, 11, 30, 0, 0, time.Local)
	today := releaseFmtDate(time.Now(), BondLangEnglish)
	for _, lang := range []string{BondLangEnglish, BondLangMalayalam} {
		html, err := renderReleaseAgreementHTML(ReleaseAgreementData{
			LoanNumber:     "LN-00001",
			Policy:         commonModels.PolicyKML,
			BorrowedDate:   time.Date(2024, time.June, 1, 0, 0, 0, 0, time.Local),
			BorrowedAmount: 50000,
			ReturnedDate:   closed,
			ReturnedAmount: 52000,
		}, lang)
		if err != nil {
			t.Fatalf("%s: render failed: %v", lang, err)
		}
		want := releaseFmtDate(closed, lang)
		if got := strings.Count(html, want); got < 2 { // the header date and the "returned on" line
			t.Errorf("%s: closing date %q appears %d times, want at least 2", lang, want, got)
		}
		if lang == BondLangEnglish && strings.Contains(html, today) {
			t.Errorf("%s: the print date %q must not appear", lang, today)
		}
	}
}
