# Testing two (or more) tenants locally

**Written:** 2026-09-15, alongside the multi-color/logo/font theming work.
**Read first:** `documents/handoff_multitenancy.md` — this doc only adds the
local-testing recipe that matches how production is meant to resolve a
tenant (real subdomains), instead of only the `/login/<slug>` path fallback.

## Why this exists

Production is meant to serve every business from **one deployment** —
`https://ambika.cloudhousesupport.site`, `https://ctfi.cloudhousesupport.site`,
`https://golddemo.cloudhousesupport.site` all hitting the same backend, same
frontend build, same Postgres database, with the tenant resolved from the
subdomain. Today each of those is still a separate Docker deployment (own
clone, own DB) — this doc is about testing the *target* single-deployment,
subdomain-resolved model locally, not the current per-tenant Docker setup.

There is still only **one running backend and one running frontend** in this
recipe. Tenants are never separate processes or ports — they are separate
subdomains and separate rows in the same database, exactly like production
is meant to be.

## 1. Give yourself local subdomains

Pick one (no hosts-file edit needed for the first):

- **`*.localhost`** — every modern browser resolves `anything.localhost` to
  `127.0.0.1` automatically. Use `http://ambika.localhost:3000`,
  `http://ctfi.localhost:3000`.
- **`lvh.me` / `nip.io`** — public DNS that resolves `*.lvh.me`/`*.nip.io` to
  `127.0.0.1`. Useful if a tool in your chain does a real DNS lookup and
  balks at `.localhost`.
- **Hosts file**, if you want names that don't look like dev URLs:
  `127.0.0.1 ambika.local ctfi.local golddemo.local` in
  `C:\Windows\System32\drivers\etc\hosts` (Windows) — needs an admin prompt
  to edit.

`frontend/common/services/tenantSession.ts`'s `businessSlugFromHost()`
already recognizes the first two without configuration; a `.local`
hosts-file name works too since it isn't a reserved label.

## 2. Run backend and frontend once each

```bash
cd backend && go run .          # port 8080, your normal dev DB
cd frontend && npm run dev      # port 3000
```

Nothing here changes per tenant — same as running one business today.

## 3. Create a second (and third) tenant

Either through the superadmin console once it's reachable (see
`documents/handoff_multitenancy.md`'s Step 7 status), or by hand:

```sql
INSERT INTO tenants (name,code,tier_id,status,created_at,updated_at)
  VALUES ('CTFI','ctfi',3,'active',now(),now());
-- then roles/grants/branch/admin employee — see handoff_multitenancy.md's
-- "Creating a second business by hand" for the full block.
```

The tenant's `code` (`ctfi`) is what both the URL path (`/login/ctfi`) and
now the subdomain (`ctfi.localhost:3000`) match against.

## 4. Open each tenant and confirm isolation

- `http://ambika.localhost:3000/login`
- `http://ctfi.localhost:3000/login`

in separate tabs (or separate browser profiles, closer to how two real
customers would never share a tab). Confirm:

- Each shows **its own** name/logo/colors/font — from
  `businessSlugFromHost()` → the public branding endpoint, no `/login/<slug>`
  path segment needed.
- Signing in on one tab does not affect the other (`tenantSession.ts` keys
  sessions per slug regardless of whether the slug came from the path or the
  host).
- Switching tabs never bleeds cached theme: `theme.ts`'s
  `cacheBrandTheme`/`readCachedBrandTheme` are keyed the same way.
- A `/login/<other-slug>` path still works as a manual override on either
  host — the path takes priority over the host, so support can always hand
  someone an explicit link regardless of what subdomain they're on.

## 5. Run the isolation harness

Before and after any change that touches tenant-scoped data (which now
includes the new branding columns — `SecondaryColor`, `AccentColor`,
`FontFamily`, `FontScale`, `LogoScale`, `LogoDisplay` — added to `tenants`,
though note the *tenant* table itself is the ownership boundary, not a
tenant-scoped table, so these particular columns don't need an entry in
`tenantScopedTables`):

```bash
createdb -h localhost -U cloudhouse mt_probe
DB_NAME=mt_probe go run ./cmd/migrate
MT_TEST_DB=mt_probe go test ./internal/platform/ ./internal/tenant/ -v
DB_NAME=mt_probe PORT=8099 FRONTEND_DIR=/nonexistent go run .
```

## What this doc does NOT cover

- **Real production subdomains** — wildcard DNS (`*.cloudhousesupport.site`)
  and a wildcard TLS cert in front of one Docker deployment, replacing the
  current per-tenant Docker Compose stacks. That's an infra change for
  whoever manages the server, not something this repo's code changes on its
  own; this doc only makes the *frontend's* subdomain-reading code (added
  alongside this doc) testable before that infra exists.
- **The superadmin console's own separate app/URL** — still a route inside
  the tenant-facing Next app today (`/superadmin`); extracting it into its
  own deployable app (so it can later be embedded in your ERP) is tracked
  separately and not done here.
