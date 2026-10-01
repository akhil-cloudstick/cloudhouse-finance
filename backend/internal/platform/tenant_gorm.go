package platform

import (
	"errors"
	"sort"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrNoTenantInContext is raised when a query touches a tenant-owned table
// without a tenant in context and without an explicit AllowCrossTenant.
//
// It is a hard error on purpose. The tempting alternative — let the query
// through unfiltered — is precisely how one business ends up reading
// another's loan book, and it fails silently and invisibly. Failing loudly
// turns that class of bug into a 500 in development instead of a breach in
// production.
var ErrNoTenantInContext = errors.New("query on a tenant-owned table with no tenant in context")

// tenantScopedTables is the set the filter applies to: every table whose
// model embeds TenantScoped.
//
// Held as an explicit set rather than reflected at runtime so that adding a
// model does not silently opt it into — or out of — filtering. A new table
// missing from here is caught by the isolation test suite, not discovered
// later in a customer's data.
var tenantScopedTables = map[string]bool{
	"branches": true, "schemes": true, "gold_rates": true, "employees": true,
	"cash_movements": true, "expenses": true, "opening_cash_balances": true,
	"cash_sources": true, "expense_categories": true, "loan_cash_sources": true,
	"customers": true, "loans": true, "ornaments": true,
	"ornament_purity_tests": true, "ornament_images": true,
	"loan_approvals": true, "loan_payments": true,
	"bank_pledge_records": true, "bank_pledge_events": true,
	"auction_records": true, "auction_notices": true, "auction_events": true,
	"auction_decision_requests": true, "loan_requests": true,
	"request_approvals": true, "approval_limits": true,
	"loan_drafts": true, "loan_draft_ornaments": true,
	"personal_loans": true, "personal_loan_installments": true,
	"personal_loan_payments": true,
	"ornament_types":         true, "banks": true, "lockers": true,
	"packets": true, "packet_movements": true, "purity_standards": true,
	"reminders": true, "roles": true, "role_permissions": true,
	"communication_logs": true, "customer_otp": true,
	"customer_device_tokens": true, "notifications": true,
	"uploaded_files": true,
	// Gold sales and the investments module. Both shipped with a tenant_id
	// column (they embed platform.TenantScoped) but were never added here,
	// so the filter skipped them entirely and every query ran unscoped —
	// the same defect as the uploaded_files one recorded in
	// internal/app/isolation_manifest_test.go's header, and the reason a
	// gold_sales row existed with tenant_id = 0: unregistered means the
	// create callback never stamped it either.
	"gold_sales":  true,
	"investments": true, "investment_plans": true, "investment_payouts": true,
	// This business's own audit log (Step 11) — tenant-scoped, unlike
	// superadmin.AuditLog (deliberately exempt, see tenant_scope_db_test.go).
	"audit_log_entries": true,
	// Per-day KPI counts behind the mobile dashboard.s trend cards. Shipped
	// with no tenant_id and a globally unique date, so one row held every
	// business's counts summed together and every business read it — see
	// dashboard.Snapshot.s doc comment.
	"dashboard_snapshots": true,
	// Embedded TenantScoped from the start but were never listed here, so
	// the filter skipped them and the create callback never stamped them —
	// their existing rows are repaired from their parent by
	// migrate.backfillTenantFromParent before NOT NULL/RLS apply.
	"loan_top_ups": true, "loan_request_ornaments": true,
	"personal_loan_history": true, "investment_transactions": true,
	// Per-tenant approval-workflow configuration and the audit trail of the
	// flows that have no audit table of their own (see internal/workflow).
	"approval_stage_settings": true, "approval_actions": true,
	"approval_chains": true, "approval_category_modes": true,
}

// TenantScopedTableNames returns every tenant-owned table, in a stable
// sorted order.
//
// This exists so internal/migrate can drive its tenant_id backfill, its
// NOT NULL pass and its composite-unique audit from THIS definition instead
// of keeping a second list of its own. It kept one until now, and the two
// drifted: gold_sales, investments, investment_plans, investment_payouts and
// audit_log_entries were added here but never to migrate's copy, so the
// filter scoped them at runtime while the database never made tenant_id
// mandatory on them — which is exactly how a gold_sales row with
// tenant_id = 0 came to exist. One list cannot disagree with itself.
//
// Sorted rather than map order because migrations must apply in the same
// sequence on every database; a random order makes one failing run hard to
// compare against the next.
func TenantScopedTableNames() []string {
	names := make([]string, 0, len(tenantScopedTables))
	for t := range tenantScopedTables {
		names = append(names, t)
	}
	sort.Strings(names)
	return names
}

// primaryTableAndAlias splits a GORM Statement.Table into the real table
// name and the alias the query refers to it by.
//
// This is not incidental. internal/reports builds every one of its 16
// queries as db.Table("loans l").Joins(...), and several of those joins
// bring in more than one tenant-owned table. An unqualified
// `WHERE tenant_id = ?` against such a query is ambiguous and Postgres
// rejects it outright — so the predicate must be qualified with the primary
// table's alias.
func primaryTableAndAlias(table string) (name, alias string) {
	t := strings.TrimSpace(table)
	if t == "" {
		return "", ""
	}
	// Handles both "loans l" and "loans AS l".
	fields := strings.Fields(t)
	switch len(fields) {
	case 1:
		return fields[0], fields[0]
	case 2:
		return fields[0], fields[1]
	default:
		if strings.EqualFold(fields[1], "AS") {
			return fields[0], fields[2]
		}
		return fields[0], fields[1]
	}
}

// RegisterTenantScope installs the automatic tenant filter on db.
//
// It is one of four layers, not the whole defence — see the multi-tenancy
// plan. The others are: the tenant established at authentication and nowhere
// else (tenant_context.go), an ownership check before the query runs, and
// the composite unique constraints and foreign keys in the database itself.
// This layer's job is to make "I forgot the WHERE clause" impossible, which
// is the failure mode that scales badly across a hundred call sites.
func RegisterTenantScope(db *gorm.DB) error {
	if err := db.Callback().Query().Before("gorm:query").Register("tenant:query", scopeCallback); err != nil {
		return err
	}
	if err := db.Callback().Update().Before("gorm:update").Register("tenant:update", scopeCallback); err != nil {
		return err
	}
	if err := db.Callback().Delete().Before("gorm:delete").Register("tenant:delete", scopeCallback); err != nil {
		return err
	}
	// Row is a SEPARATE callback chain from Query, and forgetting it was a
	// cross-business data leak.
	//
	// .Scan(), .Pluck(), .Row() and .Rows() do not go through the Query
	// chain — GORM routes them through Row — so registering on Query alone
	// left every one of them completely unfiltered: no predicate, and no
	// ErrNoTenantInContext either, because the callback that raises it never
	// ran. All 16 report endpoints are built with .Scan(), so every report
	// returned every business's rows. The isolation harness caught it by
	// comparing rows across two businesses
	// (internal/app/isolation_test.go); the existing SQL-shape tests could
	// not, because they asserted on .Count(), which is a Query.
	//
	// The lesson generalises past this one line: a filter that defends four
	// of GORM's five execution paths reads as complete and is not. See
	// TestTenantScopeCoversEveryExecutionPath.
	if err := db.Callback().Row().Before("gorm:row").Register("tenant:row", scopeCallback); err != nil {
		return err
	}
	// Stamping on create closes the other half: without it, a tenant could be
	// forged by putting someone else's id in a request body.
	return db.Callback().Create().Before("gorm:create").Register("tenant:create", stampCallback)
}

// scopeCallback appends the tenant predicate to reads, updates and deletes.
func scopeCallback(db *gorm.DB) {
	if db.Statement == nil || db.Error != nil {
		return
	}
	ctx := db.Statement.Context
	if IsCrossTenantAllowed(ctx) {
		return
	}

	name, alias := resolveTable(db)
	if name == "" || !tenantScopedTables[name] {
		return
	}

	tenantID, ok := TenantFromContext(ctx)
	if !ok {
		// Deliberately fatal rather than unfiltered. See ErrNoTenantInContext.
		_ = db.AddError(ErrNoTenantInContext)
		return
	}

	db.Statement.AddClause(clause.Where{Exprs: []clause.Expression{
		clause.Eq{Column: clause.Column{Table: alias, Name: "tenant_id"}, Value: tenantID},
	}})
}

// stampCallback sets tenant_id on insert from the context, overwriting
// whatever the struct carried. Trusting the struct would mean trusting a
// request body.
func stampCallback(db *gorm.DB) {
	if db.Statement == nil || db.Error != nil {
		return
	}
	ctx := db.Statement.Context
	if IsCrossTenantAllowed(ctx) {
		return
	}

	name, _ := resolveTable(db)
	if name == "" || !tenantScopedTables[name] {
		return
	}

	tenantID, ok := TenantFromContext(ctx)
	if !ok {
		_ = db.AddError(ErrNoTenantInContext)
		return
	}
	db.Statement.SetColumn("tenant_id", tenantID)
}

// resolveTable reports the primary table a statement targets, and the alias
// to qualify the predicate with.
//
// TableExpr must be consulted FIRST, and getting this wrong is a silent
// data leak rather than an error. For db.Table("loans l") — the shape every
// one of the 16 report queries uses — GORM parses the alias out and sets
// Statement.Table to "l", putting the raw "loans l" in Statement.TableExpr.
// Reading Statement.Table alone therefore looks up a table named "l", finds
// it absent from the scoped set, concludes the query is not tenant-owned,
// and returns every business's rows with no filter and no error.
func resolveTable(db *gorm.DB) (name, alias string) {
	// The common case: Statement.Table already names a real tenant-owned
	// table (db.Table("loans"), or a model-driven query). Checked first and
	// on its own merits, so a stale TableExpr left on a reused statement
	// cannot mislead it.
	if t := db.Statement.Table; t != "" && tenantScopedTables[t] {
		return t, t
	}

	if expr := db.Statement.TableExpr; expr != nil && expr.SQL != "" {
		raw := strings.TrimSpace(expr.SQL)
		// A subquery or function as the primary table is something this
		// filter cannot reason about. Refusing loudly beats guessing: an
		// unrecognised shape that silently skips filtering is the leak
		// above, one layer further down.
		if strings.HasPrefix(raw, "(") {
			_ = db.AddError(errors.New("tenant scope: cannot resolve the primary table of a subquery expression; " +
				"use AllowCrossTenant explicitly if this query is deliberately unscoped"))
			return "", ""
		}
		name, alias = primaryTableAndAlias(raw)
		// GORM has already extracted the alias; prefer its answer.
		if db.Statement.Table != "" {
			alias = db.Statement.Table
		}
		return name, alias
	}
	if db.Statement.Table != "" {
		return primaryTableAndAlias(db.Statement.Table)
	}
	if db.Statement.Schema != nil {
		t := db.Statement.Schema.Table
		return t, t
	}
	return "", ""
}
