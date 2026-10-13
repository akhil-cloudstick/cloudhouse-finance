package config

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var _ Conn = (*gorm.DB)(nil)

var ErrNoTenantInContext = errors.New("query on a tenant-owned table with no tenant in context")

var tenantScopedTables = map[string]bool{
	"branches": true, "schemes": true, "gold_rates": true, "employees": true,
	"cash_movements": true, "expenses": true, "opening_cash_balances": true,
	"categories": true, "cash_sources": true, "expense_categories": true, "loan_cash_sources": true,
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
	"gold_sales":     true,
	"investments":    true, "investment_plans": true, "investment_payouts": true,
	"audit_log_entries":   true,
	"dashboard_snapshots": true,
	"loan_top_ups":        true, "loan_request_ornaments": true,
	"personal_loan_history": true, "investment_transactions": true,
	"loan_accruals":           true,
	"approval_stage_settings": true, "approval_actions": true,
	"approval_chains": true, "approval_category_modes": true,
	"whatsapp_sessions": true,
}

type Conn interface {
	WithContext(ctx context.Context) *gorm.DB
}

type connCtxKey struct{}

type demoRunCtxKey struct{}

type pinnedCtxKey struct{}

type ConnPinner struct {
	base *gorm.DB
}

type tenantCtxKey struct{}

type crossTenantCtxKey struct{}

type TenantScoped struct {
	TenantID uint `json:"tenant_id" gorm:"index"`
}

func WithConn(ctx context.Context, h *gorm.DB) context.Context {
	return context.WithValue(ctx, connCtxKey{}, h)
}

func WithDemoRun(ctx context.Context) context.Context {
	return context.WithValue(ctx, demoRunCtxKey{}, true)
}

func IsDemoRun(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	v, _ := ctx.Value(demoRunCtxKey{}).(bool)
	return v
}

func connFromContext(ctx context.Context) (*gorm.DB, bool) {
	if ctx == nil {
		return nil, false
	}
	h, ok := ctx.Value(connCtxKey{}).(*gorm.DB)
	return h, ok && h != nil
}

func NewConnPinner(base *gorm.DB) *ConnPinner { return &ConnPinner{base: base} }

func (p *ConnPinner) Base() *gorm.DB { return p.base }

func (p *ConnPinner) WithContext(ctx context.Context) *gorm.DB {
	if h, ok := connFromContext(ctx); ok {
		return h.WithContext(ctx)
	}
	if IsDemoRun(ctx) {
		return p.base.WithContext(ctx)
	}
	if h, ok := pinnedFromContext(ctx); ok {
		return h.WithContext(ctx)
	}
	return p.base.WithContext(ctx)
}

func pinnedFromContext(ctx context.Context) (*gorm.DB, bool) {
	if ctx == nil {
		return nil, false
	}
	h, ok := ctx.Value(pinnedCtxKey{}).(*gorm.DB)
	return h, ok && h != nil
}

func PinConn(ctx context.Context, base *gorm.DB, tenantID uint) (context.Context, func(), error) {
	if tenantID == 0 {
		return ctx, func() {}, fmt.Errorf("pinning a connection with no business: %w", ErrNoTenantInContext)
	}
	sqlDB, err := base.DB()
	if err != nil {
		return ctx, func() {}, err
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return ctx, func() {}, fmt.Errorf("checking out a connection: %w", err)
	}
	handle := base.Session(&gorm.Session{NewDB: true, Context: ctx})
	handle.Statement.ConnPool = conn
	release := releaseFunc(conn)
	if err := handle.Exec(`SELECT set_config('app.tenant_id', ?, false)`, fmt.Sprint(tenantID)).Error; err != nil {
		release()
		return ctx, func() {}, fmt.Errorf("declaring the business to postgres: %w", err)
	}
	return context.WithValue(ctx, pinnedCtxKey{}, handle), release, nil
}

func releaseFunc(conn *sql.Conn) func() {
	var done bool
	return func() {
		if done {
			return
		}
		done = true
		_, _ = conn.ExecContext(context.Background(), `SELECT set_config('app.tenant_id', '', false)`)
		_ = conn.Close()
	}
}

func WithTenant(ctx context.Context, tenantID uint) context.Context {
	return context.WithValue(ctx, tenantCtxKey{}, tenantID)
}

func TenantFromContext(ctx context.Context) (uint, bool) {
	if ctx == nil {
		return 0, false
	}
	v, ok := ctx.Value(tenantCtxKey{}).(uint)
	if !ok || v == 0 {
		return 0, false
	}
	return v, true
}

func AllowCrossTenant(ctx context.Context) context.Context {
	return context.WithValue(ctx, crossTenantCtxKey{}, true)
}

func IsCrossTenantAllowed(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	v, _ := ctx.Value(crossTenantCtxKey{}).(bool)
	return v
}

func primaryTableAndAlias(table string) (name, alias string) {
	t := strings.TrimSpace(table)
	if t == "" {
		return "", ""
	}
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
	if err := db.Callback().Row().Before("gorm:row").Register("tenant:row", scopeCallback); err != nil {
		return err
	}
	return db.Callback().Create().Before("gorm:create").Register("tenant:create", stampCallback)
}

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
		// Deliberately fatal rather than unfiltered.
		_ = db.AddError(ErrNoTenantInContext)
		return
	}
	db.Statement.AddClause(clause.Where{Exprs: []clause.Expression{
		clause.Eq{Column: clause.Column{Table: alias, Name: "tenant_id"}, Value: tenantID},
	}})
}

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

func resolveTable(db *gorm.DB) (name, alias string) {
	if t := db.Statement.Table; t != "" && tenantScopedTables[t] {
		return t, t
	}
	if expr := db.Statement.TableExpr; expr != nil && expr.SQL != "" {
		raw := strings.TrimSpace(expr.SQL)
		if strings.HasPrefix(raw, "(") {
			_ = db.AddError(errors.New("tenant scope: cannot resolve the primary table of a subquery expression; " +
				"use AllowCrossTenant explicitly if this query is deliberately unscoped"))
			return "", ""
		}
		name, alias = primaryTableAndAlias(raw)
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

func ExistsInTenant(ctx context.Context, db Conn, table string, id uint) (bool, error) {
	if !tenantScopedTables[table] {
		return false, fmt.Errorf("ExistsInTenant: %q is not a tenant-scoped table", table)
	}
	var n int64
	err := db.WithContext(ctx).Table(table).Where("id = ?", id).Limit(1).Count(&n).Error
	return n > 0, err
}
