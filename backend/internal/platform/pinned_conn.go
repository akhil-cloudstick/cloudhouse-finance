package platform

import (
	"context"
	"database/sql"
	"fmt"

	"gorm.io/gorm"
)

// pinnedCtxKey carries the connection-bound handle for one request. Private
// type and unexported, like tenantCtxKey — nothing outside this package can
// put a handle into a context by guessing a key.
type pinnedCtxKey struct{}

// ConnPinner is the platform.DB every tenant-owned repository holds.
//
// WithContext returns the request's PINNED connection when one is present,
// and the shared pool otherwise. Repositories call it exactly as they called
// (*gorm.DB).WithContext before, so none of their ~250 query sites change.
type ConnPinner struct {
	base *gorm.DB
}

func NewConnPinner(base *gorm.DB) *ConnPinner { return &ConnPinner{base: base} }

// Base returns the unpinned shared handle, for the few callers that need a
// concrete *gorm.DB outside any request — migrations, seeders, boot-time
// wiring.
func (p *ConnPinner) Base() *gorm.DB { return p.base }

func (p *ConnPinner) WithContext(ctx context.Context) *gorm.DB {
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

// PinConn checks out ONE connection for the caller's business, tells Postgres
// which business it is, and returns a context carrying a GORM handle bound to
// that exact connection, plus a release function the caller must always
// invoke.
//
// # Why a pinned connection rather than a SET on the pool
//
// Row-Level Security decides what a query may see from
// current_setting('app.tenant_id'), which is per-CONNECTION state. A pooled
// *sql.DB hands each statement whichever connection is free, so a SET and the
// query it was meant for routinely land on different backends. That is not a
// theoretical race: a concurrent probe against this schema measured 460 of
// 960 statements running under another business's tenant id. Pinning removes
// the question — the SET and every subsequent statement of the request share
// one backend by construction.
//
// The value is set with set_config(..., is_local => false) rather than
// SET LOCAL because a request is not a transaction; SET LOCAL would be
// discarded at the first implicit commit. Release resets it before the
// connection returns to the pool, so a connection never carries one
// business's identity into another's request even briefly.
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

	// Context is passed here for a load-bearing reason beyond carrying the
	// context: gorm.Session only clones the Statement when Context,
	// PrepareStmt or SkipHooks is set (gorm.go, func Session). Without it,
	// tx.Statement IS the shared handle's Statement, and the assignment below
	// would repoint EVERY query in the process at this one connection — then
	// break them all with "sql: connection is already closed" the moment this
	// request released it. The isolation harness caught exactly that.
	handle := base.Session(&gorm.Session{NewDB: true, Context: ctx})
	// *sql.Conn satisfies gorm.ConnPool (PrepareContext/ExecContext/
	// QueryContext/QueryRowContext), which is what makes this possible at all.
	// getInstance propagates Statement.ConnPool to each cloned statement, so
	// every query made through this handle keeps the pinned connection.
	handle.Statement.ConnPool = conn

	release := releaseFunc(conn)

	if err := handle.Exec(`SELECT set_config('app.tenant_id', ?, false)`, fmt.Sprint(tenantID)).Error; err != nil {
		release()
		return ctx, func() {}, fmt.Errorf("declaring the business to postgres: %w", err)
	}

	return context.WithValue(ctx, pinnedCtxKey{}, handle), release, nil
}

// releaseFunc clears the business identity before handing the connection
// back, so the next request to receive it cannot inherit one.
//
// The reset runs on context.Background(): the request's own context is
// usually already cancelled by the time a deferred release fires, and a
// cancelled context would skip the reset and return a connection still
// carrying a tenant id.
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
