package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"os"
	"testing"

	"gorm.io/gorm"
)

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run tenant iteration tests")
	}
	t.Setenv("DB_NAME", name)
	t.Setenv("MIGRATIONS_DIR", "../../migrations")
	config.InitDB()
	return config.BaseDB
}

func TestForEachActive(t *testing.T) {
	openTestDB(t)
	crossCtx := config.AllowCrossTenant(context.Background())
	all, err := FindTenants(crossCtx)
	if err != nil {
		t.Fatalf("listing tenants: %v", err)
	}
	if len(all) == 0 {
		t.Skip("test database has no tenants")
	}
	var activeCount int
	active := map[uint]bool{}
	for _, x := range all {
		if x.Status == commonModels.StatusActive {
			activeCount++
			active[x.ID] = true
		}
	}
	t.Run("runs once per active business, scoped to it", func(t *testing.T) {
		var seen []uint
		ForEachActive(context.Background(), "test", func(ctx context.Context) error {
			got, ok := config.TenantFromContext(ctx)
			if !ok {
				t.Errorf("callback ran with no tenant in context")
				return nil
			}
			if !active[got] {
				t.Errorf("business %d is not active and should have been skipped", got)
			}
			seen = append(seen, got)
			return nil
		})
		if len(seen) != activeCount {
			t.Errorf("ran for %d businesses, expected %d active", len(seen), activeCount)
		}
	})
	t.Run("one failure does not stop the others", func(t *testing.T) {
		if activeCount < 1 {
			t.Skip("needs at least one active business")
		}
		var ran int
		ForEachActive(context.Background(), "test", func(ctx context.Context) error {
			ran++
			return context.DeadlineExceeded
		})
		if ran != activeCount {
			t.Errorf("stopped after %d of %d businesses — a failure in one must not "+
				"halt reminders for the rest", ran, activeCount)
		}
	})
}
