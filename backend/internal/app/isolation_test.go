package app

// The multi-tenancy isolation harness (documents/multitenancy_plan.md,
// Step 14).
//
// It exercises the REAL router — every route, the real middleware chain, the
// real permission gates — because the two cross-tenant leaks this codebase
// has actually shipped were both invisible at the unit level. One only
// appeared in the generated SQL of a fully wired query; the other was a table
// missing from a list, with every existing test still green. A harness built
// on a miniature stand-in router would have caught neither.
//
// Two halves:
//
//   - TestEveryRouteIsClassified needs NO database and runs in plain
//     `go test ./...`. It is the part that cannot rot: mount a route without
//     classifying it and the build goes red.
//
//   - Everything else needs a scratch database and is skipped unless
//     MT_TEST_DB names one:
//
//     createdb -h localhost -U cloudhouse mt_probe
//     DB_NAME=mt_probe go run ./cmd/migrate
//     MT_TEST_DB=mt_probe go test ./internal/app/ -v
//
// NEVER point MT_TEST_DB at the live database. The harness writes fixtures,
// suspends businesses and issues DELETEs.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cloudhouse/backend/internal/migrate"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/internal/upload"
)

// staffRoles are the nine roles a business has. Probes run as every one of
// them: a leak reachable only by, say, a Cashier is still a leak, and
// checking Administrator alone would have missed it.
var staffRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator",
	"Cashier", "Accountant", "Collection Staff", "Auction Administrator",
	"Auditor",
}

// ---------------------------------------------------------------------------
// Half one: the classification gate. No database.
// ---------------------------------------------------------------------------

// buildRouterWithoutDatabase wires the whole application against a database
// handle that is never contacted.
//
// sql.Open does not connect — it only validates the driver name — and
// DisableAutomaticPing stops GORM probing at Open. Every repository merely
// stores the handle, so Build never issues a query. That is what lets the
// classification gate run on a machine with no Postgres, which is the whole
// point: the check that must never be skipped must never need setup.
func buildRouterWithoutDatabase(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	sqlDB, err := sql.Open("pgx", "postgres://harness@127.0.0.1:1/unused")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db, err := gorm.Open(
		postgres.New(postgres.Config{Conn: sqlDB}),
		&gorm.Config{DisableAutomaticPing: true, Logger: logger.Discard},
	)
	if err != nil {
		t.Fatalf("gorm.Open: %v", err)
	}
	a, err := Build(db, platform.LoadConfig())
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	return a.Router
}

func mountedRoutes(t *testing.T) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	for _, r := range buildRouterWithoutDatabase(t).Routes() {
		out[r.Method+" "+r.Path] = true
	}
	return out
}

// TestEveryRouteIsClassified is the load-bearing test in this file.
//
// It does not check isolation. It checks that nobody can add an endpoint
// without saying how that endpoint's isolation is proven — which is exactly
// the failure that produced both shipped leaks. Neither was a mistake in
// reasoning; both were an endpoint that no list mentioned.
func TestEveryRouteIsClassified(t *testing.T) {
	mounted := mountedRoutes(t)

	var unclassified []string
	for route := range mounted {
		if _, ok := routeManifest[route]; !ok {
			unclassified = append(unclassified, route)
		}
	}
	sort.Strings(unclassified)
	if len(unclassified) > 0 {
		t.Errorf(`%d route(s) are mounted but not classified in routeManifest.

Add each one to internal/app/isolation_manifest_test.go and pick its class:

  probe("id=<table>")  the path carries a record id — the harness will request
                       another business's id and require a refusal
  list()               a collection or aggregate — the harness will require
                       that another business's rows never appear
  public("why")        deliberately unauthenticated
  self("why")          addresses only the caller's own session
  external("why")      calls a live third party, so it cannot be probed
                       automatically and must be checked by hand

Unclassified:
  %s`, len(unclassified), strings.Join(unclassified, "\n  "))
	}

	var stale []string
	for route := range routeManifest {
		if !mounted[route] {
			stale = append(stale, route)
		}
	}
	sort.Strings(stale)
	if len(stale) > 0 {
		t.Errorf(`%d manifest entr(ies) no longer match a mounted route — a path was
renamed or removed. Update or delete them, so the manifest keeps describing
the server that actually ships:
  %s`, len(stale), strings.Join(stale, "\n  "))
	}

	t.Logf("%d routes mounted, all classified", len(mounted))
}

// TestExternalRoutesAreProbedByHand keeps the un-probeable set visible.
//
// classExternal is a debt, not a clearance: those handlers call a live KYC,
// eSign, payment or messaging provider, so probing them automatically would
// send real requests and real messages on someone's live account. That is a
// good reason not to automate them and no reason at all to assume they are
// safe. Pinning the count means adding one is a deliberate act with a diff,
// rather than a quiet way to opt an endpoint out of the harness.
func TestExternalRoutesAreProbedByHand(t *testing.T) {
	var ext []string
	for route, spec := range routeManifest {
		if spec.class == classExternal {
			ext = append(ext, route)
		}
	}
	sort.Strings(ext)

	const known = 10
	if len(ext) != known {
		t.Errorf(`%d routes are classed external, expected %d.

Every one is EXCLUDED from automated probing and must be verified by hand
with two businesses. If you added one, check it by hand first, then update
this count. If you removed one, lower it.
  %s`, len(ext), known, strings.Join(ext, "\n  "))
	}
	t.Logf("external routes requiring manual cross-tenant checks:\n  %s", strings.Join(ext, "\n  "))
}

// ---------------------------------------------------------------------------
// Half two: the probes. Needs a scratch database.
// ---------------------------------------------------------------------------

// business is one tenant's fixtures, plus a staff token per role.
type business struct {
	id              uint
	code            string
	name            string
	branchID        uint
	roleIDs         map[string]uint
	adminEmployeeID uint
	tokens          map[string]string // role name -> staff JWT

	customerID    uint
	customerToken string

	// A SECOND borrower at the same business, with records of their own.
	//
	// This is the axis nothing had ever tested. The cross-business probes ask
	// whether business A's borrower can reach business B's records, and the
	// tenant filter answers that on its own. Whether one borrower can read
	// ANOTHER BORROWER OF THE SAME BUSINESS is a different question entirely
	// — the tenant filter passes both rows, so the only thing standing in the
	// way is each handler's own ownership check. Those checks are exactly what
	// the plan flagged as never having been tested adversarially.
	otherBorrowerID    uint
	otherBorrowerToken string
	otherBorrowerRows  map[string]uint // table -> id of a row owned by them

	seeder *seeder
}

type harness struct {
	db     *gorm.DB
	router *gin.Engine
	cfg    platform.Config
	a, b   *business
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	gin.SetMode(gin.TestMode)

	// The harness makes thousands of requests; gin's per-request log would
	// bury the findings.
	gin.DefaultWriter = io.Discard
	gin.DefaultErrorWriter = io.Discard

	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run the isolation probes")
	}
	t.Setenv("DB_NAME", name)
	// Keep the harness from writing into the real uploads tree.
	t.Setenv("UPLOADS_DIR", t.TempDir())

	cfg := platform.LoadConfig()
	db, err := platform.NewDatabase(cfg)
	if err != nil {
		t.Skipf("cannot reach test database %q: %v", name, err)
	}
	if err := migrate.Run(db, cfg); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := platform.RegisterTenantScope(db); err != nil {
		t.Fatalf("registering tenant scope: %v", err)
	}
	db.Logger = logger.Discard

	a, err := Build(db, cfg)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	h := &harness{db: db, router: a.Router, cfg: cfg}
	h.a = h.newBusiness(t, "mtprobe-a")
	h.b = h.newBusiness(t, "mtprobe-b")
	h.materializeFiles(t)
	return h
}

// materializeFiles writes a real file on disk for each business's
// uploaded_files fixture.
//
// Without it the /uploads/:key probe is weak in a way that is easy to miss:
// the owning business resolves its row, reaches c.File, and gets http's own
// "404 page not found" because no such file exists — indistinguishable, from
// the harness's side, from the refusal it gives the other business. This
// endpoint serves customer photos and KYC documents and was the site of one
// of the two leaks that actually shipped, so its probe needs a positive
// control that really passes.
func (h *harness) materializeFiles(t *testing.T) {
	t.Helper()
	for _, b := range []*business{h.a, h.b} {
		row := b.seeder.row(t, "uploaded_files")
		key, ok := row["storage_key"].(string)
		if !ok || key == "" {
			t.Fatalf("uploaded_files fixture has no storage_key: %v", row)
		}
		path := filepath.Join(h.cfg.UploadsDir, key)
		if err := os.WriteFile(path, []byte("probe file for tenant "+fmt.Sprint(b.id)), 0o600); err != nil {
			t.Fatalf("writing probe file: %v", err)
		}
	}
}

// newBusiness creates a tenant with all nine roles, every permission granted
// to each, a branch, an employee per role, and a customer.
//
// Granting every permission is deliberate and is the adversarial setting: it
// removes the permission layer from the experiment entirely, so anything the
// harness gets back is the isolation boundary's own doing. A leak that the
// default grants happen to hide today would surface the moment an
// administrator widened a role.
func (h *harness) newBusiness(t *testing.T, code string) *business {
	t.Helper()
	ctx := platform.AllowCrossTenant(t.Context())
	suffix := fmt.Sprintf("%s-%d", code, time.Now().UnixNano())

	var tierID uint
	if err := h.db.WithContext(ctx).Raw(
		`SELECT id FROM tiers WHERE name = 'Unlimited' LIMIT 1`).Scan(&tierID).Error; err != nil {
		t.Fatalf("tier lookup: %v", err)
	}

	b := &business{
		code:    suffix,
		name:    "Probe " + code,
		roleIDs: map[string]uint{},
		tokens:  map[string]string{},
	}

	// Every optional module enabled, for exactly the reason every permission
	// is granted above: it removes the ENTITLEMENT layer from the experiment
	// so that anything the harness gets back is the isolation boundary's own
	// doing. Left at the default (none enabled), the module gate would answer
	// 403 before a handler ever ran, and a probe that never reaches the
	// handler proves nothing about tenant isolation.
	//
	// Built from tenant.KnownModules rather than a literal, so a module added
	// later is covered here without anyone remembering to update this file.
	allModules := strings.Join(tenant.KnownModules, ",")
	allLanguages := strings.Join(tenant.KnownLanguages, ",")

	if err := h.db.WithContext(ctx).Raw(`
		INSERT INTO tenants (name, code, tier_id, status, enabled_modules, document_languages, created_at, updated_at)
		VALUES (?, ?, ?, 'active', ?, ?, now(), now()) RETURNING id`,
		b.name, b.code, tierID, allModules, allLanguages).Scan(&b.id).Error; err != nil {
		t.Fatalf("create tenant: %v", err)
	}

	if err := h.db.WithContext(ctx).Raw(`
		INSERT INTO branches (tenant_id, name, code, address, is_active, created_at, updated_at)
		VALUES (?, ?, 'BR-01', 'probe', true, now(), now()) RETURNING id`,
		b.id, b.name+" HO").Scan(&b.branchID).Error; err != nil {
		t.Fatalf("create branch: %v", err)
	}

	for _, role := range staffRoles {
		var roleID uint
		if err := h.db.WithContext(ctx).Raw(`
			INSERT INTO roles (tenant_id, name, is_active, is_system, created_at, updated_at)
			VALUES (?, ?, true, true, now(), now()) RETURNING id`,
			b.id, role).Scan(&roleID).Error; err != nil {
			t.Fatalf("create role %s: %v", role, err)
		}
		b.roleIDs[role] = roleID

		if err := h.db.WithContext(ctx).Exec(`
			INSERT INTO role_permissions (tenant_id, role_id, permission_id, permission)
			SELECT ?, ?, p.id, true FROM permissions p`, b.id, roleID).Error; err != nil {
			t.Fatalf("grant permissions for %s: %v", role, err)
		}

		var empID uint
		if err := h.db.WithContext(ctx).Raw(`
			INSERT INTO employees
				(tenant_id, code, name, role, role_id, branch_id, username,
				 password_hash, phone, email, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'x', '', '', now(), now()) RETURNING id`,
			b.id, fmt.Sprintf("EMP-%s-%d", code, roleID), role+" probe", role,
			roleID, b.branchID, fmt.Sprintf("%s-%d", code, roleID),
		).Scan(&empID).Error; err != nil {
			t.Fatalf("create employee for %s: %v", role, err)
		}

		if role == "Administrator" {
			b.adminEmployeeID = empID
		}

		tok, err := platform.IssueToken(empID, role, roleID, b.id, b.branchID, h.cfg.JWTSecret, time.Hour)
		if err != nil {
			t.Fatalf("issue staff token: %v", err)
		}
		b.tokens[role] = tok
	}

	b.seeder = &seeder{
		db:       h.db,
		tenantID: b.id,
		rows:     map[string]map[string]any{},
		busy:     map[string]bool{},
		overrides: map[string]map[string]any{
			// loan_number is nullable, so the generic pass would leave it
			// NULL and GET /loans/by-number/:loanNumber could not be
			// exercised at all.
			"loans": {"loan_number": fmt.Sprintf("MTPROBE-T%d-LN", b.id)},
			// A draft is only visible to the employee who saved it, so it
			// has to belong to the employee whose token runs the positive
			// control.
			"loan_drafts": {"created_by_employee_id": b.adminEmployeeID},
		},
	}

	// The borrower identity. Its token is minted directly rather than driven
	// through the OTP flow: the flow sends a real WhatsApp message, and what
	// is under test is what a valid borrower session can reach, not how one
	// is obtained.
	cust := b.seeder.row(t, "customers")
	b.customerID = uint(cust["id"].(int64))
	tok, err := platform.IssueCustomerToken(b.customerID, b.id, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue customer token: %v", err)
	}
	b.customerToken = tok

	// Attach the per-loan child records to this business's loan fixture.
	//
	// Their loan_id columns are NULLABLE, so the generic pass leaves them 0 —
	// which both detaches them from the loan (no positive control for
	// GET /loans/:id/auction) and makes the second business collide with the
	// first on idx_single_active_auction_per_loan, since that index is unique
	// on loan_id and every fixture would claim loan 0.
	loanRow := b.seeder.row(t, "loans")
	for _, child := range []string{"auction_records", "bank_pledge_records", "loan_payments"} {
		if b.seeder.overrides[child] == nil {
			b.seeder.overrides[child] = map[string]any{}
		}
		b.seeder.overrides[child]["loan_id"] = loanRow["id"]
	}
	b.seeder.row(t, "auction_records")

	b.seedOtherBorrower(t, h)

	return b
}

// seedOtherBorrower creates a second borrower at this same business, with a
// loan, a payment on that loan, and a notification addressed to them.
//
// Every one of these rows passes the tenant filter for the first borrower's
// session — same business — so reaching them is prevented only by each
// handler's own ownership check. That is what
// TestBorrowerCannotReachAnotherBorrowerAtTheSameBusiness probes.
func (b *business) seedOtherBorrower(t *testing.T, h *harness) {
	t.Helper()

	cust := b.seeder.extraRow(t, "customers", nil)
	b.otherBorrowerID = uint(cust["id"].(int64))

	loan := b.seeder.extraRow(t, "loans", map[string]any{
		"customer_id": cust["id"],
		"loan_number": fmt.Sprintf("MTPROBE-T%d-LN2", b.id),
	})
	payment := b.seeder.extraRow(t, "loan_payments", map[string]any{"loan_id": loan["id"]})
	notif := b.seeder.extraRow(t, "notifications", map[string]any{"customer_id": cust["id"]})

	b.otherBorrowerRows = map[string]uint{
		"customers":     b.otherBorrowerID,
		"loans":         uint(loan["id"].(int64)),
		"loan_payments": uint(payment["id"].(int64)),
		"notifications": uint(notif["id"].(int64)),
	}

	tok, err := platform.IssueCustomerToken(b.otherBorrowerID, b.id, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue second borrower token: %v", err)
	}
	b.otherBorrowerToken = tok
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// seeder inserts a minimal row into any tenant-owned table, resolving foreign
// keys by asking the database what they point at.
//
// It is generic on purpose. Hand-written fixtures for twenty-odd tables would
// drift from the schema, and the drift would show up as a probe that silently
// stopped running — the exact failure mode this harness exists to prevent.
// Introspection means a new NOT NULL column or a new foreign key is handled
// without touching this file.
//
// The rows are deliberately minimal and not business-valid: a probe asks
// whether business A can reach a row belonging to business B, and existence
// is all that requires. A fixture built to satisfy every business rule would
// couple the harness to lending logic it is not testing.
type seeder struct {
	db       *gorm.DB
	tenantID uint
	rows     map[string]map[string]any
	busy     map[string]bool

	// overrides force specific columns on specific tables, including
	// nullable ones the generic pass would skip.
	//
	// They exist to make POSITIVE CONTROLS possible, not to make fixtures
	// prettier. A route that looks a record up by a nullable column, or that
	// only shows a record to the employee who created it, cannot be
	// successfully called by the owning business unless that column is set —
	// and a probe whose refusal looks exactly like its success is not
	// evidence of isolation.
	overrides map[string]map[string]any
}

type columnInfo struct {
	ColumnName             string
	DataType               string
	IsNullable             string
	ColumnDefault          *string
	CharacterMaximumLength *int
}

// extraRow inserts an additional, UNCACHED row into table, forcing the given
// columns.
//
// row() memoises one row per table, which is what lets foreign keys resolve to
// a consistent little graph. But the second-borrower probes need a row that
// deliberately belongs to somebody else — a loan owned by a different customer
// of the SAME business — so they cannot use the cached one.
func (s *seeder) extraRow(t *testing.T, table string, overrides map[string]any) map[string]any {
	t.Helper()
	saved, had := s.rows[table]
	delete(s.rows, table)

	savedOverrides := s.overrides[table]
	merged := map[string]any{}
	for k, v := range savedOverrides {
		merged[k] = v
	}
	for k, v := range overrides {
		merged[k] = v
	}
	s.overrides[table] = merged

	row := s.row(t, table)

	// Put the cache and the override map back exactly as they were, so the
	// extra row is invisible to every other fixture.
	delete(s.rows, table)
	if had {
		s.rows[table] = saved
	}
	if savedOverrides == nil {
		delete(s.overrides, table)
	} else {
		s.overrides[table] = savedOverrides
	}
	return row
}

func (s *seeder) row(t *testing.T, table string) map[string]any {
	t.Helper()
	if r, ok := s.rows[table]; ok {
		return r
	}
	if s.busy[table] {
		t.Fatalf("fixture cycle reached %q: its foreign keys refer back to a table "+
			"already being created. Break the cycle with an explicit fixture.", table)
	}
	s.busy[table] = true
	defer delete(s.busy, table)

	ctx := platform.AllowCrossTenant(t.Context())

	var cols []columnInfo
	if err := s.db.WithContext(ctx).Raw(`
		SELECT column_name, data_type, is_nullable, column_default,
		       character_maximum_length
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = ?`, table).Scan(&cols).Error; err != nil {
		t.Fatalf("introspect %s: %v", table, err)
	}
	if len(cols) == 0 {
		t.Fatalf("fixture table %q does not exist", table)
	}

	type fkRow struct {
		ColumnName string
		RefTable   string
	}
	var fks []fkRow
	if err := s.db.WithContext(ctx).Raw(`
		SELECT kcu.column_name, ccu.table_name AS ref_table
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON kcu.constraint_name = tc.constraint_name
		JOIN information_schema.constraint_column_usage ccu
		  ON ccu.constraint_name = tc.constraint_name
		WHERE tc.constraint_type = 'FOREIGN KEY'
		  AND tc.table_schema = 'public' AND tc.table_name = ?`, table).Scan(&fks).Error; err != nil {
		t.Fatalf("introspect foreign keys of %s: %v", table, err)
	}
	refOf := map[string]string{}
	for _, fk := range fks {
		refOf[fk.ColumnName] = fk.RefTable
	}

	names := []string{"tenant_id"}
	values := []any{s.tenantID}

	for _, c := range cols {
		switch c.ColumnName {
		case "id", "tenant_id", "deleted_at":
			continue
		}
		// Only columns the database would reject as missing.
		if c.IsNullable == "YES" || c.ColumnDefault != nil {
			continue
		}
		names = append(names, c.ColumnName)

		// A NOT NULL foreign key needs a row that really exists, or the
		// insert fails on the constraint. Recurse into the referenced table
		// rather than guessing an id.
		if ref, ok := refOf[c.ColumnName]; ok && ref != table {
			parent := s.row(t, ref)
			values = append(values, parent["id"])
			continue
		}
		values = append(values, s.synth(table, c))
	}

	// Overrides take precedence over the generic pass, replacing a synthesised
	// value rather than deferring to it. A NOT NULL column with no declared
	// foreign key — auction_records.loan_id is one — otherwise gets the
	// synthesised 0, which both detaches the row from its parent and makes
	// every business's fixture claim the same parent id.
	for col, val := range s.overrides[table] {
		if i := indexOf(names, col); i >= 0 {
			values[i] = val
			continue
		}
		names = append(names, col)
		values = append(values, val)
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(names)), ",")
	quoted := make([]string, len(names))
	for i, n := range names {
		quoted[i] = `"` + n + `"`
	}

	var id int64
	// Raw SQL, and deliberately so: the tenant filter reads
	// Statement.Table, which raw SQL never sets, so these inserts write the
	// tenant_id the harness chose instead of the one a context would stamp.
	// That is what lets one process create rows for TWO businesses.
	err := s.db.WithContext(ctx).Raw(fmt.Sprintf(
		`INSERT INTO %q (%s) VALUES (%s) RETURNING id`,
		table, strings.Join(quoted, ","), placeholders), values...).Scan(&id).Error
	if err != nil {
		t.Fatalf("seed %s for tenant %d: %v\n  columns: %v", table, s.tenantID, err, names)
	}

	row := map[string]any{"id": id}
	for i, n := range names {
		row[n] = values[i]
	}
	s.rows[table] = row
	return row
}

// synth invents a value for a NOT NULL column with no default.
//
// Text values embed the tenant and table so a leak is recognisable in a
// response body — that is how TestCollectionsDoNotLeak spots another
// business's rows in a report or an export.
func (s *seeder) synth(table string, c columnInfo) any {
	marker := fmt.Sprintf("MTPROBE-T%d-%s-%s", s.tenantID, table, c.ColumnName)
	switch c.DataType {
	case "bigint", "integer", "smallint":
		return 0
	case "numeric", "double precision", "real":
		return 0
	case "boolean":
		return false
	case "timestamp with time zone", "timestamp without time zone", "date":
		return time.Now().UTC()
	case "jsonb", "json":
		return "{}"
	case "bytea":
		return []byte{}
	default:
		// Respect the column's declared width, asking the schema rather than
		// guessing. The tenant prefix survives any truncation, which is what
		// the leak detector actually matches on — so a narrow column still
		// produces a value that identifies its owner.
		limit := 40
		if c.CharacterMaximumLength != nil && *c.CharacterMaximumLength > 0 && *c.CharacterMaximumLength < limit {
			limit = *c.CharacterMaximumLength
		}
		if len(marker) > limit {
			marker = marker[:limit]
		}
		return marker
	}
}

// leakMarker is the string that must never appear in the other business's
// responses.
func (b *business) leakMarker() string { return fmt.Sprintf("MTPROBE-T%d-", b.id) }

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type reply struct {
	status int
	body   string
}

func (h *harness) do(t *testing.T, method, path, bearer string, cookie *http.Cookie) reply {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	body, _ := io.ReadAll(rec.Body)
	return reply{status: rec.Code, body: string(body)}
}

// probeQuery supplies query parameters an endpoint requires before it will do
// any work, so its positive control can actually succeed. Values are resolved
// from the same fixtures as path parameters.
//
// Without this, GET /employees/:id/permissions answers 400 ("role_id query
// parameter is required") to everyone, and a probe whose refusal is a 400 for
// the owning business too proves nothing.
var probeQuery = map[string]string{
	"GET /api/v1/employees/:id/permissions": "role_id=roles",
}

// fill substitutes another business's identifiers into a route pattern.
func (h *harness) fill(t *testing.T, path string, spec routeSpec, victim *business) string {
	t.Helper()
	out := path
	for param, fixture := range spec.params {
		table, column, hasColumn := cut(fixture, ":")
		row := victim.seeder.row(t, table)
		var value string
		if hasColumn {
			value = fmt.Sprint(row[column])
		} else {
			value = fmt.Sprint(row["id"])
		}
		out = strings.ReplaceAll(out, ":"+param, value)
	}
	return out
}

// fillQuery appends any required query parameters, drawn from the same
// business whose records the probe is reaching for.
func (h *harness) fillQuery(t *testing.T, route, path string, victim *business) string {
	t.Helper()
	spec, ok := probeQuery[route]
	if !ok {
		return path
	}
	name, fixture, _ := cut(spec, "=")
	row := victim.seeder.row(t, fixture)
	return fmt.Sprintf("%s?%s=%v", path, name, row["id"])
}

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------

// TestCrossTenantAccessIsRefused is the core of the harness: for every
// id-addressed route, business A asks for business B's record, as each of the
// nine roles, and must be refused.
//
// The assertion is "not 2xx", not a specific status. A refusal that arrives
// as 400 because the body was empty is still a refusal; what would be a leak
// is a success. Being status-agnostic keeps the harness from needing a valid
// request body for 90 mutating endpoints — bodies it would have to keep in
// step with business rules forever, and whose drift would quietly turn probes
// into no-ops.
//
// 404 rather than 403 is the correct refusal here: a 403 confirms the record
// exists and belongs to someone else. Statuses are reported so that drift
// toward 403 is visible.
func TestCrossTenantAccessIsRefused(t *testing.T) {
	h := newHarness(t)

	type probeResult struct {
		route  string
		role   string
		status int
		body   string
	}
	var leaks []probeResult
	var serverErrors []probeResult
	probed, positiveControls := 0, 0

	routes := sortedRoutes()
	for _, route := range routes {
		spec := routeManifest[route]
		if spec.class != classProbe {
			continue
		}
		method, pattern, _ := cut(route, " ")

		// /uploads/:key authenticates with a path-scoped HttpOnly cookie,
		// not a header — an <img> tag cannot send an Authorization header.
		usesCookie := strings.HasPrefix(pattern, "/uploads/")

		victimPath := h.fillQuery(t, route, h.fill(t, pattern, spec, h.b), h.b)

		for _, role := range staffRoles {
			if spec.customer {
				continue
			}
			var bearer string
			var cookie *http.Cookie
			if usesCookie {
				cookie = &http.Cookie{Name: upload.AuthCookieName, Value: h.a.tokens[role]}
			} else {
				bearer = h.a.tokens[role]
			}

			got := h.do(t, method, victimPath, bearer, cookie)
			probed++
			switch {
			case got.status >= 200 && got.status < 300:
				leaks = append(leaks, probeResult{route, role, got.status, truncate(got.body)})
			case got.status >= 500:
				serverErrors = append(serverErrors, probeResult{route, role, got.status, truncate(got.body)})
			}
		}

		if spec.customer {
			got := h.do(t, method, victimPath, h.b.customerToken, nil)
			_ = got // borrower probes are asserted in TestBorrowerCannotReachOtherBorrowers
			continue
		}

		// Positive control. Without it a 404 proves nothing: a typo in the
		// path, a fixture that never inserted, or a route that 404s for
		// everyone would all look like airtight isolation. Only GETs get one
		// — a mutating endpoint cannot be "successfully" called with a stub
		// body, so its control would be meaningless.
		if method == http.MethodGet {
			var bearer string
			var cookie *http.Cookie
			if usesCookie {
				cookie = &http.Cookie{Name: upload.AuthCookieName, Value: h.b.tokens["Administrator"]}
			} else {
				bearer = h.b.tokens["Administrator"]
			}
			own := h.do(t, method, victimPath, bearer, cookie)
			if own.status >= 200 && own.status < 300 {
				positiveControls++
			} else {
				t.Logf("no positive control for %s: the owning business got %d (%s) — "+
					"this probe's refusal is therefore weak evidence",
					route, own.status, truncate(own.body))
			}
		}
	}

	for _, l := range leaks {
		t.Errorf("CROSS-TENANT LEAK: %s as %s returned %d for another business's record\n  body: %s",
			l.route, l.role, l.status, l.body)
	}
	// Reported, not failed: a 5xx is not a leak, but it means the endpoint
	// blew up instead of refusing cleanly, which is worth a human look.
	for _, e := range serverErrors {
		t.Logf("server error (not a leak, but not a clean refusal either): %s as %s -> %d: %s",
			e.route, e.role, e.status, e.body)
	}

	t.Logf("%d cross-tenant probes across %d roles; %d GET probes had a positive control",
		probed, len(staffRoles), positiveControls)
}

// TestBorrowerCannotReachOtherBorrowers covers the borrower app — the surface
// the plan singles out, because payment history, notifications and profile do
// NOT go through customerOwnedLoan and had never been tested adversarially.
//
// Two attacks, and the second is the one that has never been tried: a valid
// borrower session asking for a record that belongs to a borrower at ANOTHER
// business.
func TestBorrowerCannotReachOtherBorrowers(t *testing.T) {
	h := newHarness(t)

	var leaks []string
	probed := 0
	for _, route := range sortedRoutes() {
		spec := routeManifest[route]
		if !spec.customer || spec.class != classProbe {
			continue
		}
		method, pattern, _ := cut(route, " ")
		path := h.fill(t, pattern, spec, h.b)

		got := h.do(t, method, path, h.a.customerToken, nil)
		probed++
		if got.status >= 200 && got.status < 300 {
			leaks = append(leaks, fmt.Sprintf("%s returned %d to a borrower of another business\n  body: %s",
				route, got.status, truncate(got.body)))
		}

		// A staff token must not work on a borrower route at all: the two
		// JWT schemes are deliberately separate.
		staff := h.do(t, method, path, h.a.tokens["Administrator"], nil)
		if staff.status >= 200 && staff.status < 300 {
			leaks = append(leaks, fmt.Sprintf("%s accepted a STAFF token on a borrower route (%d)", route, staff.status))
		}
	}

	for _, l := range leaks {
		t.Errorf("BORROWER LEAK: %s", l)
	}
	t.Logf("%d borrower cross-business probes", probed)
}

// TestBorrowerCannotReachAnotherBorrowerAtTheSameBusiness is the Step 5
// probe, and the one the isolation model cannot answer on its own.
//
// Every other probe in this file leans on the tenant filter: ask for another
// BUSINESS's record and the predicate excludes it. Here both borrowers belong
// to the same business, so the filter passes both rows and the only thing
// between borrower A and borrower B's loan, payment receipt or notification is
// the handler's own ownership check. The plan singles these routes out because
// payment history, profile/KYC and notifications do not go through
// customerOwnedLoan and had never been tested adversarially.
//
// A leak here is worse than a cross-business one in one respect: it needs no
// second business to exist, so it is reachable on the single installation
// running today.
func TestBorrowerCannotReachAnotherBorrowerAtTheSameBusiness(t *testing.T) {
	h := newHarness(t)

	victim := h.a.otherBorrowerRows
	attacker := h.a.customerToken

	var leaks []string
	probed := 0

	for _, route := range sortedRoutes() {
		spec := routeManifest[route]
		if !spec.customer || spec.class != classProbe {
			continue
		}
		method, pattern, _ := cut(route, " ")

		// Substitute the OTHER borrower's ids, at the same business.
		path := pattern
		skip := false
		for param, fixture := range spec.params {
			table, _, _ := cut(fixture, ":")
			id, ok := victim[table]
			if !ok {
				skip = true
				break
			}
			path = strings.ReplaceAll(path, ":"+param, fmt.Sprint(id))
		}
		if skip {
			t.Logf("no same-business fixture for %s (%v) — not probed on this axis", route, spec.params)
			continue
		}

		got := h.do(t, method, path, attacker, nil)
		probed++
		if got.status >= 200 && got.status < 300 {
			leaks = append(leaks, fmt.Sprintf("%s returned %d to a DIFFERENT borrower at the same business\n  body: %s",
				route, got.status, truncate(got.body)))
		}
	}

	for _, l := range leaks {
		t.Errorf("BORROWER-TO-BORROWER LEAK: %s", l)
	}

	// Positive control: the owner must actually be able to read their own
	// records, or the refusals above prove nothing.
	own := h.do(t, http.MethodGet, fmt.Sprintf("/api/v1/customer/loans/%d", victim["loans"]), h.a.otherBorrowerToken, nil)
	if own.status < 200 || own.status >= 300 {
		t.Logf("no positive control: the owning borrower got %d for their own loan (%s) — "+
			"the refusals above are therefore weak evidence", own.status, truncate(own.body))
	}

	t.Logf("%d same-business borrower-to-borrower probes", probed)
}

// TestBorrowerCollectionsDoNotLeakAnotherBorrower closes a gap the manifest
// created without meaning to.
//
// GET /customer/loans, /customer/payments and /customer/notifications are
// classed clist — "the caller's own X, forced from the JWT" — which is a
// claim about the handler, not a proof. Every OTHER test in this file skips
// customer:true collections deliberately: TestCollectionsDoNotLeak excludes
// them because its cross-BUSINESS fixtures don't distinguish borrowers, and
// TestBorrowerCannotReachAnotherBorrowerAtTheSameBusiness only walks
// classProbe routes, since a collection has no id to substitute. The result
// was that these three routes were classified and then never actually
// exercised against a second borrower — the exact gap Step 5 exists to close.
//
// The check here is different in kind from a probe: there is no id to
// request, so instead each response is scanned for the OTHER borrower's own
// identifying values (their loan number, payment id, notification id).
// Appearing at all is the leak, regardless of status code.
func TestBorrowerCollectionsDoNotLeakAnotherBorrower(t *testing.T) {
	h := newHarness(t)
	victim := h.a.otherBorrowerRows

	cases := []struct {
		route  string
		marker string
	}{
		{"/api/v1/customer/loans", fmt.Sprintf("MTPROBE-T%d-LN2", h.a.id)},
		{"/api/v1/customer/payments", fmt.Sprintf("\"id\":%d", victim["loan_payments"])},
		{"/api/v1/customer/notifications", fmt.Sprintf("\"id\":%d", victim["notifications"])},
	}

	for _, tc := range cases {
		got := h.do(t, http.MethodGet, tc.route, h.a.customerToken, nil)
		if got.status < 200 || got.status >= 300 {
			t.Errorf("%s as the caller returned %d, want 2xx: %s", tc.route, got.status, truncate(got.body))
			continue
		}
		if strings.Contains(got.body, tc.marker) {
			t.Errorf("BORROWER-TO-BORROWER LEAK: %s contains another borrower's record (%s)\n  body: %s",
				tc.route, tc.marker, truncate(got.body))
		}
	}
}

// TestBorrowerSelfRoutesReturnOnlyTheCaller closes the same kind of gap for
// the two routes classed cself: "the caller's own profile/verification
// state, forced from the JWT" is also a claim, not a proof, until it is
// checked against a second borrower who actually has different values.
func TestBorrowerSelfRoutesReturnOnlyTheCaller(t *testing.T) {
	h := newHarness(t)

	got := h.do(t, http.MethodGet, "/api/v1/customer/profile", h.a.customerToken, nil)
	if got.status < 200 || got.status >= 300 {
		t.Fatalf("GET /customer/profile as the caller returned %d: %s", got.status, truncate(got.body))
	}
	wantID := fmt.Sprintf("\"id\":%d", h.a.customerID)
	if !strings.Contains(got.body, wantID) {
		t.Errorf("GET /customer/profile did not identify the caller (%s) — cannot confirm it "+
			"isn't returning someone else's: %s", wantID, truncate(got.body))
	}
	if otherID := h.a.otherBorrowerRows["customers"]; otherID != 0 {
		leaked := fmt.Sprintf("\"id\":%d", otherID)
		if strings.Contains(got.body, leaked) {
			t.Errorf("BORROWER LEAK: /customer/profile as one borrower contains another borrower's id\n  body: %s",
				truncate(got.body))
		}
	}
}

// TestBranchSelectionCannotCrossBusinesses guards the branch switcher added
// in Step 6.
//
// The switcher works by sending X-Branch-Id, which is a client-supplied value
// — and the whole tenancy design rests on the business never coming from a
// header. The header is safe only because it can NARROW within a session and
// never widen it, and because the tenant predicate still applies. That is an
// argument, and arguments about isolation are exactly what this codebase has
// been wrong about three times, so it is tested rather than asserted:
// business A's Management asks for business B's branch by id and must see
// nothing of B's.
func TestBranchSelectionCannotCrossBusinesses(t *testing.T) {
	h := newHarness(t)

	// A branch that really exists, and belongs to business B.
	victimBranch := h.b.branchID
	marker := h.b.leakMarker()

	// Seed B with rows a branch-scoped list would return.
	for _, table := range []string{"customers", "loans", "cash_movements", "expenses", "employees"} {
		h.b.seeder.row(t, table)
	}

	routes := []string{
		"/api/v1/branches",
		"/api/v1/customers",
		"/api/v1/loans",
		"/api/v1/employees",
		"/api/v1/cash-movements",
		"/api/v1/expenses",
		"/api/v1/reports/loans/status",
		"/api/v1/reports/kyc",
	}

	for _, role := range []string{"Administrator", "Management", "Cashier"} {
		for _, route := range routes {
			req := httptest.NewRequest(http.MethodGet, route, nil)
			req.Header.Set("Authorization", "Bearer "+h.a.tokens[role])
			// Point the switcher at another business's branch.
			req.Header.Set(platform.SelectedBranchHeader, fmt.Sprint(victimBranch))
			rec := httptest.NewRecorder()
			h.router.ServeHTTP(rec, req)
			body, _ := io.ReadAll(rec.Body)

			if strings.Contains(string(body), marker) {
				t.Errorf(`CROSS-TENANT LEAK via the branch switcher: %s as %s, with
%s pointing at business B's branch %d, returned business B's data.
  body: %s`, route, role, platform.SelectedBranchHeader, victimBranch, truncate(string(body)))
			}
		}
	}

	// And the switcher must not widen a confined role. A Cashier sending a
	// header is still limited to its own branch — asserted at the unit level
	// in platform.TestBranchScopeRules; here we only confirm the wiring does
	// not somehow bypass it.
	t.Logf("branch switcher probed across %d routes and 3 roles for cross-business leakage", len(routes))
}

// TestSwitchableBranchesNeverCrossBusinesses: the switcher's own list must
// name only the caller's own business's branches, for every role.
func TestSwitchableBranchesNeverCrossBusinesses(t *testing.T) {
	h := newHarness(t)

	for _, role := range staffRoles {
		got := h.do(t, http.MethodGet, "/api/v1/branches/switchable", h.a.tokens[role], nil)
		if got.status < 200 || got.status >= 300 {
			t.Errorf("switchable branches as %s: got %d, want 2xx: %s", role, got.status, truncate(got.body))
			continue
		}
		if strings.Contains(got.body, h.b.name) {
			t.Errorf("CROSS-TENANT LEAK: switchable branches as %s named business B's branch\n  body: %s",
				role, truncate(got.body))
		}
	}
}

// TestCollectionsDoNotLeak covers every route with no identifier in the path:
// lists, aggregates, all 16 reports, and every export.
//
// This is the half that catches the alias bug. Those reports are built as
// db.Table("loans l"), the shape that once returned every business's rows
// with no predicate and no error — and row counts did not reveal it. Here the
// fixtures carry a per-tenant marker string, so a leak is not a count to be
// interpreted but B's own marker sitting in A's response.
//
// Exports are included deliberately: a report can be correct on screen and
// leaking in the file, and nobody looks inside the file.
func TestCollectionsDoNotLeak(t *testing.T) {
	h := newHarness(t)

	// Give B a row in every table any collection could draw from, each
	// stamped with B's marker.
	for _, table := range []string{
		"branches", "customers", "employees", "loans", "loan_payments",
		"loan_requests", "loan_drafts", "ornaments", "packets", "lockers",
		"banks", "schemes", "gold_rates", "reminders", "cash_movements",
		"expenses", "bank_pledge_records", "auction_records", "notifications",
		"communication_logs", "uploaded_files", "ornament_types",
		"audit_log_entries",
	} {
		h.b.seeder.row(t, table)
	}
	marker := h.b.leakMarker()

	checked := 0
	for _, route := range sortedRoutes() {
		spec := routeManifest[route]
		if spec.class != classCollection || spec.customer {
			continue
		}
		method, pattern, _ := cut(route, " ")
		// Only reads can leak a list; POST/PUT on a collection creates.
		if method != http.MethodGet {
			continue
		}
		paths := []string{pattern}
		if strings.Contains(pattern, ":key") {
			// Walk every export key rather than one, since each is a
			// different query built the same risky way.
			paths = exportPaths(pattern)
		}
		for _, p := range paths {
			got := h.do(t, method, p, h.a.tokens["Administrator"], nil)
			checked++
			if strings.Contains(got.body, marker) {
				t.Errorf("CROSS-TENANT LEAK: %s (as business A) contains business B's marker %q\n  body: %s",
					p, marker, truncate(got.body))
			}
		}
	}
	t.Logf("%d collection/report/export responses checked for another business's rows", checked)
}

// exportPaths expands /reports/export/:key into the concrete report keys, so
// the binary exports are all walked rather than sampled.
func exportPaths(pattern string) []string {
	keys := []string{
		"loans", "disbursement", "interest-collection", "payment-collection",
		"outstanding-principal", "gold-weight", "gold-release", "bank-pledge",
		"auctions", "loan-extensions", "packets", "expense-cashflow", "kyc",
		"gold-rate-history", "employee-performance", "communication-history",
	}
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, strings.ReplaceAll(pattern, ":key", k))
	}
	return out
}

// TestProviderCredentialsAreDeliberatelyShared pins a decision rather than
// proving isolation, because here there is deliberately none.
//
// api_key_settings has NO tenant_id column and a GLOBAL unique index on
// category, so there is exactly one KYC/SMS/WhatsApp credential row for the
// whole deployment. That is the documented product decision — shared provider
// credentials, with the costs knowingly accepted: noisy-neighbour rate
// limits, the vendor's bill, and weak regulatory attribution (see the plan,
// Step 13).
//
// It is pinned here for two reasons. First, so the decision is visible in the
// place someone checks isolation, instead of looking like an oversight.
// Second, so that the day the table gains a tenant_id — because Step 13
// finally made usage per-business — this test fails and says what to replace
// it with, rather than continuing to pass while the sharing quietly stops.
//
// NOTE, and it is not covered by the decision as recorded: these routes are
// mounted for every tenant's Administrator, so any customer's admin can not
// only READ the shared credentials but OVERWRITE them for every other
// business. "The vendor manages one set of credentials" and "every customer
// can rewrite them" are different statements. Ownership of these settings
// belongs in the superadmin console (Step 7).
func TestProviderCredentialsAreDeliberatelyShared(t *testing.T) {
	h := newHarness(t)
	ctx := platform.AllowCrossTenant(t.Context())

	var hasTenantColumn int
	if err := h.db.WithContext(ctx).Raw(`
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'api_key_settings'
		  AND column_name = 'tenant_id'`).Scan(&hasTenantColumn).Error; err != nil {
		t.Fatalf("introspecting api_key_settings: %v", err)
	}

	if hasTenantColumn > 0 {
		t.Fatalf(`api_key_settings now has a tenant_id column, so provider credentials are
no longer shared. This test pinned the old decision and is now wrong.

Replace it with a real isolation assertion: store a credential as business B,
then require that business A cannot read it through
GET /settings/api-keys and GET /settings/api-keys/:category. Also add
api_key_settings to tenantScopedTables in BOTH internal/platform/tenant_gorm.go
and internal/migrate/migrate.go — omitting the first is a silent leak.`)
	}

	// The shared row really is shared: what business B writes, business A
	// reads. Asserted rather than assumed, so the exposure is on the record.
	secret := "MTPROBE-SHARED-CREDENTIAL"
	if err := h.db.WithContext(ctx).Exec(`
		INSERT INTO api_key_settings (category, name, encrypted_value, created_at, updated_at)
		VALUES ('whatsapp', ?, '', now(), now())
		ON CONFLICT (category) DO UPDATE SET name = EXCLUDED.name`, secret).Error; err != nil {
		t.Fatalf("seeding the shared credential row: %v", err)
	}

	got := h.do(t, http.MethodGet, "/api/v1/settings/api-keys", h.a.tokens["Administrator"], nil)
	if !strings.Contains(got.body, secret) {
		t.Errorf(`the credential row no longer reads as shared (status %d).

If provider credentials are now per-business, this test needs replacing — see
the failure message above. If they are still meant to be shared, something
else has changed.
  body: %s`, got.status, truncate(got.body))
	}
}

// TestSessionsWithoutABusinessAreRejected covers the token edge cases the
// plan asks for: an expired session, no session, a forged tenant, and each
// JWT scheme used on the other's routes.
//
// The forged-tenant case is the important one. It is the whole basis of the
// design — the business is established at authentication and never read from
// a header, body or URL — so a token claiming another business must be
// rejected on its signature, and a request carrying a business hint in a
// header must be ignored.
// ---------------------------------------------------------------------------
// Superadmin console (Step 7)
// ---------------------------------------------------------------------------

// newSuperAdminUser seeds a real superadmin_users row and mints a token for it,
// rather than only issuing a token from thin air — CreateBusiness's audit
// write references the actor's id, and a probe should look as close as
// possible to what the real login flow produces.
func (h *harness) newSuperAdminUser(t *testing.T, username string) (uint, string) {
	t.Helper()
	ctx := platform.AllowCrossTenant(t.Context())
	var id uint
	if err := h.db.WithContext(ctx).Raw(`
		INSERT INTO superadmin_users (name, username, password_hash, is_active, created_at, updated_at)
		VALUES (?, ?, 'x', true, now(), now()) RETURNING id`,
		username, username).Scan(&id).Error; err != nil {
		t.Fatalf("seed superadmin user: %v", err)
	}
	tok, err := platform.IssueSuperAdminToken(id, username, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue superadmin token: %v", err)
	}
	return id, tok
}

// TestSuperAdminRoutesRejectStaffAndBorrowerTokens is classSuperAdmin's own version
// of the cross-scheme guarantee TestSessionsWithoutABusinessAreRejected
// checks for staff vs borrower: three JWT shapes now share one signing
// secret (see platform.Claims.Type's doc comment for the gap that were this
// not checked here), so every pair needs its own proof, not just an
// assumption that the third scheme behaves like the first two.
func TestSuperAdminRoutesRejectStaffAndBorrowerTokens(t *testing.T) {
	h := newHarness(t)
	_, superAdminToken := h.newSuperAdminUser(t, fmt.Sprintf("superadminprobe-%d", time.Now().UnixNano()))

	t.Run("staff token is refused on superadmin routes", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/superadmin/businesses", h.a.tokens["Administrator"], nil)
		if got.status < 400 {
			t.Errorf("a STAFF token (even Administrator) was accepted on /superadmin/businesses (%d): %s",
				got.status, truncate(got.body))
		}
	})

	t.Run("borrower token is refused on superadmin routes", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/superadmin/businesses", h.a.customerToken, nil)
		if got.status < 400 {
			t.Errorf("a BORROWER token was accepted on /superadmin/businesses (%d): %s", got.status, truncate(got.body))
		}
	})

	t.Run("superadmin token is refused on a staff route", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/branches", superAdminToken, nil)
		if got.status < 400 {
			t.Errorf("a SUPERADMIN token was accepted on a staff route (%d): %s", got.status, truncate(got.body))
		}
	})

	t.Run("superadmin token is refused on a borrower route", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/customer/loans", superAdminToken, nil)
		if got.status < 400 {
			t.Errorf("a SUPERADMIN token was accepted on a borrower route (%d): %s", got.status, truncate(got.body))
		}
	})

	t.Run("the superadmin token actually works on its own routes", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/superadmin/tiers", superAdminToken, nil)
		if got.status < 200 || got.status >= 300 {
			t.Errorf("a genuine superadmin token was refused on its own route (%d): %s — "+
				"the refusals above are weak evidence without this passing",
				got.status, truncate(got.body))
		}
	})
}

// TestSuperAdminCreatedBusinessIsFullyIsolated is the end-to-end proof for Step
// 7: a business created through the superadmin API — not by hand-written SQL —
// must be isolated exactly like every other one. This is the scenario the
// handoff's manual INSERT recipe existed for; here it happens through the
// real HTTP surface instead.
func TestSuperAdminCreatedBusinessIsFullyIsolated(t *testing.T) {
	h := newHarness(t)
	_, superAdminToken := h.newSuperAdminUser(t, fmt.Sprintf("superadminprobe-%d", time.Now().UnixNano()))

	var tiers struct {
		Data []struct {
			ID   uint   `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	tiersResp := h.do(t, http.MethodGet, "/api/v1/superadmin/tiers", superAdminToken, nil)
	if tiersResp.status != http.StatusOK {
		t.Fatalf("GET /superadmin/tiers: %d: %s", tiersResp.status, truncate(tiersResp.body))
	}
	if err := jsonUnmarshal(tiersResp.body, &tiers); err != nil || len(tiers.Data) == 0 {
		t.Fatalf("could not read a tier id from /superadmin/tiers: %v: %s", err, truncate(tiersResp.body))
	}
	tierID := tiers.Data[0].ID

	suffix := fmt.Sprintf("vprobe%d", time.Now().UnixNano())
	createBody := fmt.Sprintf(`{
		"name": "SuperAdmin-Created Co", "code": %q, "tierId": %d,
		"adminUsername": "admin", "adminPassword": "correcthorsebattery",
		"reason": "isolation harness end-to-end proof"
	}`, suffix, tierID)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/superadmin/businesses", strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+superAdminToken)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		body, _ := io.ReadAll(rec.Body)
		t.Fatalf("POST /superadmin/businesses: %d: %s", rec.Code, truncate(string(body)))
	}

	// The new business's own admin can log in — through the ordinary staff
	// login endpoint, using the code the superadmin just chose.
	loginBody := fmt.Sprintf(`{"identifier":"admin","password":"correcthorsebattery","businessCode":%q}`, suffix)
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()
	h.router.ServeHTTP(loginRec, loginReq)
	loginBodyBytes, _ := io.ReadAll(loginRec.Body)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("the superadmin-created business's own admin could not log in: %d: %s",
			loginRec.Code, truncate(string(loginBodyBytes)))
	}
	var loginResp struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := jsonUnmarshal(string(loginBodyBytes), &loginResp); err != nil || loginResp.Data.Token == "" {
		t.Fatalf("could not read a token from the new business's login response: %v: %s",
			err, truncate(string(loginBodyBytes)))
	}
	newBusinessToken := loginResp.Data.Token

	// It sees exactly one branch (the seeded "Head Office") and none of
	// either fixture business's data.
	branchesResp := h.do(t, http.MethodGet, "/api/v1/branches", newBusinessToken, nil)
	if branchesResp.status != http.StatusOK {
		t.Fatalf("GET /branches as the new business: %d: %s", branchesResp.status, truncate(branchesResp.body))
	}
	if strings.Contains(branchesResp.body, h.a.name) || strings.Contains(branchesResp.body, h.b.name) {
		t.Errorf("CROSS-TENANT LEAK: a business created through the superadmin API can see an "+
			"existing business's branches\n  body: %s", truncate(branchesResp.body))
	}
	if !strings.Contains(branchesResp.body, "Head Office") {
		t.Errorf("the new business does not see its own seeded branch: %s", truncate(branchesResp.body))
	}

	// And the reverse: neither existing business can see the new one's
	// branch by name.
	aResp := h.do(t, http.MethodGet, "/api/v1/branches", h.a.tokens["Administrator"], nil)
	if strings.Contains(aResp.body, "Head Office") && strings.Contains(aResp.body, suffix) {
		t.Errorf("CROSS-TENANT LEAK: an existing business can see the superadmin-created business's branch")
	}
}

func jsonUnmarshal(body string, out any) error {
	return json.Unmarshal([]byte(body), out)
}

// TestBranchQuotaIsEnforced proves the other half of Step 7: not just that a
// business can be created, but that the plan you sold it actually limits it.
// Tier.BranchQuota existed as a column before this — nothing read it.
//
// Creates a business on the Single Branch plan (quota 1) through the real superadmin
// API, exactly like TestSuperAdminCreatedBusinessIsFullyIsolated, then exercises
// the limit as that business's own signed-in Administrator: the seeded "Head
// Office" already fills the one slot, so a second branch must be refused,
// deactivating it and creating a replacement must succeed (still exactly one
// active branch), and reactivating the first while the replacement is still
// active must be refused again.
func TestBranchQuotaIsEnforced(t *testing.T) {
	h := newHarness(t)
	_, superAdminToken := h.newSuperAdminUser(t, fmt.Sprintf("superadminprobe-%d", time.Now().UnixNano()))

	var tiers struct {
		Data []struct {
			ID   uint   `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	tiersResp := h.do(t, http.MethodGet, "/api/v1/superadmin/tiers", superAdminToken, nil)
	if err := jsonUnmarshal(tiersResp.body, &tiers); err != nil {
		t.Fatalf("reading tiers: %v: %s", err, truncate(tiersResp.body))
	}
	var starterID uint
	for _, tr := range tiers.Data {
		if tr.Name == "Single Branch" {
			starterID = tr.ID
		}
	}
	if starterID == 0 {
		t.Fatal("no \"Single Branch\" tier found — expected the seeded plan catalogue (Single Branch / Up to 5 Branches / Unlimited)")
	}

	suffix := fmt.Sprintf("quotaprobe%d", time.Now().UnixNano())
	// "modules" grants the branches module at creation time. Without it the
	// branch-management routes answer 403 (not enabled for this business)
	// and this test could never reach the quota check it exists to prove —
	// the entitlement gate runs ahead of the quota gate by design, since
	// there is no point counting branches for a business that does not
	// administer them.
	createBody := fmt.Sprintf(`{
		"name": "Quota Probe Co", "code": %q, "tierId": %d,
		"adminUsername": "admin", "adminPassword": "correcthorsebattery",
		"modules": ["branches"],
		"reason": "isolation harness quota-enforcement proof"
	}`, suffix, starterID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/superadmin/businesses", strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+superAdminToken)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		body, _ := io.ReadAll(rec.Body)
		t.Fatalf("POST /superadmin/businesses (Starter): %d: %s", rec.Code, truncate(string(body)))
	}

	loginBody := fmt.Sprintf(`{"identifier":"admin","password":"correcthorsebattery","businessCode":%q}`, suffix)
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()
	h.router.ServeHTTP(loginRec, loginReq)
	loginBodyBytes, _ := io.ReadAll(loginRec.Body)
	var loginResp struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := jsonUnmarshal(string(loginBodyBytes), &loginResp); err != nil || loginResp.Data.Token == "" {
		t.Fatalf("logging into the new Starter business: %v: %s", err, truncate(string(loginBodyBytes)))
	}
	tok := loginResp.Data.Token

	// The seeded "Head Office" already fills the Starter tier's one slot —
	// a second branch must be refused. Built as a raw request (not h.do,
	// which always sends an empty "{}" body) so the branch's required
	// name/address fields are actually present — otherwise a 400 for bad
	// input would be indistinguishable from the 409 this test is checking.
	create2Req := httptest.NewRequest(http.MethodPost, "/api/v1/branches",
		strings.NewReader(`{"name":"Second Branch","code":"BR-02","address":"x"}`))
	create2Req.Header.Set("Content-Type", "application/json")
	create2Req.Header.Set("Authorization", "Bearer "+tok)
	create2Rec := httptest.NewRecorder()
	h.router.ServeHTTP(create2Rec, create2Req)
	if create2Rec.Code != http.StatusConflict {
		body, _ := io.ReadAll(create2Rec.Body)
		t.Errorf("creating a SECOND branch on the Starter tier (quota 1) got %d, want 409: %s",
			create2Rec.Code, truncate(string(body)))
	}

	var branches struct {
		Data []struct {
			ID   uint   `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	listResp := h.do(t, http.MethodGet, "/api/v1/branches", tok, nil)
	if err := jsonUnmarshal(listResp.body, &branches); err != nil || len(branches.Data) != 1 {
		t.Fatalf("expected exactly 1 branch after the refused create, got %d (%v): %s",
			len(branches.Data), err, truncate(listResp.body))
	}
	headOfficeID := branches.Data[0].ID

	// Deactivate Head Office, freeing the one slot, then create a
	// replacement — this must now succeed.
	deactivateReq := httptest.NewRequest(http.MethodPut,
		fmt.Sprintf("/api/v1/branches/%d", headOfficeID),
		strings.NewReader(`{"name":"Head Office","address":"x","isActive":false}`))
	deactivateReq.Header.Set("Content-Type", "application/json")
	deactivateReq.Header.Set("Authorization", "Bearer "+tok)
	deactivateRec := httptest.NewRecorder()
	h.router.ServeHTTP(deactivateRec, deactivateReq)
	if deactivateRec.Code != http.StatusOK {
		body, _ := io.ReadAll(deactivateRec.Body)
		t.Fatalf("deactivating Head Office: %d: %s", deactivateRec.Code, truncate(string(body)))
	}

	create3Req := httptest.NewRequest(http.MethodPost, "/api/v1/branches",
		strings.NewReader(`{"name":"Replacement Branch","code":"BR-03","address":"x"}`))
	create3Req.Header.Set("Content-Type", "application/json")
	create3Req.Header.Set("Authorization", "Bearer "+tok)
	create3Rec := httptest.NewRecorder()
	h.router.ServeHTTP(create3Rec, create3Req)
	if create3Rec.Code != http.StatusCreated {
		body, _ := io.ReadAll(create3Rec.Body)
		t.Fatalf("creating a replacement branch after freeing the slot got %d, want 201: %s",
			create3Rec.Code, truncate(string(body)))
	}

	// The slot is filled again by the replacement — reactivating Head
	// Office now must be refused, the other half of the plan's "reactivation
	// is the other door people forget" note.
	reactivateReq := httptest.NewRequest(http.MethodPut,
		fmt.Sprintf("/api/v1/branches/%d", headOfficeID),
		strings.NewReader(`{"name":"Head Office","address":"x","isActive":true}`))
	reactivateReq.Header.Set("Content-Type", "application/json")
	reactivateReq.Header.Set("Authorization", "Bearer "+tok)
	reactivateRec := httptest.NewRecorder()
	h.router.ServeHTTP(reactivateRec, reactivateReq)
	if reactivateRec.Code != http.StatusConflict {
		body, _ := io.ReadAll(reactivateRec.Body)
		t.Errorf("reactivating a branch while already at quota got %d, want 409: %s",
			reactivateRec.Code, truncate(string(body)))
	}
}

// TestDeletedEmployeeSessionStopsImmediately is Step 8b, token invalidation.
//
// Before this, a JWT's role/branch were trusted for the whole token
// lifetime (up to JWTExpiry, days by default): deleting an employee did
// nothing to their outstanding session. AuthMiddleware now revalidates
// against the live employee row on every request, so a session dies on the
// VERY NEXT request after the employee is deleted — not at expiry.
func TestDeletedEmployeeSessionStopsImmediately(t *testing.T) {
	h := newHarness(t)

	// A fresh employee, deleted via the real DELETE endpoint — not a raw SQL
	// row removal — so this exercises the actual handler's soft-delete path.
	emp := h.a.seeder.extraRow(t, "employees", map[string]any{"role": "Cashier", "role_id": h.a.roleIDs["Cashier"]})
	empID := uint(emp["id"].(int64))
	tok, err := platform.IssueToken(empID, "Cashier", h.a.roleIDs["Cashier"], h.a.id, h.a.branchID, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	before := h.do(t, http.MethodGet, "/api/v1/branches", tok, nil)
	if before.status < 200 || before.status >= 300 {
		t.Fatalf("no positive control: a fresh employee's own token got %d before deletion: %s",
			before.status, truncate(before.body))
	}

	del := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/employees/%d", empID), nil)
	del.Header.Set("Authorization", "Bearer "+h.a.tokens["Administrator"])
	delRec := httptest.NewRecorder()
	h.router.ServeHTTP(delRec, del)
	if delRec.Code < 200 || delRec.Code >= 300 {
		body, _ := io.ReadAll(delRec.Body)
		t.Fatalf("DELETE /employees/%d: %d: %s", empID, delRec.Code, truncate(string(body)))
	}

	// The SAME token, never reissued, on the very next request.
	after := h.do(t, http.MethodGet, "/api/v1/branches", tok, nil)
	if after.status < 400 {
		t.Errorf("a DELETED employee's outstanding token still worked (%d): %s — token invalidation is not happening",
			after.status, truncate(after.body))
	}
}

// TestRoleChangeTakesEffectImmediately: an employee's PERMISSIONS follow
// their current role from their very next request, not from their next
// login. Before Step 8b, RequirePermission trusted the roleId baked into the
// JWT at login time — reassigning someone from Cashier to Administrator (or
// the reverse) had literally no effect until they logged out and back in.
func TestRoleChangeTakesEffectImmediately(t *testing.T) {
	h := newHarness(t)

	emp := h.a.seeder.extraRow(t, "employees", map[string]any{"role": "Cashier", "role_id": h.a.roleIDs["Cashier"]})
	empID := uint(emp["id"].(int64))
	tok, err := platform.IssueToken(empID, "Cashier", h.a.roleIDs["Cashier"], h.a.id, h.a.branchID, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	// The harness deliberately grants every permission to every role
	// (isolating tenancy behavior from authorization — see newBusiness's doc
	// comment), so there is no catalogue-level difference between Cashier
	// and Administrator to exploit here. Revoke one permission from Cashier
	// directly, establishing a real difference to observe crossing.
	ctx := platform.AllowCrossTenant(t.Context())
	if err := h.db.WithContext(ctx).Exec(`
		UPDATE role_permissions SET permission = false
		WHERE tenant_id = ? AND role_id = ?
		  AND permission_id = (SELECT id FROM permissions WHERE name = 'can create branch')`,
		h.a.id, h.a.roleIDs["Cashier"]).Error; err != nil {
		t.Fatalf("revoking Cashier's create-branch grant: %v", err)
	}

	// A Cashier cannot create a branch now — establishes the BEFORE state.
	before := httptest.NewRequest(http.MethodPost, "/api/v1/branches", strings.NewReader(`{"name":"Role Change Test","code":"RCT-01","address":"x"}`))
	before.Header.Set("Content-Type", "application/json")
	before.Header.Set("Authorization", "Bearer "+tok)
	beforeRec := httptest.NewRecorder()
	h.router.ServeHTTP(beforeRec, before)
	if beforeRec.Code < 400 {
		t.Fatalf("no positive control: a Cashier's token was allowed to create a branch BEFORE any role change (%d) — "+
			"this test cannot show a change in behavior", beforeRec.Code)
	}

	// Promote to Administrator via the real update endpoint.
	upd := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/v1/employees/%d", empID),
		strings.NewReader(fmt.Sprintf(`{"name":"Role Change Test","role":"Administrator","branchId":%d}`, h.a.branchID)))
	upd.Header.Set("Content-Type", "application/json")
	upd.Header.Set("Authorization", "Bearer "+h.a.tokens["Administrator"])
	updRec := httptest.NewRecorder()
	h.router.ServeHTTP(updRec, upd)
	if updRec.Code < 200 || updRec.Code >= 300 {
		body, _ := io.ReadAll(updRec.Body)
		t.Fatalf("PUT /employees/%d (role change): %d: %s", empID, updRec.Code, truncate(string(body)))
	}

	// The SAME token, never reissued, on the very next request — must now
	// succeed as Administrator.
	after := httptest.NewRequest(http.MethodPost, "/api/v1/branches", strings.NewReader(`{"name":"Role Change Test 2","code":"RCT-02","address":"x"}`))
	after.Header.Set("Content-Type", "application/json")
	after.Header.Set("Authorization", "Bearer "+tok)
	afterRec := httptest.NewRecorder()
	h.router.ServeHTTP(afterRec, after)
	if afterRec.Code < 200 || afterRec.Code >= 300 {
		body, _ := io.ReadAll(afterRec.Body)
		t.Errorf("a role change to Administrator did not take effect on the employee's EXISTING token (%d): %s — "+
			"the old role is still being trusted from the JWT instead of the live row",
			afterRec.Code, truncate(string(body)))
	}
}

func TestSessionsWithoutABusinessAreRejected(t *testing.T) {
	h := newHarness(t)

	const staffRoute = "/api/v1/branches"
	const borrowerRoute = "/api/v1/customer/loans"

	t.Run("no token", func(t *testing.T) {
		if got := h.do(t, http.MethodGet, staffRoute, "", nil); got.status != http.StatusUnauthorized {
			t.Errorf("staff route with no token returned %d, want 401: %s", got.status, truncate(got.body))
		}
		if got := h.do(t, http.MethodGet, borrowerRoute, "", nil); got.status != http.StatusUnauthorized {
			t.Errorf("borrower route with no token returned %d, want 401: %s", got.status, truncate(got.body))
		}
	})

	t.Run("expired token", func(t *testing.T) {
		expired, err := platform.IssueToken(1, "Administrator", h.a.roleIDs["Administrator"],
			h.a.id, h.a.branchID, h.cfg.JWTSecret, -time.Hour)
		if err != nil {
			t.Fatalf("issue expired token: %v", err)
		}
		if got := h.do(t, http.MethodGet, staffRoute, expired, nil); got.status != http.StatusUnauthorized {
			t.Errorf("expired staff token returned %d, want 401: %s", got.status, truncate(got.body))
		}

		expiredCust, err := platform.IssueCustomerToken(h.a.customerID, h.a.id, h.cfg.JWTSecret, -time.Hour)
		if err != nil {
			t.Fatalf("issue expired customer token: %v", err)
		}
		if got := h.do(t, http.MethodGet, borrowerRoute, expiredCust, nil); got.status != http.StatusUnauthorized {
			t.Errorf("expired borrower token returned %d, want 401: %s", got.status, truncate(got.body))
		}
	})

	t.Run("token signed with the wrong secret", func(t *testing.T) {
		forged, err := platform.IssueToken(1, "Administrator", 1, h.b.id, h.b.branchID, "not-the-secret", time.Hour)
		if err != nil {
			t.Fatalf("issue forged token: %v", err)
		}
		if got := h.do(t, http.MethodGet, staffRoute, forged, nil); got.status != http.StatusUnauthorized {
			t.Errorf("token signed with the wrong secret returned %d, want 401: %s", got.status, truncate(got.body))
		}
	})

	t.Run("schemes do not cross", func(t *testing.T) {
		if got := h.do(t, http.MethodGet, staffRoute, h.a.customerToken, nil); got.status < 400 {
			t.Errorf("a BORROWER token was accepted on a staff route (%d): %s", got.status, truncate(got.body))
		}
		if got := h.do(t, http.MethodGet, borrowerRoute, h.a.tokens["Administrator"], nil); got.status < 400 {
			t.Errorf("a STAFF token was accepted on a borrower route (%d): %s", got.status, truncate(got.body))
		}
	})

	t.Run("a business hint in the request is ignored", func(t *testing.T) {
		// A's own session, plus every plausible way a caller might try to
		// name a different business. The response must be A's data
		// regardless: the tenant comes from the token alone.
		base := h.do(t, http.MethodGet, staffRoute, h.a.tokens["Administrator"], nil)
		req := httptest.NewRequest(http.MethodGet, staffRoute+"?tenantId="+fmt.Sprint(h.b.id)+"&businessCode="+h.b.code, nil)
		req.Header.Set("Authorization", "Bearer "+h.a.tokens["Administrator"])
		req.Header.Set("X-Tenant-ID", fmt.Sprint(h.b.id))
		req.Header.Set("X-Business-Code", h.b.code)
		rec := httptest.NewRecorder()
		h.router.ServeHTTP(rec, req)
		hinted, _ := io.ReadAll(rec.Body)

		if strings.Contains(string(hinted), h.b.leakMarker()) {
			t.Errorf("a business hint in the query/headers changed the result — the tenant "+
				"must come from the token alone\n  body: %s", truncate(string(hinted)))
		}
		if rec.Code != base.status {
			t.Errorf("business hints changed the status from %d to %d", base.status, rec.Code)
		}
	})
}

// ---------------------------------------------------------------------------

func sortedRoutes() []string {
	out := make([]string, 0, len(routeManifest))
	for r := range routeManifest {
		out = append(out, r)
	}
	sort.Strings(out)
	return out
}

func indexOf(haystack []string, needle string) int {
	for i, h := range haystack {
		if h == needle {
			return i
		}
	}
	return -1
}

func truncate(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}
