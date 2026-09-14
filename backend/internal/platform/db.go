package platform

import (
	"context"

	"gorm.io/gorm"
)

// DB is the handle repositories and services hold instead of a concrete
// *gorm.DB.
//
// It has exactly one method, and *gorm.DB already satisfies it, so switching
// a struct field from *gorm.DB to platform.DB changes nothing at any of the
// ~250 call sites that do r.db.WithContext(ctx). That is the entire point:
// the tenant already travels in the context, so the one place that knows
// which physical connection a query belongs to is WithContext — and making
// it an interface lets something smarter than a shared pool answer it.
//
// What answers it here is ConnPinner (see pinned_conn.go). Row-Level
// Security identifies the caller's business through a session variable
// (app.tenant_id), and a session variable only means anything if the SET and
// the query provably run on the same backend connection. On a shared pool
// they do not: a concurrent probe measured 460 of 960 statements executing
// under ANOTHER business's tenant id, because each statement independently
// checks out whichever connection happened to be free.
//
// Repositories that deliberately span businesses — internal/tenant,
// internal/superadmin, internal/settings — keep a plain *gorm.DB and are
// wired that way in app.Build, so the difference is visible at construction
// rather than hidden in a call site.
type DB interface {
	WithContext(ctx context.Context) *gorm.DB
}

// Compile-time proof that the concrete handle still satisfies the interface,
// so an accidental change to DB's method set fails here rather than at ~50
// wiring sites.
var _ DB = (*gorm.DB)(nil)
