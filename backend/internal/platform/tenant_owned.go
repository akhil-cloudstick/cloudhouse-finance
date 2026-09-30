package platform

import (
	"context"
	"fmt"
)

// ExistsInTenant reports whether a row with this id exists in table AND
// belongs to the business in ctx.
//
// It exists for "ledger / statement / transactions for :id" endpoints, which
// query a CHILD table (cash_movements, loans, …) filtered by a parent id taken
// from the URL. The tenant filter scopes those child rows, so another
// business's id can never return its data — but it returns 200 with an empty
// list, which still confirms nothing and still lets a caller probe arbitrary
// ids. Checking the parent first turns that into the same 404 every other
// id-addressed route gives for a record the caller does not own.
//
// The query goes through GORM with Table(table), so the automatic tenant
// filter (tenant_gorm.go) adds the tenant predicate — table must be one of
// the tenant-scoped tables or this check proves nothing, which is why it
// refuses any other table outright rather than silently passing.
func ExistsInTenant(ctx context.Context, db DB, table string, id uint) (bool, error) {
	if !tenantScopedTables[table] {
		return false, fmt.Errorf("ExistsInTenant: %q is not a tenant-scoped table", table)
	}
	var n int64
	err := db.WithContext(ctx).Table(table).Where("id = ?", id).Limit(1).Count(&n).Error
	return n > 0, err
}
