package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"log"
)

func ForEachActive(ctx context.Context, label string, fn func(ctx context.Context) error) {
	all, err := FindTenants(config.AllowCrossTenant(ctx))
	if err != nil {
		log.Printf("%s: could not list businesses: %v", label, err)
		return
	}
	for i := range all {
		t := all[i]
		if t.Status != commonModels.StatusActive {
			continue
		}
		tenantCtx := config.WithTenant(ctx, t.ID)
		// Row-level security reads app.tenant_id off the connection, which only a pinned connection carries: without it
		// a job's reads quietly see nothing and its inserts fail the policy's WITH CHECK.
		pinned, release, err := config.PinConn(tenantCtx, config.BaseDB, t.ID)
		if err != nil {
			log.Printf("%s: business %d (%s) failed: %v", label, t.ID, t.Code, err)
			continue
		}
		if err := fn(pinned); err != nil {
			log.Printf("%s: business %d (%s) failed: %v", label, t.ID, t.Code, err)
		}
		release()
	}
}
