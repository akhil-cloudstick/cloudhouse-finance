package controllers

// The day a release request is logged for (the "Request Date" of the Request Release screen), against the scratch DB.

import (
	"strings"
	"testing"
	"time"
)

func TestIntegrationReleaseRequestDate(t *testing.T) {
	l := newLedgerLoan(t, ledgerAge)
	t.Cleanup(func() { exec(t, `DELETE FROM loan_requests WHERE loan_id = ?`, l.id) })

	// a request logged for an earlier day keeps that day
	day := l.when(40)
	req, err := SaveReleaseRequest(l.ctx, l.id, ReleaseRequestInput{Detail: "back-dated", RequestedAt: &day})
	if err != nil {
		t.Fatalf("release request for day 40: %v", err)
	}
	if got := req.RequestedAt.In(day.Location()).Format("2006-01-02"); got != day.Format("2006-01-02") {
		t.Fatalf("requested_at = %s, want %s", got, day.Format("2006-01-02"))
	}
	exec(t, `DELETE FROM loan_requests WHERE loan_id = ?`, l.id)

	// a date before the loan started, or in the future, is refused and saves nothing
	early := l.opened.AddDate(0, 0, -5)
	if _, err := SaveReleaseRequest(l.ctx, l.id, ReleaseRequestInput{RequestedAt: &early}); err == nil {
		t.Fatal("a request dated before the loan started must be refused")
	}
	future := time.Now().AddDate(0, 0, 3)
	if _, err := SaveReleaseRequest(l.ctx, l.id, ReleaseRequestInput{RequestedAt: &future}); err == nil || !strings.Contains(err.Error(), "future") && !strings.Contains(err.Error(), "date") {
		t.Fatalf("a request dated in the future must be refused, got %v", err)
	}
	if n := scalarInt(t, `SELECT count(*) FROM loan_requests WHERE loan_id = ?`, l.id); n != 0 {
		t.Fatalf("refused requests left %d rows behind", n)
	}

	// no date means now, as before
	before := time.Now().Add(-time.Minute)
	req, err = SaveReleaseRequest(l.ctx, l.id, ReleaseRequestInput{Detail: "today"})
	if err != nil {
		t.Fatalf("release request with no date: %v", err)
	}
	if req.RequestedAt.Before(before) {
		t.Fatalf("a request with no date was stamped %v, want now", req.RequestedAt)
	}
}
