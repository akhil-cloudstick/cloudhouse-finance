package platform

import (
	"context"
	"os"
	"testing"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func pinTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("MT_TEST_DB") == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run connection-pinning tests")
	}
	t.Setenv("DB_NAME", os.Getenv("MT_TEST_DB"))
	cfg := LoadConfig()
	db, err := NewDatabase(cfg)
	if err != nil {
		t.Fatalf("open scratch database: %v", err)
	}
	db.Logger = logger.Discard
	return db
}

// TestPinConnDoesNotMutateTheSharedHandle is a regression test for a bug that
// broke the entire process, not just one request.
//
// gorm.Session only clones the Statement when Context, PrepareStmt or
// SkipHooks is set. PinConn originally passed &gorm.Session{NewDB: true} and
// then assigned Statement.ConnPool — which, because the Statement was still
// the SHARED one, repointed every query in the process at that single pinned
// connection and then broke all of them with "sql: connection is already
// closed" as soon as the request finished. The isolation harness caught it as
// cascading 401s and 503s across unrelated endpoints.
//
// The assertion is deliberately about the SHARED handle still working after a
// pin has been taken and released, because that is the property that failed.
func TestPinConnDoesNotMutateTheSharedHandle(t *testing.T) {
	base := pinTestDB(t)

	before := base.Statement.ConnPool

	ctx, release, err := PinConn(context.Background(), base, 1)
	if err != nil {
		t.Fatalf("PinConn: %v", err)
	}

	if base.Statement.ConnPool != before {
		t.Fatal("PinConn replaced the SHARED handle's ConnPool — every query in the " +
			"process is now bound to one request's connection, and will fail once it is released")
	}

	// The pinned handle must actually be pinned, i.e. different from the pool.
	pinned, ok := pinnedFromContext(ctx)
	if !ok {
		t.Fatal("PinConn returned a context with no pinned handle")
	}
	if pinned.Statement.ConnPool == before {
		t.Fatal("the pinned handle is still on the shared pool — nothing was pinned")
	}

	release()

	// The shared pool must still be usable after the pin is released. This is
	// the exact assertion the original bug failed.
	var n int
	if err := base.Raw("SELECT 1").Scan(&n).Error; err != nil {
		t.Fatalf("shared handle is broken after releasing a pinned connection: %v", err)
	}
	if n != 1 {
		t.Fatalf("SELECT 1 returned %d", n)
	}
}

// TestPinConnSetsAndClearsTheBusiness checks both halves of the contract the
// RLS policy depends on: the business is declared on the pinned connection,
// and it is cleared before that connection returns to the pool — otherwise
// the next request to receive it would inherit another business's identity.
func TestPinConnSetsAndClearsTheBusiness(t *testing.T) {
	base := pinTestDB(t)

	ctx, release, err := PinConn(context.Background(), base, 42)
	if err != nil {
		t.Fatalf("PinConn: %v", err)
	}
	pinned, _ := pinnedFromContext(ctx)

	var got string
	if err := pinned.Raw("SELECT current_setting('app.tenant_id', true)").Scan(&got).Error; err != nil {
		t.Fatalf("reading app.tenant_id: %v", err)
	}
	if got != "42" {
		t.Errorf("app.tenant_id on the pinned connection = %q, want \"42\"", got)
	}

	release()

	// Reaching the same backend again is not guaranteed, so this asserts the
	// weaker but meaningful property: no connection in the pool reports 42.
	for i := 0; i < 10; i++ {
		var leaked string
		if err := base.Raw("SELECT current_setting('app.tenant_id', true)").Scan(&leaked).Error; err != nil {
			t.Fatalf("reading app.tenant_id from the pool: %v", err)
		}
		if leaked == "42" {
			t.Fatal("a released connection still reports the previous request's business — " +
				"the next request to receive it would run under the wrong tenant")
		}
	}
}

// TestPinConnRefusesWithoutABusiness — pinning with no business would set an
// empty app.tenant_id, which under RLS matches nothing and would surface as a
// confusing "no data" rather than an error.
func TestPinConnRefusesWithoutABusiness(t *testing.T) {
	base := pinTestDB(t)
	if _, _, err := PinConn(context.Background(), base, 0); err == nil {
		t.Fatal("PinConn accepted tenant 0; it must refuse")
	}
}
