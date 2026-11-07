package localapi

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"cloudhouse/backend/common/mirror"

	_ "modernc.org/sqlite"
)

func seed(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "offline.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ddl, err := mirror.DDL()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ddl); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for _, q := range []string{
		`INSERT INTO branches (tenant_id, id, name, code, created_at, updated_at) VALUES (1, 1, 'Main', 'B1', '` + now + `', '` + now + `')`,
		`INSERT INTO roles (tenant_id, id, name, is_active, is_system, created_at, updated_at) VALUES (1, 10, 'Manager', 1, 0, '` + now + `', '` + now + `'), (1, 11, 'Clerk', 1, 0, '` + now + `', '` + now + `')`,
		`INSERT INTO permissions (tenant_id, id, name, module_name, is_active) VALUES (0, 1, 'can view loan module', 'Loan', 1), (0, 2, 'can view all branches', 'Branch', 1)`,
		`INSERT INTO role_permissions (tenant_id, id, role_id, permission_id, permission) VALUES (1, 1, 10, 1, 1), (1, 2, 10, 2, 1), (1, 3, 11, 1, 0)`,
		`INSERT INTO customers (tenant_id, id, uuid, name, phone, branch_id, created_at, updated_at) VALUES (1, 1, 'c1', 'Meera', '9999', 1, '` + now + `', '` + now + `')`,
		`INSERT INTO schemes (tenant_id, id, name, created_at, updated_at) VALUES (1, 1, 'Gold 12', '` + now + `', '` + now + `')`,
		`INSERT INTO loans (tenant_id, id, uuid, loan_number, branch_id, customer_id, scheme_id, status, approval_stage, principal_amount, outstanding_amount, opened_date, due_date, created_at, updated_at) VALUES (1, 5, 'l5', 'LN-5', 1, 1, 1, 'Active', 'Approved', 50000, 50000, '` + now + `', '` + now + `', '` + now + `', '` + now + `')`,
		`INSERT INTO loans (tenant_id, id, uuid, loan_number, branch_id, customer_id, scheme_id, status, approval_stage, principal_amount, outstanding_amount, opened_date, due_date, created_at, updated_at) VALUES (2, 6, 'other', 'LN-OTHER-BUSINESS', 1, 1, 1, 'Active', 'Approved', 1, 1, '` + now + `', '` + now + `', '` + now + `', '` + now + `')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("seeding: %v\n%s", err, q)
		}
	}
	return path
}

func TestLocalServerAnswersReadsFromTheMirror(t *testing.T) {
	srv, err := Open(seed(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(Close)
	if got := srv.Handle("GET", "/users/7/loans", "", nil); got.Status != 401 {
		t.Fatalf("before a session is bound the answer must be 401, got %d %s", got.Status, got.Body)
	}

	// a manager: may view loans and every branch
	if err := srv.Bind(Session{TenantID: 1, EmployeeID: 7, RoleID: 10, Role: "Manager", BranchID: 1}); err != nil {
		t.Fatal(err)
	}
	list := srv.Handle("GET", "/users/7/loans", "limit=50", nil)
	if list.Status != 200 {
		t.Fatalf("list: %d %s", list.Status, list.Body)
	}
	if !strings.Contains(list.Body, "LN-5") || !strings.Contains(list.Body, "Meera") {
		t.Errorf("the loan and its customer should be in the list: %s", list.Body)
	}
	if strings.Contains(list.Body, "LN-OTHER-BUSINESS") {
		t.Error("another business's loan appeared in the list")
	}
	one := srv.Handle("GET", "/users/7/loans/5", "", nil)
	if one.Status != 200 || !strings.Contains(one.Body, "LN-5") {
		t.Errorf("detail: %d %s", one.Status, one.Body)
	}
	if got := srv.Handle("GET", "/users/7/loans/6", "", nil); got.Status == 200 {
		t.Errorf("another business's loan must not be readable, got %s", got.Body)
	}

	// the path must name the signed-in user
	if got := srv.Handle("GET", "/users/8/loans", "", nil); got.Status != 403 {
		t.Errorf("another user's path: %d, want 403", got.Status)
	}
	// nothing is written to the local copy
	if got := srv.Handle("POST", "/users/7/loans", "", nil); got.Status != 405 {
		t.Errorf("a write must be refused with 405, got %d", got.Status)
	}
}

func TestLocalServerAppliesTheRolesPermissions(t *testing.T) {
	srv, err := Open(seed(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(Close)
	// a clerk whose role has the loan permission switched off
	if err := srv.Bind(Session{TenantID: 1, EmployeeID: 9, RoleID: 11, Role: "Clerk", BranchID: 1}); err != nil {
		t.Fatal(err)
	}
	got := srv.Handle("GET", "/users/9/loans", "limit=10", nil)
	if got.Status != 403 {
		t.Errorf("a role without the permission must be refused offline too, got %d %s", got.Status, got.Body)
	}
}

func TestMain(m *testing.M) { os.Exit(m.Run()) }
