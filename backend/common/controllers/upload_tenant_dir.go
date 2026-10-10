package controllers

import (
	"cloudhouse/backend/config"
	"context"
)

func tenantDirFromContext(ctx context.Context, root string) (string, error) {
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return "", config.ErrNoTenantInContext
	}
	return TenantDir(root, tenantID), nil
}
