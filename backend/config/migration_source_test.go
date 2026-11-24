package config

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
	migrate "github.com/rubenv/sql-migrate"
)

// Needs an empty throwaway database: MIGRATION_TEST_DSN=postgres://user:pw@host/db?sslmode=disable
// A database whose newest applied migration has no file in this checkout must still get the newer files.
func TestMigrationsRunAfterAnAppliedMigrationWithNoFile(t *testing.T) {
	dsn := os.Getenv("MIGRATION_TEST_DSN")
	if dsn == "" {
		t.Skip("MIGRATION_TEST_DSN not set")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	migrate.SetIgnoreUnknown(true)
	run := func() int {
		src, err := migrationSource(db, "../migrations")
		if err != nil {
			t.Fatal(err)
		}
		n, err := migrate.Exec(db, "postgres", src, migrate.Up)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := run(); n == 0 {
		t.Fatal("first run applied nothing")
	}
	if n := run(); n != 0 {
		t.Fatalf("second run applied %d, want 0", n)
	}
	// Another branch's migration is recorded as the newest; the last file here is un-recorded.
	if _, err := db.Exec(`DELETE FROM gorp_migrations WHERE id = (SELECT max(id) FROM gorp_migrations)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO gorp_migrations (id, applied_at) VALUES ('0001_from_another_branch.sql', now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE gorp_migrations SET id = '9999_from_another_branch.sql' WHERE id = '0001_from_another_branch.sql'`); err != nil {
		t.Fatal(err)
	}
	if n := run(); n != 1 {
		t.Fatalf("after the foreign newest entry, applied %d, want the 1 missing file", n)
	}
}
