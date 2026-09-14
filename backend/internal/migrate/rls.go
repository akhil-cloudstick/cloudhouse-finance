package migrate

import (
	"fmt"
	"log"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// applyRowLevelSecurity puts the tenant boundary inside PostgreSQL.
//
// Until now the boundary lived entirely in Go: platform.RegisterTenantScope
// adds `WHERE tenant_id = ?` to every query that goes through GORM with a
// tenant in context. That is a good layer and it stays. It is also, on its
// own, a promise the application makes about itself — and this codebase has
// broken that promise three times: gold_sales and the investments module
// shipped unfiltered, all sixteen reports leaked because .Scan() takes a
// callback chain nobody had registered, and dashboard_snapshots had no
// tenant column at all.
//
// A policy here cannot be forgotten in the same way. It applies to raw SQL,
// to a report written next year, to a psql session opened with the
// application's own credentials — anything that is not explicitly exempted.
//
// # What makes it actually enforce
//
// Three conditions, and missing any one makes this decorative:
//
//  1. ENABLE ROW LEVEL SECURITY switches policies on for other roles.
//  2. FORCE ROW LEVEL SECURITY additionally applies them to the table's
//     OWNER, who is otherwise exempt. The application connecting as the
//     owner is the normal case here, so this line is load-bearing.
//  3. The application must not be a SUPERUSER. Superusers bypass RLS
//     entirely and FORCE does not change that. checkRLSIsEnforceable below
//     reports loudly when this is not satisfied, because a policy that
//     silently enforces nothing is worse than no policy: it looks like
//     protection in the schema and in code review.
//
// WITH CHECK matters as much as USING. USING filters what a query can SEE;
// WITH CHECK governs what it may WRITE. Without it a caller could insert or
// update a row INTO another business — writing across the boundary rather
// than reading across it.
//
// current_setting's second argument (missing_ok) is true so an unset
// variable yields NULL rather than an error, and `tenant_id = NULL` is
// never true. The default is therefore to see nothing, which is the correct
// direction to fail.
func applyRowLevelSecurity(db *gorm.DB) error {
	for _, table := range platform.TenantScopedTableNames() {
		stmts := []string{
			fmt.Sprintf(`ALTER TABLE %s ENABLE ROW LEVEL SECURITY`, table),
			fmt.Sprintf(`ALTER TABLE %s FORCE ROW LEVEL SECURITY`, table),
			fmt.Sprintf(`DROP POLICY IF EXISTS tenant_isolation ON %s`, table),
			fmt.Sprintf(`CREATE POLICY tenant_isolation ON %s
				USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
				WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)`, table),
		}
		for _, s := range stmts {
			if err := db.Exec(s).Error; err != nil {
				return fmt.Errorf("applying row-level security to %s: %w", table, err)
			}
		}
	}
	log.Printf("tenancy: row-level security applied to %d tables", len(platform.TenantScopedTableNames()))
	return checkRLSIsEnforceable(db)
}

// checkRLSIsEnforceable warns when the policies above cannot actually bite.
//
// It does not fail the migration. Applying the policies is still correct and
// still the right thing to have in the schema; the deployment simply is not
// yet benefiting from them, and the person who needs to know that is the
// operator reading the boot log, not a failed deploy at 3am. The tenant
// filter in Go is still enforcing in the meantime.
func checkRLSIsEnforceable(db *gorm.DB) error {
	var isSuper bool
	if err := db.Raw(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).Scan(&isSuper).Error; err != nil {
		return fmt.Errorf("checking whether the application role is a superuser: %w", err)
	}
	if isSuper {
		log.Printf(`WARNING: row-level security is NOT being enforced.

  The application is connected as %q, which is a PostgreSQL SUPERUSER, and
  superusers bypass every row-level security policy — FORCE ROW LEVEL
  SECURITY does not change that. The policies are in place and correct, but
  they are currently inert: tenant isolation rests entirely on the
  application-side filter in internal/platform/tenant_gorm.go.

  To make them enforce, create a non-superuser role for the application and
  point DB_USER at it:

    CREATE ROLE cloudhouse_app LOGIN PASSWORD '<secret>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    GRANT USAGE ON SCHEMA public TO cloudhouse_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cloudhouse_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cloudhouse_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cloudhouse_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO cloudhouse_app;

  Keep running migrations as the owner/superuser — they must see every row.`, currentUser(db))
	}
	return nil
}

func currentUser(db *gorm.DB) string {
	var u string
	_ = db.Raw(`SELECT current_user`).Scan(&u).Error
	return u
}
