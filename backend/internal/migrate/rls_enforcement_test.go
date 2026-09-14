package migrate

import (
	"database/sql"
	"fmt"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// TestRowLevelSecurityEnforcesWithoutTheApplicationLayer is the test that
// proves the second layer is real.
//
// Every other isolation test in this repository goes through GORM, and so is
// really testing platform.RegisterTenantScope — the Go filter. This one opens
// a raw database/sql connection as the application role, with no GORM, no
// callbacks and no context, and asks the database directly. If it passes,
// isolation no longer depends on the application being correct.
//
// Requires RLS_TEST_ROLE / RLS_TEST_PASSWORD naming a NON-SUPERUSER role with
// DML rights on the scratch database. Superusers bypass RLS, so running this
// as one would pass vacuously — it refuses instead.
func TestRowLevelSecurityEnforcesWithoutTheApplicationLayer(t *testing.T) {
	dbName := os.Getenv("MT_TEST_DB")
	role := os.Getenv("RLS_TEST_ROLE")
	pw := os.Getenv("RLS_TEST_PASSWORD")
	if dbName == "" || role == "" || pw == "" {
		t.Skip("set MT_TEST_DB, RLS_TEST_ROLE and RLS_TEST_PASSWORD to run the database-level isolation probe")
	}

	host := envOr("DB_HOST", "localhost")
	port := envOr("DB_PORT", "5432")
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", role, pw, host, port, dbName)

	raw, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open as %s: %v", role, err)
	}
	defer raw.Close()

	var isSuper bool
	if err := raw.QueryRow(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).Scan(&isSuper); err != nil {
		t.Fatalf("checking superuser: %v", err)
	}
	if isSuper {
		t.Fatalf("RLS_TEST_ROLE=%q is a SUPERUSER — superusers bypass row-level "+
			"security, so this probe would pass without proving anything", role)
	}

	// One connection throughout: app.tenant_id is per-connection state.
	conn, err := raw.Conn(t.Context())
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	defer conn.Close()

	// Seed one row for each of two businesses, as those businesses.
	for _, id := range []int{90001, 90002} {
		if _, err := conn.ExecContext(t.Context(), `SELECT set_config('app.tenant_id', $1, false)`, fmt.Sprint(id)); err != nil {
			t.Fatalf("set tenant %d: %v", id, err)
		}
		if _, err := conn.ExecContext(t.Context(),
			`INSERT INTO banks (tenant_id, name, created_at, updated_at) VALUES ($1, $2, now(), now())`,
			id, fmt.Sprintf("RLSPROBE-%d", id)); err != nil {
			t.Fatalf("seeding bank for tenant %d: %v", id, err)
		}
	}

	t.Run("a query sees only its own business", func(t *testing.T) {
		if _, err := conn.ExecContext(t.Context(), `SELECT set_config('app.tenant_id', '90001', false)`); err != nil {
			t.Fatal(err)
		}
		var other int
		if err := conn.QueryRowContext(t.Context(),
			`SELECT count(*) FROM banks WHERE name = 'RLSPROBE-90002'`).Scan(&other); err != nil {
			t.Fatal(err)
		}
		if other != 0 {
			t.Errorf("business 90001 can see %d of business 90002's rows through raw SQL — "+
				"row-level security is not enforcing", other)
		}
		var own int
		if err := conn.QueryRowContext(t.Context(),
			`SELECT count(*) FROM banks WHERE name = 'RLSPROBE-90001'`).Scan(&own); err != nil {
			t.Fatal(err)
		}
		if own != 1 {
			t.Errorf("business 90001 cannot see its OWN row (got %d) — the policy is too strict", own)
		}
	})

	t.Run("WITH CHECK refuses a write into another business", func(t *testing.T) {
		if _, err := conn.ExecContext(t.Context(), `SELECT set_config('app.tenant_id', '90001', false)`); err != nil {
			t.Fatal(err)
		}
		_, err := conn.ExecContext(t.Context(),
			`INSERT INTO banks (tenant_id, name, created_at, updated_at) VALUES (90002, 'FORGED', now(), now())`)
		if err == nil {
			t.Error("inserted a row into another business — WITH CHECK is missing or wrong")
		}
	})

	t.Run("no business set sees nothing", func(t *testing.T) {
		if _, err := conn.ExecContext(t.Context(), `SELECT set_config('app.tenant_id', '', false)`); err != nil {
			t.Fatal(err)
		}
		var n int
		if err := conn.QueryRowContext(t.Context(), `SELECT count(*) FROM banks`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("a connection with no business set sees %d rows — the default must be to see nothing", n)
		}
	})

	// Clean up as the owning businesses.
	for _, id := range []int{90001, 90002} {
		_, _ = conn.ExecContext(t.Context(), `SELECT set_config('app.tenant_id', $1, false)`, fmt.Sprint(id))
		_, _ = conn.ExecContext(t.Context(), `DELETE FROM banks WHERE name LIKE 'RLSPROBE-%'`)
	}
}

func envOr(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}
