package localapi

import (
	"database/sql"
	"strings"
	"testing"
)

func openRaw(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// A change waiting to be sent is run through the real handler, shows in the read that follows, and leaves the copy as it was.
func TestWaitingChangeShowsInTheReadAndIsNotKept(t *testing.T) {
	path := seed(t)
	db := openRaw(t, path)
	for _, q := range []string{
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
	if err := srv.Bind(Session{TenantID: 1, EmployeeID: 7, RoleID: 10, Role: "Manager", BranchID: 1}); err != nil {
		t.Fatal(err)
	}
	before := srv.Handle("GET", "/users/7/schemes/1", "", nil)
	if before.Status != 200 || !strings.Contains(before.Body, "Gold 12") {
		t.Fatalf("scheme before: %d %s", before.Status, before.Body)
	}

	edit := Pending{Method: "PATCH", Path: "/schemes/1/update", Body: `{"name":"Gold 12 edited","duration_months":12,"ltv_percent":75,"interest_rate":12,"branch_id":1,"is_active":true}`}
	got, skipped := srv.HandleWithPending("GET", "/users/7/schemes/1", "", nil, []Pending{edit})
	if skipped != 0 {
		t.Fatalf("the edit was skipped: %d %s", got.Status, got.Body)
	}
	if !strings.Contains(got.Body, "Gold 12 edited") {
		t.Fatalf("the waiting edit should show in the read: %s", got.Body)
	}

	// rolled back: a plain read, and the file itself, still hold the old name
	if again := srv.Handle("GET", "/users/7/schemes/1", "", nil); !strings.Contains(again.Body, "Gold 12") || strings.Contains(again.Body, "edited") {
		t.Errorf("the copy must not keep a replayed change: %s", again.Body)
	}
	var name string
	if err := openRaw(t, path).QueryRow(`SELECT name FROM schemes WHERE id = 1`).Scan(&name); err != nil || name != "Gold 12" {
		t.Errorf("the database file changed: %q %v", name, err)
	}

	// a change the server would refuse changes nothing there, so it changes nothing here and does not spoil the answer
	bad := Pending{Method: "PATCH", Path: "/schemes/1/update", Body: `{"name":""}`}
	got, skipped = srv.HandleWithPending("GET", "/users/7/schemes/1", "", nil, []Pending{bad})
	if skipped != 0 || strings.Contains(got.Body, "edited") || !strings.Contains(got.Body, "Gold 12") {
		t.Errorf("a refused change must leave the answer as it was: skipped=%d %s", skipped, got.Body)
	}
	// a change to a record the copy does not hold cannot be trusted
	missing := Pending{Method: "PATCH", Path: "/schemes/99/update", Body: edit.Body}
	if _, skipped := srv.HandleWithPending("GET", "/users/7/schemes/1", "", nil, []Pending{missing}); skipped != 1 {
		t.Errorf("a change to a missing record must be counted, got %d", skipped)
	}
	// a change to a record this PC made and the server has not numbered yet cannot be run, and is not counted
	if got, skipped := srv.HandleWithPending("GET", "/users/7/schemes/1", "", nil, []Pending{{Method: "PATCH", Path: "/schemes/ref:abc/update", Body: `{}`}}); skipped != 0 || got.Status != 200 {
		t.Errorf("an unresolved reference is ignored: %d %d", skipped, got.Status)
	}
	// a caller cannot make a write by sending the replay header itself
	if got := srv.Handle("PATCH", "/users/7/schemes/1/update", "", map[string]string{replayHeader: srv.token}); got.Status != 405 {
		t.Errorf("a plain write must still be refused, got %d", got.Status)
	}
}
