package tenant

import (
	"context"
	"os"
	"testing"

	"ambikagold/backend/internal/platform"
	"gorm.io/gorm"
)

// DB-backed, like the platform tenant-scope tests: GORM needs a live
// dialector. Skipped unless MT_TEST_DB names a scratch database.
//
//	MT_TEST_DB=mt_probe go test ./internal/tenant/ -v
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run tenant iteration tests")
	}
	t.Setenv("DB_NAME", name)
	db, err := platform.NewDatabase(platform.LoadConfig())
	if err != nil {
		t.Skipf("cannot reach test database %q: %v", name, err)
	}
	return db
}

// ForEachActive is what stands between "send this business's reminders" and
// "text every borrower in the database". These assertions are the contract:
// one pass per active business, each pass scoped to it, suspended ones
// skipped, and one failure never stopping the rest.
func TestForEachActive(t *testing.T) {
	db := openTestDB(t)
	if err := platform.RegisterTenantScope(db); err != nil {
		t.Fatalf("registering tenant scope: %v", err)
	}
	repo := NewRepository(db)
	crossCtx := platform.AllowCrossTenant(context.Background())

	all, err := repo.FindAll(crossCtx)
	if err != nil {
		t.Fatalf("listing tenants: %v", err)
	}
	if len(all) == 0 {
		t.Skip("test database has no tenants")
	}

	var activeCount int
	for _, x := range all {
		if x.Status == StatusActive {
			activeCount++
		}
	}

	t.Run("runs once per active business, scoped to it", func(t *testing.T) {
		var seen []uint
		ForEachActive(context.Background(), repo, "test", func(ctx context.Context, tn Tenant) error {
			got, ok := platform.TenantFromContext(ctx)
			if !ok {
				t.Errorf("business %d: callback ran with no tenant in context", tn.ID)
				return nil
			}
			if got != tn.ID {
				t.Errorf("context carried tenant %d while iterating business %d", got, tn.ID)
			}
			if tn.Status != StatusActive {
				t.Errorf("business %d has status %q and should have been skipped", tn.ID, tn.Status)
			}
			seen = append(seen, tn.ID)
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
		ForEachActive(context.Background(), repo, "test", func(ctx context.Context, tn Tenant) error {
			ran++
			return context.DeadlineExceeded // every pass fails
		})
		if ran != activeCount {
			t.Errorf("stopped after %d of %d businesses — a failure in one must not "+
				"halt reminders for the rest", ran, activeCount)
		}
	})
}
