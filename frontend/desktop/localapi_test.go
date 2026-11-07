package main

import (
	"strings"
	"testing"

	"cloudhouse/backend/localapi"
	"cloudhouse/desktop/localstore"
)

// The whole path the exe takes: the store's own database, rows put in by the mirror, and the backend's route handlers
// answering a read from them.
func TestOfflineReadsAreAnsweredFromTheStoresMirror(t *testing.T) {
	s := localstore.New(t.TempDir())
	t.Cleanup(s.Close)
	t.Cleanup(localapi.Close)
	if err := s.Open("acme", "pc"); err != nil {
		t.Fatal(err)
	}
	if err := s.MirrorBindTenant(1); err != nil {
		t.Fatal(err)
	}
	err := s.MirrorApply(`{"tables":[
		{"table":"branches","rows":[{"id":1,"name":"Main","code":"B1"}]},
		{"table":"roles","rows":[{"id":10,"name":"Manager","is_active":true,"is_system":false}]},
		{"table":"permissions","rows":[{"id":1,"name":"can view loan module","module_name":"Loan","is_active":true},{"id":2,"name":"can view all branches","module_name":"Branch","is_active":true}]},
		{"table":"role_permissions","rows":[{"id":1,"role_id":10,"permission_id":1,"permission":true},{"id":2,"role_id":10,"permission_id":2,"permission":true}]},
		{"table":"customers","rows":[{"id":1,"uuid":"c1","name":"Meera","phone":"9999","branch_id":1,"created_at":"2026-01-02T03:04:05Z","updated_at":"2026-01-02T03:04:05Z"}]},
		{"table":"schemes","rows":[{"id":1,"name":"Gold 12","created_at":"2026-01-02T03:04:05Z","updated_at":"2026-01-02T03:04:05Z"}]},
		{"table":"loans","rows":[{"id":5,"uuid":"l5","loan_number":"LN-5","branch_id":1,"customer_id":1,"scheme_id":1,"status":"Active","approval_stage":"Approved","principal_amount":50000,"outstanding_amount":50000,"opened_date":"2026-01-02T03:04:05Z","due_date":"2026-12-02T03:04:05Z","created_at":"2026-01-02T03:04:05Z","updated_at":"2026-01-02T03:04:05Z"}]}
	]}`)
	if err != nil {
		t.Fatal(err)
	}
	path, err := s.DBPath()
	if err != nil {
		t.Fatal(err)
	}
	srv, err := localapi.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.Bind(localapi.Session{TenantID: 1, EmployeeID: 7, RoleID: 10, Role: "Manager", BranchID: 1}); err != nil {
		t.Fatal(err)
	}
	got := srv.Handle("GET", "/users/7/loans", "limit=20", nil)
	if got.Status != 200 || !strings.Contains(got.Body, "LN-5") || !strings.Contains(got.Body, "Meera") {
		t.Fatalf("the loan list from the store's mirror: %d %s", got.Status, got.Body)
	}
}
