package upload

import (
	"context"
	"os"
	"path/filepath"
	"strconv"

	"cloudhouse/backend/internal/platform"
)

// TenantDir returns the directory one business's uploaded files live in:
// <root>/<tenant_id>.
//
// Every business's customer photos and KYC documents previously landed in
// one flat directory, separated only by the random id in each filename. That
// was not a data leak — ServeHandler resolves /uploads/<key> through the
// uploaded_files table and refuses any key with no row in the caller's
// business — but it left two real problems:
//
//   - Disk usage could not be attributed to, or capped per, a business. One
//     customer filling the volume takes every other customer down with them,
//     and nothing in the layout says whose bytes they were.
//   - A storage-key collision across businesses would have had two
//     businesses' files at one path. The random id makes that vanishingly
//     unlikely rather than impossible, and "unlikely" is the wrong guarantee
//     for one customer's KYC document overwriting another's.
//
// Splitting by tenant makes both structural instead of probabilistic:
// `du -sh uploads/*` is now a per-business storage report, and two
// businesses cannot share a path at all.
func TenantDir(root string, tenantID uint) string {
	return filepath.Join(root, strconv.FormatUint(uint64(tenantID), 10))
}

// tenantDirFromContext resolves the writing directory for the business in
// ctx.
//
// It fails rather than falling back to the flat root when no tenant is
// present, for the same reason platform.ErrNoTenantInContext is a hard
// error: a file written with no business attached is one nobody can serve
// (ServeHandler always looks it up within a tenant) and nobody can account
// for. Failing at write time is recoverable; discovering it later is not.
func tenantDirFromContext(ctx context.Context, root string) (string, error) {
	tenantID, ok := platform.TenantFromContext(ctx)
	if !ok {
		return "", platform.ErrNoTenantInContext
	}
	return TenantDir(root, tenantID), nil
}

// resolveReadPath returns the on-disk path to serve a stored key from.
//
// Files written before the per-tenant split sit directly in root, so the
// per-tenant path is tried first and the flat legacy path second. The
// fallback is safe because it is reached only after the caller's key has
// already been matched to an uploaded_files row in the caller's own
// business — this function chooses where to read from, never whether the
// caller may read it.
func resolveReadPath(root string, tenantID uint, key string) string {
	scoped := filepath.Join(TenantDir(root, tenantID), key)
	if _, err := os.Stat(scoped); err == nil {
		return scoped
	}
	return filepath.Join(root, key)
}
