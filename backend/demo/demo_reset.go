package demo

import (
	"cloudhouse/backend/auth"
	"cloudhouse/backend/config"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

const adminUsername = "admin"

var running atomic.Bool

var wipeOrder = []string{
	"ornament_purity_tests",
	"ornament_images",
	"packet_movements",
	"auction_events",
	"auction_notices",
	"auction_decision_requests",
	"request_approvals",
	"bank_pledge_events",
	"personal_loan_payments",
	"personal_loan_installments",
	"investment_payouts",
	"loan_draft_ornaments",
	"loan_approvals",
	"loan_payments",
	"auction_records",
	"loan_requests",
	"bank_pledge_records",
	"packets",
	"ornaments",
	"reminders",
	"notifications",
	"investments",
	"personal_loans",
	"loan_drafts",
	"loans",
	"gold_sales",
	"cash_movements",
	"customer_otp",
	"customer_device_tokens",
	"customers",
	"investment_plans",
	"schemes",
	"lockers",
	"banks",
	"ornament_types",
	"gold_rates",
	"expenses",
	"opening_cash_balances",
	"approval_limits",
	"approval_actions",
	"communication_logs",
	"audit_log_entries",
	"purity_standards",
}

var untenantedTables = map[string]bool{
	"investments":        true,
	"investment_plans":   true,
	"investment_payouts": true,
}

var childOf = map[string]struct{ fk, parent string }{
	"ornament_purity_tests":      {"ornament_id", "ornaments"},
	"ornament_images":            {"ornament_id", "ornaments"},
	"packet_movements":           {"packet_id", "packets"},
	"auction_events":             {"auction_record_id", "auction_records"},
	"auction_notices":            {"auction_record_id", "auction_records"},
	"auction_decision_requests":  {"auction_record_id", "auction_records"},
	"bank_pledge_events":         {"bank_pledge_record_id", "bank_pledge_records"},
	"personal_loan_payments":     {"personal_loan_id", "personal_loans"},
	"personal_loan_installments": {"personal_loan_id", "personal_loans"},
	"investment_payouts":         {"investment_id", "investments"},
	"loan_draft_ornaments":       {"draft_id", "loan_drafts"},
	"loan_approvals":             {"loan_id", "loans"},
	"loan_payments":              {"loan_id", "loans"},
	"loan_requests":              {"loan_id", "loans"},
	"bank_pledge_records":        {"loan_id", "loans"},
	"packets":                    {"loan_id", "loans"},
	"ornaments":                  {"loan_id", "loans"},
	"reminders":                  {"customer_id", "customers"},
	"personal_loans":             {"customer_id", "customers"},
	"loan_drafts":                {"customer_id", "customers"},
	"investments":                {"customer_id", "customers"},
	"loans":                      {"customer_id", "customers"},
	"cash_movements":             {"party_customer_id", "customers"},
}

type streamEvent struct {
	Step   string  `json:"step,omitempty"`
	Index  int     `json:"index,omitempty"`
	Total  int     `json:"total,omitempty"`
	Error  string  `json:"error,omitempty"`
	Done   bool    `json:"done,omitempty"`
	Report *Report `json:"report,omitempty"`
}

type state struct {
	tenantID    uint
	clk         clock
	keep        *preserved
	adminRoleID uint
	branchIDs   []uint
	employeeIDs []uint
	customerIDs []uint
	schemeIDs   []uint
	lockerIDs   []uint
	bankIDs     []uint
	loanIDs     []uint
	planIDs     []uint
	uploadKeys  []string
}

type step struct {
	name string
	run  func(context.Context, *state, *Report) error
}

type Progress struct {
	Step  string `json:"step"`
	Index int    `json:"index"`
	Total int    `json:"total"`
}

type ProgressFunc func(Progress)

type Options struct {
	SeedDemo       bool
	KeepEmployeeID uint
}

type preserved struct {
	adminID       uint
	adminUsername string
	adminBranchID uint
	uploadKeys    []string
	logoKey       string
}

type Report struct {
	Deleted       map[string]int64 `json:"deleted"`
	Created       map[string]int   `json:"created"`
	FilesRemoved  int              `json:"files_removed"`
	AdminUsername string           `json:"admin_username"`
	DurationMS    int64            `json:"duration_ms"`
	SeededAt      string           `json:"seeded_at"`
}

func Reset(ctx context.Context) (*Report, error) {
	return ResetWithProgress(ctx, nil)
}

func ResetWithProgress(ctx context.Context, onProgress ProgressFunc) (*Report, error) {
	return ResetWithOptions(ctx, Options{SeedDemo: true}, onProgress)
}

func ResetWithOptions(ctx context.Context, opts Options, onProgress ProgressFunc) (*Report, error) {
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok || tenantID == 0 {
		return nil, fmt.Errorf("demoseed: no business on the context — call platform.WithTenant first")
	}
	started := time.Now()
	rep := newReport()
	st := &state{
		tenantID: tenantID,
		clk:      newClock(started),
	}
	keep, err := wipe(ctx, tenantID, rep, opts.KeepEmployeeID)
	if err != nil {
		return nil, err
	}
	st.keep = keep
	// Files come out after the delete transaction has committed, so a rolled-back wipe never loses them.
	files, err := removeUploadFiles(ctx, keep.uploadKeys)
	if err != nil {
		return nil, err
	}
	rep.FilesRemoved = files
	var all []step
	if opts.SeedDemo {
		// The reseed is deliberately NOT one transaction.
		all = steps()
	}
	total := len(all) + 1
	report := func(step string, index int) {
		if onProgress != nil {
			onProgress(Progress{Step: step, Index: index, Total: total})
		}
	}
	report("clearing the old data", 1)
	for i, s := range all {
		if err := s.run(ctx, st, rep); err != nil {
			return nil, fmt.Errorf("reseed step %q: %w", s.name, err)
		}
		report(s.name, i+2)
	}
	rep.AdminUsername = st.keep.adminUsername
	rep.DurationMS = time.Since(started).Milliseconds()
	rep.SeededAt = started.Format(time.RFC3339)
	return rep, nil
}

func steps() []step {
	return []step{
		{"grants", seedGrants},
		{"branches", seedBranches},
		{"employees", seedEmployees},
		{"masters", seedMasters},
		{"gold rates", seedGoldRates},
		{"schemes", seedSchemes},
		{"customers", seedCustomers},
		{"uploads", seedUploads},
		{"gold loans", seedLoans},
		{"appraisals", seedAppraisals},
		{"payments", seedPayments},
		{"loan drafts", seedDrafts},
		{"packets and pledges", seedPacketsAndPledges},
		{"loan requests", seedLoanRequests},
		{"auctions", seedAuctions},
		{"personal loans", seedPersonalLoans},
		{"investments", seedInvestments},
		{"cash and expenses", seedCashAndExpenses},
		{"reminders", seedReminders},
		{"messages and audit", seedCommsAndAudit},
		{"dashboard snapshots", seedSnapshots},
		{"code sequences", seedSequences},
	}
}

func tenantPredicate(table string, tenantID uint) string {
	clause := fmt.Sprintf("%s.tenant_id = %d", table, tenantID)
	if untenantedTables[table] {
		clause = fmt.Sprintf("(%s OR %s.tenant_id = 0 OR %s.tenant_id IS NULL)",
			clause, table, table)
	}
	c, ok := childOf[table]
	if !ok {
		return clause
	}
	return fmt.Sprintf("(%s OR %s.%s IN (SELECT %s.id FROM %s WHERE %s))",
		clause, table, c.fk, c.parent, c.parent, tenantPredicate(c.parent, tenantID))
}

func wipe(ctx context.Context, tenantID uint, rep *Report, keepEmployeeID uint) (*preserved, error) {
	crossCtx := config.AllowCrossTenant(ctx)
	keep, err := findPreserved(crossCtx, config.BaseDB, tenantID, keepEmployeeID)
	if err != nil {
		return nil, err
	}
	err = config.BaseDB.WithContext(crossCtx).Transaction(func(tx *gorm.DB) error {
		for _, table := range wipeOrder {
			n, err := deleteFrom(tx, table, tenantID)
			if err != nil {
				return fmt.Errorf("wipe %s: %w", table, err)
			}
			if n > 0 {
				rep.Deleted[table] = n
			}
		}
		return wipeIdentityTables(tx, tenantID, keep, rep)
	})
	if err != nil {
		return nil, err
	}
	return keep, nil
}

func findPreserved(ctx context.Context, db *gorm.DB, tenantID, keepEmployeeID uint) (*preserved, error) {
	var row struct {
		ID       uint
		BranchID uint
		Username string
	}
	q := db.WithContext(ctx).Table("employees").Select("id, branch_id, username")
	if keepEmployeeID != 0 {
		q = q.Where("tenant_id = ? AND id = ?", tenantID, keepEmployeeID)
	} else {
		q = q.Where("tenant_id = ? AND (username = ? OR email = ?)", tenantID, adminUsername, "admin@cloudstick.io")
	}
	err := q.Order("id").Limit(1).Scan(&row).Error
	if err != nil {
		return nil, fmt.Errorf("locate admin login: %w", err)
	}
	if row.ID == 0 {
		return nil, fmt.Errorf("refusing to reset: the signed-in administrator was not found in business %d", tenantID)
	}
	var logoKeys []string
	if err := db.WithContext(ctx).
		Table("tenants").
		Where("id = ?", tenantID).
		Limit(1).
		Pluck("COALESCE(logo_storage_key, '')", &logoKeys).Error; err != nil {
		return nil, fmt.Errorf("read branding logo key: %w", err)
	}
	var logoKey string
	if len(logoKeys) > 0 {
		logoKey = logoKeys[0]
	}
	var keys []string
	uq := db.WithContext(ctx).Table("uploaded_files").Where("tenant_id = ?", tenantID)
	if logoKey != "" {
		uq = uq.Where("storage_key <> ?", logoKey)
	}
	if err := uq.Pluck("storage_key", &keys).Error; err != nil {
		return nil, fmt.Errorf("list upload keys: %w", err)
	}
	return &preserved{
		adminID:       row.ID,
		adminUsername: row.Username,
		adminBranchID: row.BranchID,
		uploadKeys:    keys,
		logoKey:       logoKey,
	}, nil
}

func deleteFrom(tx *gorm.DB, table string, tenantID uint) (int64, error) {
	res := tx.Exec("DELETE FROM " + table + " WHERE " + tenantPredicate(table, tenantID))
	return res.RowsAffected, res.Error
}

func wipeIdentityTables(tx *gorm.DB, tenantID uint, keep *preserved, rep *Report) error {
	var res *gorm.DB
	if keep.logoKey != "" {
		res = tx.Exec("DELETE FROM uploaded_files WHERE tenant_id = ? AND storage_key <> ?",
			tenantID, keep.logoKey)
	} else {
		res = tx.Exec("DELETE FROM uploaded_files WHERE tenant_id = ?", tenantID)
	}
	if res.Error != nil {
		return fmt.Errorf("wipe uploaded_files: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		rep.Deleted["uploaded_files"] = res.RowsAffected
	}
	res = tx.Exec("DELETE FROM employees WHERE tenant_id = ? AND id <> ?", tenantID, keep.adminID)
	if res.Error != nil {
		return fmt.Errorf("wipe employees: %w", res.Error)
	}
	rep.Deleted["employees"] = res.RowsAffected
	res = tx.Exec("DELETE FROM branches WHERE tenant_id = ? AND id <> ?", tenantID, keep.adminBranchID)
	if res.Error != nil {
		return fmt.Errorf("wipe branches: %w", res.Error)
	}
	rep.Deleted["branches"] = res.RowsAffected
	if res = tx.Exec("DELETE FROM sequences WHERE tenant_id = ?", tenantID); res.Error != nil {
		return fmt.Errorf("wipe sequences: %w", res.Error)
	}
	if res = tx.Exec("DELETE FROM usage_counters WHERE tenant_id = ?", tenantID); res.Error != nil {
		return fmt.Errorf("wipe usage_counters: %w", res.Error)
	}
	res = tx.Exec("DELETE FROM dashboard_snapshots")
	if res.Error != nil {
		return fmt.Errorf("wipe dashboard_snapshots: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		rep.Deleted["dashboard_snapshots"] = res.RowsAffected
	}
	return nil
}

func removeUploadFiles(ctx context.Context, keys []string) (int, error) {
	dir, err := filepath.Abs(config.Env.UploadsDir)
	if err != nil {
		return 0, fmt.Errorf("resolve uploads dir: %w", err)
	}
	if dir == "" || dir == filepath.VolumeName(dir)+string(filepath.Separator) {
		return 0, fmt.Errorf("refusing to sweep uploads dir %q", dir)
	}
	removed := 0
	for _, key := range keys {
		// The column is data, so treat it as untrusted: a key containing "../" must not escape the uploads directory.
		if key == "" || key != filepath.Base(key) {
			continue
		}
		p := filepath.Join(dir, key)
		if !strings.HasPrefix(p, dir+string(filepath.Separator)) {
			continue
		}
		if err := os.Remove(p); err == nil {
			removed++
		}
	}
	n, err := sweepOrphanUploads(ctx, dir)
	if err != nil {
		return removed, err
	}
	return removed + n, nil
}

func sweepOrphanUploads(ctx context.Context, dir string) (int, error) {
	var keys []string
	if err := config.BaseDB.WithContext(config.AllowCrossTenant(ctx)).
		Table("uploaded_files").
		Pluck("storage_key", &keys).Error; err != nil {
		return 0, fmt.Errorf("list surviving upload keys: %w", err)
	}
	claimed := make(map[string]bool, len(keys))
	for _, k := range keys {
		claimed[k] = true
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("read uploads dir: %w", err)
	}
	removed := 0
	for _, e := range entries {
		if e.IsDir() || claimed[e.Name()] {
			continue
		}
		// Never touch dotfiles.
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if err := os.Remove(filepath.Join(dir, e.Name())); err == nil {
			removed++
		}
	}
	return removed, nil
}

func newReport() *Report {
	return &Report{
		Deleted: map[string]int64{},
		Created: map[string]int{},
	}
}

func (r *Report) created(entity string, n int) { r.Created[entity] += n }

func ResetDemo(c echo.Context) error {
	if !running.CompareAndSwap(false, true) {
		return c.JSON(http.StatusConflict, echo.Map{"success": false, "error": "A reset is already in progress. Wait for it to finish before starting another."})
	}
	defer running.Store(false)
	tenantID, ok := auth.TenantFromGin(c)
	if !ok || tenantID == 0 {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "Not signed in."})
	}
	seedDemo := true
	if raw := c.QueryParam("seed"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "The seed parameter must be true or false."})
		}
		seedDemo = parsed
	}
	// context.WithoutCancel because the reseed must outlive the request.
	ctx := config.WithDemoRun(config.WithTenant(context.WithoutCancel(c.Request().Context()), tenantID))
	c.Response().Header().Set("Content-Type", "application/x-ndjson")
	c.Response().Header().Set("Cache-Control", "no-cache, no-transform")
	c.Response().Header().Set("X-Accel-Buffering", "no")
	c.Response().WriteHeader(http.StatusOK)
	enc := json.NewEncoder(c.Response())
	write := func(ev streamEvent) {
		_ = enc.Encode(ev)
		c.Response().Flush()
	}
	empID, _, _ := auth.ActorFromContext(c)
	rep, err := ResetWithOptions(ctx, Options{SeedDemo: seedDemo, KeepEmployeeID: empID}, func(p Progress) {
		write(streamEvent{Step: p.Step, Index: p.Index, Total: p.Total})
	})
	if err != nil {
		write(streamEvent{Error: err.Error()})
		return nil
	}
	write(streamEvent{Done: true, Report: rep})
	return nil
}
