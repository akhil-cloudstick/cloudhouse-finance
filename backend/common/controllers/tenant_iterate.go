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
		if err := fn(tenantCtx); err != nil {
			log.Printf("%s: business %d (%s) failed: %v", label, t.ID, t.Code, err)
		}
	}
}
