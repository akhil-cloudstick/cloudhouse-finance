package controllers

import (
	"reflect"
	"testing"
)

func TestStatusFilterClause_RenewedIsNotAStoredStatus(t *testing.T) {
	clause, args := statusFilterClause([]string{"Renewed"})
	if clause != "(personal_loans.renewed_to_loan_id IS NOT NULL)" || len(args) != 0 {
		t.Errorf("Renewed: got %q %v", clause, args)
	}
}

func TestStatusFilterClause_ClosedLeavesOutRenewed(t *testing.T) {
	clause, args := statusFilterClause([]string{"Closed"})
	if clause != "((personal_loans.status = ? AND personal_loans.renewed_to_loan_id IS NULL))" || !reflect.DeepEqual(args, []any{"Closed"}) {
		t.Errorf("Closed: got %q %v", clause, args)
	}
}

func TestStatusFilterClause_Combined(t *testing.T) {
	clause, args := statusFilterClause([]string{"Active", "Renewed"})
	want := "(personal_loans.renewed_to_loan_id IS NOT NULL OR personal_loans.status IN ?)"
	if clause != want || len(args) != 1 || !reflect.DeepEqual(args[0], []string{"Active"}) {
		t.Errorf("Active+Renewed: got %q %v", clause, args)
	}
}
