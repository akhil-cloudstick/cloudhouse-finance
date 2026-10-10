package routers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var staffRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator",
	"Cashier", "Accountant", "Collection Staff", "Auction Administrator",
	"Auditor",
}

func buildRouterWithoutDatabase(t *testing.T) *echo.Echo {
	t.Helper()
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
	t.Setenv("UPLOADS_DIR", t.TempDir())
	t.Setenv("JWT_SECRET", "routes-test-secret")
	if err := config.Setup(db, config.LoadConfig()); err != nil {
		t.Fatalf("setup: %v", err)
	}
	return InitRoutes(echo.New())
}

func mountedRoutes(t *testing.T) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	for _, r := range buildRouterWithoutDatabase(t).Routes() {
		if r.Method == echo.RouteNotFound {
			continue
		}
		out[r.Method+" "+r.Path] = true
	}
	return out
}

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

type business struct {
	id                 uint
	code               string
	name               string
	branchID           uint
	roleIDs            map[string]uint
	adminEmployeeID    uint
	tokens             map[string]string
	customerID         uint
	customerToken      string
	otherBorrowerID    uint
	otherBorrowerToken string
	otherBorrowerRows  map[string]uint
	seeder             *seeder
}

type harness struct {
	db     *gorm.DB
	router *echo.Echo
	cfg    config.Config
	a, b   *business
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	log.SetOutput(io.Discard)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run the isolation probes")
	}
	t.Setenv("DB_NAME", name)
	t.Setenv("UPLOADS_DIR", t.TempDir())
	t.Setenv("MIGRATIONS_DIR", "../../migrations")
	t.Setenv("JWT_SECRET", "routes-test-secret")
	config.InitDB()
	db, cfg := config.BaseDB, config.Env
	db.Logger = logger.Discard
	h := &harness{db: db, router: InitRoutes(echo.New()), cfg: cfg}
	h.a = h.newBusiness(t, "mtprobe-a")
	h.b = h.newBusiness(t, "mtprobe-b")
	h.materializeFiles(t)
	return h
}

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

func (h *harness) newBusiness(t *testing.T, code string) *business {
	t.Helper()
	ctx := config.AllowCrossTenant(t.Context())
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
	allModules := strings.Join(commonModels.KnownModules, ",")
	allLanguages := strings.Join(common.KnownLanguages, ",")
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
		tok, err := auth.IssueToken(empID, role, roleID, b.id, b.branchID, h.cfg.JWTSecret, time.Hour)
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
			"loans":       {"loan_number": fmt.Sprintf("MTPROBE-T%d-LN", b.id)},
			"loan_drafts": {"created_by_employee_id": b.adminEmployeeID},
		},
	}
	cust := b.seeder.row(t, "customers")
	b.customerID = uint(cust["id"].(int64))
	tok, err := auth.IssueCustomerToken(b.customerID, b.id, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue customer token: %v", err)
	}
	b.customerToken = tok
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
	tok, err := auth.IssueCustomerToken(b.otherBorrowerID, b.id, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue second borrower token: %v", err)
	}
	b.otherBorrowerToken = tok
}

type seeder struct {
	db        *gorm.DB
	tenantID  uint
	rows      map[string]map[string]any
	busy      map[string]bool
	overrides map[string]map[string]any
}

type columnInfo struct {
	ColumnName             string
	DataType               string
	IsNullable             string
	ColumnDefault          *string
	CharacterMaximumLength *int
}

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
	ctx := config.AllowCrossTenant(t.Context())
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
		if c.IsNullable == "YES" || c.ColumnDefault != nil {
			continue
		}
		names = append(names, c.ColumnName)
		if ref, ok := refOf[c.ColumnName]; ok && ref != table {
			parent := s.row(t, ref)
			values = append(values, parent["id"])
			continue
		}
		values = append(values, s.synth(table, c))
	}
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

func (b *business) leakMarker() string { return fmt.Sprintf("MTPROBE-T%d-", b.id) }

type reply struct {
	status int
	body   string
}

func (h *harness) do(t *testing.T, method, path, bearer string, cookie *http.Cookie) reply {
	t.Helper()
	req := httptest.NewRequest(method, h.selfPath(t, path, bearer), strings.NewReader("{}"))
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

var probeQuery = map[string]string{
	"GET /api/v1/employees/:id/permissions": "role_id=roles",
}

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
		usesCookie := strings.HasPrefix(pattern, "/uploads/")
		victimPath := h.fillQuery(t, route, h.fill(t, pattern, spec, h.b), h.b)
		for _, role := range staffRoles {
			if spec.customer {
				continue
			}
			var bearer string
			var cookie *http.Cookie
			if usesCookie {
				cookie = &http.Cookie{Name: common.AuthCookieName, Value: h.a.tokens[role]}
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
			_ = got
			continue
		}
		if method == http.MethodGet {
			var bearer string
			var cookie *http.Cookie
			if usesCookie {
				cookie = &http.Cookie{Name: common.AuthCookieName, Value: h.b.tokens["Administrator"]}
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
	for _, e := range serverErrors {
		t.Logf("server error (not a leak, but not a clean refusal either): %s as %s -> %d: %s",
			e.route, e.role, e.status, e.body)
	}
	t.Logf("%d cross-tenant probes across %d roles; %d GET probes had a positive control",
		probed, len(staffRoles), positiveControls)
}

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
		// A staff token must not work on a borrower route at all: the two JWT schemes are deliberately separate.
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
	own := h.do(t, http.MethodGet, fmt.Sprintf("/api/v1/customers/:customer_id/loans/%d", victim["loans"]), h.a.otherBorrowerToken, nil)
	if own.status < 200 || own.status >= 300 {
		t.Logf("no positive control: the owning borrower got %d for their own loan (%s) — "+
			"the refusals above are therefore weak evidence", own.status, truncate(own.body))
	}
	t.Logf("%d same-business borrower-to-borrower probes", probed)
}

func TestBorrowerCollectionsDoNotLeakAnotherBorrower(t *testing.T) {
	h := newHarness(t)
	victim := h.a.otherBorrowerRows
	cases := []struct {
		route  string
		marker string
	}{
		{"/api/v1/customers/:customer_id/loans", fmt.Sprintf("MTPROBE-T%d-LN2", h.a.id)},
		{"/api/v1/customers/:customer_id/payments", fmt.Sprintf("\"id\":%d", victim["loan_payments"])},
		{"/api/v1/customers/:customer_id/notifications", fmt.Sprintf("\"id\":%d", victim["notifications"])},
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

func TestBorrowerSelfRoutesReturnOnlyTheCaller(t *testing.T) {
	h := newHarness(t)
	got := h.do(t, http.MethodGet, "/api/v1/customers/:customer_id/profile", h.a.customerToken, nil)
	if got.status < 200 || got.status >= 300 {
		t.Fatalf("GET /customer/profile as the caller returned %d: %s", got.status, truncate(got.body))
	}
	var profile struct {
		Data struct {
			ID uint `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(got.body), &profile); err != nil {
		t.Fatalf("GET /customer/profile returned unparseable JSON: %v: %s", err, truncate(got.body))
	}
	if profile.Data.ID != h.a.customerID {
		t.Errorf("GET /customer/profile returned customer %d, want the caller %d: %s", profile.Data.ID, h.a.customerID, truncate(got.body))
	}
	if otherID := h.a.otherBorrowerRows["customers"]; otherID != 0 && profile.Data.ID == otherID {
		t.Errorf("BORROWER LEAK: /customer/profile as one borrower returned another borrower's record\n  body: %s",
			truncate(got.body))
	}
}

func TestBranchSelectionCannotCrossBusinesses(t *testing.T) {
	h := newHarness(t)
	victimBranch := h.b.branchID
	marker := h.b.leakMarker()
	for _, table := range []string{"customers", "loans", "cash_movements", "expenses", "employees"} {
		h.b.seeder.row(t, table)
	}
	routes := []string{
		"/api/v1/users/:user_id/branches",
		"/api/v1/users/:user_id/customers",
		"/api/v1/users/:user_id/loans",
		"/api/v1/users/:user_id/employees",
		"/api/v1/users/:user_id/cash-movements",
		"/api/v1/users/:user_id/expenses",
		"/api/v1/users/:user_id/reports/loans/status",
		"/api/v1/users/:user_id/reports/kyc",
	}
	for _, role := range []string{"Administrator", "Management", "Cashier"} {
		for _, route := range routes {
			req := httptest.NewRequest(http.MethodGet, h.selfPath(t, route, h.a.tokens[role]), nil)
			req.Header.Set("Authorization", "Bearer "+h.a.tokens[role])
			req.Header.Set(auth.SelectedBranchHeader, fmt.Sprint(victimBranch))
			rec := httptest.NewRecorder()
			h.router.ServeHTTP(rec, req)
			body, _ := io.ReadAll(rec.Body)
			if strings.Contains(string(body), marker) {
				t.Errorf(`CROSS-TENANT LEAK via the branch switcher: %s as %s, with
%s pointing at business B's branch %d, returned business B's data.
  body: %s`, route, role, auth.SelectedBranchHeader, victimBranch, truncate(string(body)))
			}
		}
	}
	// And the switcher must not widen a confined role.
	t.Logf("branch switcher probed across %d routes and 3 roles for cross-business leakage", len(routes))
}

func TestSwitchableBranchesNeverCrossBusinesses(t *testing.T) {
	h := newHarness(t)
	for _, role := range staffRoles {
		got := h.do(t, http.MethodGet, "/api/v1/users/:user_id/branches/switchable", h.a.tokens[role], nil)
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

func TestCollectionsDoNotLeak(t *testing.T) {
	h := newHarness(t)
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
		if method != http.MethodGet {
			continue
		}
		paths := []string{pattern}
		if strings.Contains(pattern, ":key") {
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

func TestProviderCredentialsAreDeliberatelyShared(t *testing.T) {
	h := newHarness(t)
	ctx := config.AllowCrossTenant(t.Context())
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
	secret := "MTPROBE-SHARED-CREDENTIAL"
	if err := h.db.WithContext(ctx).Exec(`
		INSERT INTO api_key_settings (category, name, encrypted_value, created_at, updated_at)
		VALUES ('whatsapp', ?, '', now(), now())
		ON CONFLICT (category) DO UPDATE SET name = EXCLUDED.name`, secret).Error; err != nil {
		t.Fatalf("seeding the shared credential row: %v", err)
	}
	got := h.do(t, http.MethodGet, "/api/v1/users/:user_id/settings/api-keys", h.a.tokens["Administrator"], nil)
	if !strings.Contains(got.body, secret) {
		t.Errorf(`the credential row no longer reads as shared (status %d).

If provider credentials are now per-business, this test needs replacing — see
the failure message above. If they are still meant to be shared, something
else has changed.
  body: %s`, got.status, truncate(got.body))
	}
}

func (h *harness) newSuperAdminUser(t *testing.T, username string) (uint, string) {
	t.Helper()
	ctx := config.AllowCrossTenant(t.Context())
	var id uint
	if err := h.db.WithContext(ctx).Raw(`
		INSERT INTO superadmin_users (name, username, password_hash, is_active, created_at, updated_at)
		VALUES (?, ?, 'x', true, now(), now()) RETURNING id`,
		username, username).Scan(&id).Error; err != nil {
		t.Fatalf("seed superadmin user: %v", err)
	}
	tok, err := auth.IssueSuperAdminToken(id, username, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue superadmin token: %v", err)
	}
	return id, tok
}

func TestSuperAdminRoutesRejectStaffAndBorrowerTokens(t *testing.T) {
	h := newHarness(t)
	_, superAdminToken := h.newSuperAdminUser(t, fmt.Sprintf("superadminprobe-%d", time.Now().UnixNano()))
	t.Run("staff token is refused on superadmin routes", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/superadmin/users/:user_id/businesses", h.a.tokens["Administrator"], nil)
		if got.status < 400 {
			t.Errorf("a STAFF token (even Administrator) was accepted on /superadmin/businesses (%d): %s",
				got.status, truncate(got.body))
		}
	})
	t.Run("borrower token is refused on superadmin routes", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/superadmin/users/:user_id/businesses", h.a.customerToken, nil)
		if got.status < 400 {
			t.Errorf("a BORROWER token was accepted on /superadmin/businesses (%d): %s", got.status, truncate(got.body))
		}
	})
	t.Run("superadmin token is refused on a staff route", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/users/:user_id/branches", superAdminToken, nil)
		if got.status < 400 {
			t.Errorf("a SUPERADMIN token was accepted on a staff route (%d): %s", got.status, truncate(got.body))
		}
	})
	t.Run("superadmin token is refused on a borrower route", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/customers/:customer_id/loans", superAdminToken, nil)
		if got.status < 400 {
			t.Errorf("a SUPERADMIN token was accepted on a borrower route (%d): %s", got.status, truncate(got.body))
		}
	})
	t.Run("the superadmin token actually works on its own routes", func(t *testing.T) {
		got := h.do(t, http.MethodGet, "/api/v1/superadmin/users/:user_id/tiers", superAdminToken, nil)
		if got.status < 200 || got.status >= 300 {
			t.Errorf("a genuine superadmin token was refused on its own route (%d): %s — "+
				"the refusals above are weak evidence without this passing",
				got.status, truncate(got.body))
		}
	})
}

func TestSuperAdminCreatedBusinessIsFullyIsolated(t *testing.T) {
	h := newHarness(t)
	_, superAdminToken := h.newSuperAdminUser(t, fmt.Sprintf("superadminprobe-%d", time.Now().UnixNano()))
	var tiers struct {
		Data []struct {
			ID   uint   `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	tiersResp := h.do(t, http.MethodGet, "/api/v1/superadmin/users/:user_id/tiers", superAdminToken, nil)
	if tiersResp.status != http.StatusOK {
		t.Fatalf("GET /superadmin/tiers: %d: %s", tiersResp.status, truncate(tiersResp.body))
	}
	if err := jsonUnmarshal(tiersResp.body, &tiers); err != nil || len(tiers.Data) == 0 {
		t.Fatalf("could not read a tier id from /superadmin/tiers: %v: %s", err, truncate(tiersResp.body))
	}
	tierID := tiers.Data[0].ID
	suffix := fmt.Sprintf("vprobe%d", time.Now().UnixNano())
	createBody := fmt.Sprintf(`{
		"name": "SuperAdmin-Created Co", "code": %q, "tier_id": %d,
		"admin_username": "admin", "admin_password": "correcthorsebattery", "contact_phone": "+91 9000012345",
		"reason": "isolation harness end-to-end proof"
	}`, suffix, tierID)
	req := httptest.NewRequest(http.MethodPost, h.selfPath(t, "/api/v1/superadmin/users/:user_id/businesses", superAdminToken), strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+superAdminToken)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		body, _ := io.ReadAll(rec.Body)
		t.Fatalf("POST /superadmin/businesses: %d: %s", rec.Code, truncate(string(body)))
	}
	loginBody := fmt.Sprintf(`{"identifier":"admin","password":"correcthorsebattery","business_code":%q}`, suffix)
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
	branchesResp := h.do(t, http.MethodGet, "/api/v1/users/:user_id/branches", newBusinessToken, nil)
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
	aResp := h.do(t, http.MethodGet, "/api/v1/users/:user_id/branches", h.a.tokens["Administrator"], nil)
	if strings.Contains(aResp.body, "Head Office") && strings.Contains(aResp.body, suffix) {
		t.Errorf("CROSS-TENANT LEAK: an existing business can see the superadmin-created business's branch")
	}
}

func jsonUnmarshal(body string, out any) error {
	return json.Unmarshal([]byte(body), out)
}

func TestBranchQuotaIsEnforced(t *testing.T) {
	h := newHarness(t)
	_, superAdminToken := h.newSuperAdminUser(t, fmt.Sprintf("superadminprobe-%d", time.Now().UnixNano()))
	var tiers struct {
		Data []struct {
			ID   uint   `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	tiersResp := h.do(t, http.MethodGet, "/api/v1/superadmin/users/:user_id/tiers", superAdminToken, nil)
	if err := jsonUnmarshal(tiersResp.body, &tiers); err != nil {
		t.Fatalf("reading tiers: %v: %s", err, truncate(tiersResp.body))
	}
	var starterID uint
	for _, tr := range tiers.Data {
		if tr.Name == "Up to 5 Branches" {
			starterID = tr.ID
		}
	}
	if starterID == 0 {
		t.Fatal("no \"Up to 5 Branches\" tier found — expected the plan catalogue from 0004_insert_tiers.sql")
	}
	suffix := fmt.Sprintf("quotaprobe%d", time.Now().UnixNano())
	createBody := fmt.Sprintf(`{
		"name": "Quota Probe Co", "code": %q, "tier_id": %d,
		"admin_username": "admin", "admin_password": "correcthorsebattery", "contact_phone": "+91 9000012345",
		"modules": ["branches"],
		"reason": "isolation harness quota-enforcement proof"
	}`, suffix, starterID)
	req := httptest.NewRequest(http.MethodPost, h.selfPath(t, "/api/v1/superadmin/users/:user_id/businesses", superAdminToken), strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+superAdminToken)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		body, _ := io.ReadAll(rec.Body)
		t.Fatalf("POST /superadmin/businesses (5-branch plan): %d: %s", rec.Code, truncate(string(body)))
	}
	loginBody := fmt.Sprintf(`{"identifier":"admin","password":"correcthorsebattery","business_code":%q}`, suffix)
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
		t.Fatalf("logging into the new 5-branch business: %v: %s", err, truncate(string(loginBodyBytes)))
	}
	tok := loginResp.Data.Token
	for n := 2; n <= 5; n++ {
		fillReq := httptest.NewRequest(http.MethodPost, h.selfPath(t, "/api/v1/users/:user_id/branches", tok),
			strings.NewReader(fmt.Sprintf(`{"name":"Branch %d","code":"BR-%02d","address":"x"}`, n, n)))
		fillReq.Header.Set("Content-Type", "application/json")
		fillReq.Header.Set("Authorization", "Bearer "+tok)
		fillRec := httptest.NewRecorder()
		h.router.ServeHTTP(fillRec, fillReq)
		if fillRec.Code != http.StatusOK {
			body, _ := io.ReadAll(fillRec.Body)
			t.Fatalf("creating branch %d of 5: %d: %s", n, fillRec.Code, truncate(string(body)))
		}
	}
	create2Req := httptest.NewRequest(http.MethodPost, h.selfPath(t, "/api/v1/users/:user_id/branches", tok),
		strings.NewReader(`{"name":"Sixth Branch","code":"BR-06","address":"x"}`))
	create2Req.Header.Set("Content-Type", "application/json")
	create2Req.Header.Set("Authorization", "Bearer "+tok)
	create2Rec := httptest.NewRecorder()
	h.router.ServeHTTP(create2Rec, create2Req)
	if create2Rec.Code != http.StatusConflict {
		body, _ := io.ReadAll(create2Rec.Body)
		t.Errorf("creating a SIXTH branch on the 5-branch plan got %d, want 409: %s",
			create2Rec.Code, truncate(string(body)))
	}
	var branches struct {
		Message struct {
			Data []struct {
				ID   uint   `json:"id"`
				Name string `json:"name"`
				Code string `json:"code"`
			} `json:"data"`
		} `json:"message"`
	}
	listResp := h.do(t, http.MethodGet, "/api/v1/users/:user_id/branches", tok, nil)
	if err := jsonUnmarshal(listResp.body, &branches); err != nil || len(branches.Message.Data) != 5 {
		t.Fatalf("expected exactly 5 branches after the refused create, got %d (%v): %s",
			len(branches.Message.Data), err, truncate(listResp.body))
	}
	var headOfficeID uint
	var headOfficeCode string
	for _, b := range branches.Message.Data {
		if b.Name == "Head Office" {
			headOfficeID, headOfficeCode = b.ID, b.Code
		}
	}
	if headOfficeID == 0 {
		t.Fatalf("no Head Office among the business's branches: %s", truncate(listResp.body))
	}
	// Deactivate Head Office, freeing the one slot, then create a replacement — this must now succeed.
	deactivateReq := httptest.NewRequest(http.MethodPatch,
		h.selfPath(t, fmt.Sprintf("/api/v1/users/:user_id/branches/%d/update", headOfficeID), tok),
		strings.NewReader(fmt.Sprintf(`{"name":"Head Office","code":%q,"address":"x","is_active":false}`, headOfficeCode)))
	deactivateReq.Header.Set("Content-Type", "application/json")
	deactivateReq.Header.Set("Authorization", "Bearer "+tok)
	deactivateRec := httptest.NewRecorder()
	h.router.ServeHTTP(deactivateRec, deactivateReq)
	if deactivateRec.Code != http.StatusOK {
		body, _ := io.ReadAll(deactivateRec.Body)
		t.Fatalf("deactivating Head Office: %d: %s", deactivateRec.Code, truncate(string(body)))
	}
	create3Req := httptest.NewRequest(http.MethodPost, h.selfPath(t, "/api/v1/users/:user_id/branches", tok),
		strings.NewReader(`{"name":"Replacement Branch","code":"BR-07","address":"x"}`))
	create3Req.Header.Set("Content-Type", "application/json")
	create3Req.Header.Set("Authorization", "Bearer "+tok)
	create3Rec := httptest.NewRecorder()
	h.router.ServeHTTP(create3Rec, create3Req)
	if create3Rec.Code != http.StatusOK {
		body, _ := io.ReadAll(create3Rec.Body)
		t.Fatalf("creating a replacement branch after freeing the slot got %d, want 200: %s",
			create3Rec.Code, truncate(string(body)))
	}
	reactivateReq := httptest.NewRequest(http.MethodPatch,
		h.selfPath(t, fmt.Sprintf("/api/v1/users/:user_id/branches/%d/update", headOfficeID), tok),
		strings.NewReader(fmt.Sprintf(`{"name":"Head Office","code":%q,"address":"x","is_active":true}`, headOfficeCode)))
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

func TestDeletedEmployeeSessionStopsImmediately(t *testing.T) {
	h := newHarness(t)
	emp := h.a.seeder.extraRow(t, "employees", map[string]any{"role": "Cashier", "role_id": h.a.roleIDs["Cashier"]})
	empID := uint(emp["id"].(int64))
	tok, err := auth.IssueToken(empID, "Cashier", h.a.roleIDs["Cashier"], h.a.id, h.a.branchID, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	before := h.do(t, http.MethodGet, "/api/v1/users/:user_id/branches", tok, nil)
	if before.status < 200 || before.status >= 300 {
		t.Fatalf("no positive control: a fresh employee's own token got %d before deletion: %s",
			before.status, truncate(before.body))
	}
	del := httptest.NewRequest(http.MethodDelete, h.selfPath(t, fmt.Sprintf("/api/v1/users/:user_id/employees/%d/delete", empID), h.a.tokens["Administrator"]), nil)
	del.Header.Set("Authorization", "Bearer "+h.a.tokens["Administrator"])
	delRec := httptest.NewRecorder()
	h.router.ServeHTTP(delRec, del)
	if delRec.Code < 200 || delRec.Code >= 300 {
		body, _ := io.ReadAll(delRec.Body)
		t.Fatalf("DELETE /employees/%d: %d: %s", empID, delRec.Code, truncate(string(body)))
	}
	// The SAME token, never reissued, on the very next request.
	after := h.do(t, http.MethodGet, "/api/v1/users/:user_id/branches", tok, nil)
	if after.status < 400 {
		t.Errorf("a DELETED employee's outstanding token still worked (%d): %s — token invalidation is not happening",
			after.status, truncate(after.body))
	}
}

func TestRoleChangeTakesEffectImmediately(t *testing.T) {
	h := newHarness(t)
	emp := h.a.seeder.extraRow(t, "employees", map[string]any{"role": "Cashier", "role_id": h.a.roleIDs["Cashier"]})
	empID := uint(emp["id"].(int64))
	tok, err := auth.IssueToken(empID, "Cashier", h.a.roleIDs["Cashier"], h.a.id, h.a.branchID, h.cfg.JWTSecret, time.Hour)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	ctx := config.AllowCrossTenant(t.Context())
	if err := h.db.WithContext(ctx).Exec(`
		UPDATE role_permissions SET permission = false
		WHERE tenant_id = ? AND role_id = ?
		  AND permission_id = (SELECT id FROM permissions WHERE name = 'can create branch')`,
		h.a.id, h.a.roleIDs["Cashier"]).Error; err != nil {
		t.Fatalf("revoking Cashier's create-branch grant: %v", err)
	}
	before := httptest.NewRequest(http.MethodPost, h.selfPath(t, "/api/v1/users/:user_id/branches", tok), strings.NewReader(`{"name":"Role Change Test","code":"RCT-01","address":"x"}`))
	before.Header.Set("Content-Type", "application/json")
	before.Header.Set("Authorization", "Bearer "+tok)
	beforeRec := httptest.NewRecorder()
	h.router.ServeHTTP(beforeRec, before)
	if beforeRec.Code < 400 {
		t.Fatalf("no positive control: a Cashier's token was allowed to create a branch BEFORE any role change (%d) — "+
			"this test cannot show a change in behavior", beforeRec.Code)
	}
	upd := httptest.NewRequest(http.MethodPatch, h.selfPath(t, fmt.Sprintf("/api/v1/users/:user_id/employees/%d/update", empID), h.a.tokens["Administrator"]),
		strings.NewReader(fmt.Sprintf(`{"name":"Role Change Test","role":"Administrator","branch_id":%d}`, h.a.branchID)))
	upd.Header.Set("Content-Type", "application/json")
	upd.Header.Set("Authorization", "Bearer "+h.a.tokens["Administrator"])
	updRec := httptest.NewRecorder()
	h.router.ServeHTTP(updRec, upd)
	if updRec.Code < 200 || updRec.Code >= 300 {
		body, _ := io.ReadAll(updRec.Body)
		t.Fatalf("PUT /employees/%d (role change): %d: %s", empID, updRec.Code, truncate(string(body)))
	}
	// The SAME token, never reissued, on the very next request — must now succeed as Administrator.
	after := httptest.NewRequest(http.MethodPost, h.selfPath(t, "/api/v1/users/:user_id/branches", tok), strings.NewReader(`{"name":"Role Change Test 2","code":"RCT-02","address":"x"}`))
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
	const staffRoute = "/api/v1/users/:user_id/branches"
	const borrowerRoute = "/api/v1/customers/:customer_id/loans"
	t.Run("no token", func(t *testing.T) {
		if got := h.do(t, http.MethodGet, staffRoute, "", nil); got.status != http.StatusUnauthorized {
			t.Errorf("staff route with no token returned %d, want 401: %s", got.status, truncate(got.body))
		}
		if got := h.do(t, http.MethodGet, borrowerRoute, "", nil); got.status != http.StatusUnauthorized {
			t.Errorf("borrower route with no token returned %d, want 401: %s", got.status, truncate(got.body))
		}
	})
	t.Run("expired token", func(t *testing.T) {
		expired, err := auth.IssueToken(1, "Administrator", h.a.roleIDs["Administrator"],
			h.a.id, h.a.branchID, h.cfg.JWTSecret, -time.Hour)
		if err != nil {
			t.Fatalf("issue expired token: %v", err)
		}
		if got := h.do(t, http.MethodGet, staffRoute, expired, nil); got.status != http.StatusUnauthorized {
			t.Errorf("expired staff token returned %d, want 401: %s", got.status, truncate(got.body))
		}
		expiredCust, err := auth.IssueCustomerToken(h.a.customerID, h.a.id, h.cfg.JWTSecret, -time.Hour)
		if err != nil {
			t.Fatalf("issue expired customer token: %v", err)
		}
		if got := h.do(t, http.MethodGet, borrowerRoute, expiredCust, nil); got.status != http.StatusUnauthorized {
			t.Errorf("expired borrower token returned %d, want 401: %s", got.status, truncate(got.body))
		}
	})
	t.Run("token signed with the wrong secret", func(t *testing.T) {
		forged, err := auth.IssueToken(1, "Administrator", 1, h.b.id, h.b.branchID, "not-the-secret", time.Hour)
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
		base := h.do(t, http.MethodGet, staffRoute, h.a.tokens["Administrator"], nil)
		req := httptest.NewRequest(http.MethodGet, h.selfPath(t, staffRoute+"?tenant_id="+fmt.Sprint(h.b.id)+"&business_code="+h.b.code, h.a.tokens["Administrator"]), nil)
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

func (h *harness) selfPath(t *testing.T, path, bearer string) string {
	t.Helper()
	if !strings.Contains(path, ":user_id") && !strings.Contains(path, ":customer_id") {
		return path
	}
	var id uint
	if c, err := auth.ParseToken(bearer, h.cfg.JWTSecret); err == nil {
		id = c.EmployeeID
	} else if c, err := auth.ParseCustomerToken(bearer, h.cfg.JWTSecret); err == nil {
		id = c.CustomerID
	} else if c, err := auth.ParseSuperAdminToken(bearer, h.cfg.JWTSecret); err == nil {
		id = c.SuperAdminUserID
	}
	path = strings.ReplaceAll(path, ":user_id", fmt.Sprint(id))
	return strings.ReplaceAll(path, ":customer_id", fmt.Sprint(id))
}
