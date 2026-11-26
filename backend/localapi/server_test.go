package localapi

import (
	"database/sql"
	"encoding/json"
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

// The main PC answers a counter's read from the shared copy, as that counter's user, and never as (or over) the user
// signed in on the main PC itself.
func TestMainPCAnswersEachCountersReadAsThatCountersUser(t *testing.T) {
	path := seed(t)
	db := openRaw(t, path)
	for _, q := range []string{ // the manager may view and edit schemes; the clerk has no scheme permission
		`INSERT INTO permissions (tenant_id, id, name, module_name, is_active) VALUES (0, 3, 'can view scheme module', 'Scheme', 1), (0, 4, 'can update scheme', 'Scheme', 1)`,
		`INSERT INTO role_permissions (tenant_id, id, role_id, permission_id, permission) VALUES (1, 4, 10, 3, 1), (1, 5, 10, 4, 1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	srv, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(Close)

	manager := Session{TenantID: 1, EmployeeID: 7, RoleID: 10, Role: "Manager", BranchID: 1}
	clerk := Session{TenantID: 1, EmployeeID: 9, RoleID: 11, Role: "Clerk", BranchID: 1}

	// nobody is signed in on the main PC: a counter's request still works, as its own user
	if got := srv.Handle("GET", "/users/7/loans", "", nil); got.Status != 401 {
		t.Fatalf("the main PC's own session is empty, want 401, got %d", got.Status)
	}
	if got := srv.HandleAs(manager, "GET", "/users/7/loans", "limit=50", nil); got.Status != 200 || !strings.Contains(got.Body, "LN-5") {
		t.Fatalf("manager counter: %d %s", got.Status, got.Body)
	}
	// another counter with a role that may not view loans is refused as itself, in the same moment
	if got := srv.HandleAs(clerk, "GET", "/users/9/loans", "limit=10", nil); got.Status != 403 {
		t.Fatalf("clerk counter must be refused, got %d %s", got.Status, got.Body)
	}
	// a counter's user cannot read another user's path
	if got := srv.HandleAs(manager, "GET", "/users/9/loans", "", nil); got.Status != 403 {
		t.Fatalf("a counter must only read its own path, got %d", got.Status)
	}
	// an incomplete session is rejected
	if got := srv.HandleAs(Session{EmployeeID: 7}, "GET", "/users/7/loans", "", nil); got.Status != 401 {
		t.Fatalf("an incomplete session must be 401, got %d", got.Status)
	}
	// none of that touched the session signed in on the main PC
	if got := srv.Handle("GET", "/users/7/loans", "", nil); got.Status != 401 {
		t.Fatalf("serving counters must not bind the main PC's own session, got %d", got.Status)
	}

	// and with a waiting change: the replay runs as the counter's user and the answers are not shared between users
	const body = `{"name":"Gold 12 edited","duration_months":12,"ltv_percent":75,"interest_rate":12,"branch_id":1,"is_active":true}`
	pendingJSON, _ := json.Marshal([]Pending{{Method: "PATCH", Path: "/schemes/1/update", Body: body}})
	got := srv.GetWithPendingAs(manager, "/users/7/schemes/1", "", nil, string(pendingJSON))
	if got.Status != 200 || got.Skipped != 0 || !strings.Contains(got.Body, "Gold 12 edited") {
		t.Fatalf("manager with a waiting change: %d skipped=%d %s", got.Status, got.Skipped, got.Body)
	}
	if got := srv.GetWithPendingAs(clerk, "/users/9/schemes/1", "", nil, string(pendingJSON)); got.Status == 200 || strings.Contains(got.Body, "edited") {
		t.Fatalf("a clerk with no scheme permission must be refused, not answered from the manager's answer: %d %s", got.Status, got.Body)
	}
	if got := srv.GetWithPendingAs(manager, "/users/7/schemes/1", "", nil, string(pendingJSON)); got.Status != 200 || !strings.Contains(got.Body, "Gold 12 edited") {
		t.Fatalf("the manager's own answer must still be right after the clerk asked: %d %s", got.Status, got.Body)
	}
	// the copy itself was never changed
	if got := srv.HandleAs(manager, "GET", "/users/7/schemes/1", "", nil); strings.Contains(got.Body, "edited") {
		t.Fatalf("a waiting change must not be kept: %s", got.Body)
	}
}

func TestMain(m *testing.M) { os.Exit(m.Run()) }

// A read that arrives after the copy was closed (the store moved, the app closing) answers 503 and never touches the closed file;
// Open on another path builds a fresh server instead of returning the old one.
func TestReadsAfterCloseAnswerUnavailableAndOpenFollowsAMovedFile(t *testing.T) {
	first, err := Open(seed(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Bind(Session{TenantID: 1, EmployeeID: 7, RoleID: 10, Role: "Manager", BranchID: 1}); err != nil {
		t.Fatal(err)
	}
	Close()
	if got := first.Handle("GET", "/users/7/loans", "", nil); got.Status != 503 {
		t.Fatalf("a read after Close must answer 503, got %d %s", got.Status, got.Body)
	}
	if got, skipped := first.HandleWithPending("GET", "/users/7/loans/5", "", nil, []Pending{{Method: "PATCH", Path: "/loans/5", Body: "{}"}}); got.Status != 503 || skipped != 0 {
		t.Fatalf("a replay after Close must answer 503, got %d (skipped %d)", got.Status, skipped)
	}

	a, err := Open(seed(t))
	if err != nil {
		t.Fatal(err)
	}
	b, err := Open(seed(t)) // a different file: the first server is released and a new one is built
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(Close)
	if a == b {
		t.Fatal("Open on a moved file must build a new server, not return the old one")
	}
	if got := a.Handle("GET", "/users/7/loans", "", nil); got.Status != 503 {
		t.Fatalf("the replaced server must answer 503, got %d", got.Status)
	}
}
