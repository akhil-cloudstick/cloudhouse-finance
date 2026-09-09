// Command demoreset wipes this deployment's business records and restores the
// fixed demo dataset.
//
//	go run ./script/demoreset
//
// Use it to prepare a freshly migrated database. Between client meetings the
// same thing is available over HTTP at POST /api/v1/demo/reset (the /reset
// page in the web app), which is the path that matters once the app is
// deployed and there is no terminal to hand.
//
// Both callers run exactly the same code — script/demoseed.Reset — so the two
// cannot drift apart. Run ./cmd/migrate first; this command refuses to touch a
// database whose schema is not current.
//
// It is destructive and takes no confirmation. Everything except the admin
// login, the business record and the global catalogues is deleted. See
// script/demoseed's package comment for the exact guarantees.
package main

import (
	"context"
	"log"
	"sort"

	"cloudhouse/backend/internal/migrate"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/script/demoseed"
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	// Same gate the API server applies at boot. Seeding against a stale
	// schema would fail deep inside a service with a confusing column error.
	if err := migrate.CheckSchemaVersion(db); err != nil {
		log.Fatalf("%v", err)
	}

	// THIS LINE IS LOAD-BEARING. platform.NewDatabase does not install the
	// tenant callbacks; only RegisterTenantScope does, and it is otherwise
	// called from main.go alone. Without it the stamp callback never fires
	// and every row this command writes lands with tenant_id = 0, invisible
	// to the running application — which is exactly the latent bug in
	// cmd/seedpersonalloans. With it, a missing tenant is a loud error
	// instead of silent corruption.
	if err := platform.RegisterTenantScope(db); err != nil {
		log.Fatalf("tenant scope registration failed: %v", err)
	}

	ctx := context.Background()

	// EnsureDefault finds the business by code, so this neither creates a
	// second one nor renames an existing one.
	t, err := tenant.EnsureDefault(db)
	if err != nil {
		log.Fatalf("resolve business: %v", err)
	}

	log.Printf("resetting demo data for business %d (%s)...", t.ID, t.Code)

	rep, err := demoseed.Reset(platform.WithTenant(ctx, t.ID), demoseed.NewDeps(db, cfg))
	if err != nil {
		log.Fatalf("reset failed: %v", err)
	}

	log.Printf("deleted %d rows across %d tables; removed %d upload files",
		totalDeleted(rep), len(rep.Deleted), rep.FilesRemoved)
	for _, entity := range sortedKeys(rep.Created) {
		log.Printf("  seeded %-28s %d", entity, rep.Created[entity])
	}
	log.Printf("done in %dms — the %q login is unchanged", rep.DurationMS, rep.AdminUsername)
}

func totalDeleted(rep *demoseed.Report) int64 {
	var n int64
	for _, v := range rep.Deleted {
		n += v
	}
	return n
}

// sortedKeys keeps the printed summary in a stable order, so two runs can be
// diffed against each other.
func sortedKeys(m map[string]int) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
