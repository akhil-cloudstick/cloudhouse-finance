package main

import (
	"context"
	"log"

	"ambikagold/backend/internal/app"
	"ambikagold/backend/internal/migrate"
	"ambikagold/backend/internal/platform"
)

// The authResources/staffRoles lists live in internal/migrate now — the
// single copy both this server and `cmd/migrate` seed from, so there is no
// second list anywhere to drift out of sync with the one actually applied.
//
// The wiring itself lives in internal/app, so the multi-tenancy isolation
// harness can build the real router — same middleware, same permission
// gates, same route table — instead of a miniature stand-in that would prove
// nothing about the server that ships. See internal/app/app.go.

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	// The API server migrates its own schema on every boot — see
	// migrate.Run's own doc comment: every step is additive, an idempotent
	// backfill, or a column drop that only runs after that column's data has
	// already been copied forward, so re-running it on an already-migrated
	// database (the normal-restart case) is a no-op. `go run ./cmd/migrate`
	// still exists for a migrate-only invocation (CI, or migrating without
	// starting the HTTP server) — both call the same Run so the two never
	// drift apart.
	if err := migrate.Run(db, cfg); err != nil {
		log.Fatalf("migration failed: %v", err)
	}

	// Tenant isolation is switched on here, AFTER migrations have run: every
	// read, update and delete on a tenant-owned table now carries a
	// tenant_id predicate taken from the authenticated session, and every
	// insert is stamped with it.
	//
	// Registered on the shared handle, so it applies to every query the
	// process makes. A query that reaches a tenant-owned table with no
	// tenant in context FAILS rather than returning unfiltered rows — see
	// platform.ErrNoTenantInContext for why that is the safe default.
	// Deliberate exemptions go through platform.AllowCrossTenant and are
	// greppable in one command.
	if err := platform.RegisterTenantScope(db); err != nil {
		log.Fatalf("registering tenant isolation failed: %v", err)
	}

	application, err := app.Build(db, cfg)
	if err != nil {
		log.Fatalf("application setup failed: %v", err)
	}

	// StartBackgroundJobs is deliberately separate from Build (see its own
	// doc comment): Build is also what the tenant-isolation test harness and
	// any other test calls to get a real router, and those must NOT trigger
	// real WhatsApp sends to real borrowers/business owners.
	application.StartBackgroundJobs(context.Background())

	log.Printf("Ambika Gold API + web app listening on :%s (serving frontend from %s)", cfg.Port, cfg.FrontendDir)
	if err := application.Router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
