# Handoff — multi-tenancy (tenant separation)

**Goal:** sell gold-app to many independent pawn businesses from one
deployment. Each buys a tier granting a branch quota; Management sees all
their branches; everyone else is locked to one branch and can never see
another business's data.

**Written:** 2026-08-28.
**Branch:** `branch-management`. Working tree clean.
**Baseline commit:** `8998934` — "fix: tenant context in auction
transactions, real loan page count, payment allocation preview", merged into
`develop` at `648d0a3`. All tenancy work described here is **committed**.

> That commit also carries unrelated work from a parallel session (auction
> transaction context, dashboard loan page count, payment-allocation preview,
> `payment_alloc_test.go`). If something in the loan/auction/payment area
> looks unfamiliar, it is probably from there, not from the tenancy work.

**Read first:** `documents/multitenancy_plan.md` — Steps 0–15 written out in
full: what each remaining step involves, and the order to do them in (which is
deliberately not numeric). Then `documents/multitenancy_step0.md` — the constraint audit,
authorization matrix and attack-surface inventory the whole design rests on.
`documents/change_log.md` `[Unreleased]` has the per-step detail.

---

## Where it stands

**Data isolation: ~85% built, and now verified by the Step 14 harness (666
cross-tenant probes, 179 routes classified). As a sellable product: ~30%.**

The isolation is the hard half and it is mostly done. But today you cannot
create a tenant except by hand-written SQL, cannot log into a second one
through the UI, and cannot enforce the tier you would be charging for.

| Step | State |
|---|---|
| 0 — audits, authorization matrix, attack surface | Done |
| 1 — tenant/tier tables, `tenant_id` everywhere, constraints, sequences | Done |
| 2 — isolation layers, context threading, filter live | Done |
| 3 — background jobs, borrower tokens, realtime | Done |
| 4 — file authorization | Done |
| 5 — borrower app audit | **Not started** |
| 6 — Management cross-branch view + switcher | Not started |
| 7 — vendor console, tiers, quota enforcement | **Not started** |
| 8 — hide Administrator, token invalidation | Not started |
| 9 — branding + billing screens | Not started |
| 10 — card payments | Not started |
| 11 — audit logging | Not started |
| 12 — migration safety (stop auto-run on boot) | Not started |
| 13 — per-business rate/usage limits | Not started |
| 14 — automated isolation harness | **Done 2026-08-29** — found a third leak (all 16 reports) |
| 15 — backups, retention, incident plan | Not started |

---

## How the isolation works

Four layers. No single one is the defence.

**1. The business is established at authentication, nowhere else.**
`platform.Claims.TenantID` / `CustomerClaims.TenantID`, set at login from the
employee or customer record. Never read from a header, body, query string or
URL segment. `AuthMiddleware` and `CustomerAuthMiddleware` reject a token with
no tenant (401, "sign in again") rather than defaulting one.

**2. Permission checks run before the query.** Unchanged from before, but
`RequirePermission` now resolves grants under the caller's business.

**3. The automatic query filter** — `platform.RegisterTenantScope`,
registered in `main.go` right after `migrate.Run`. GORM callbacks append
`tenant_id = ?` to every SELECT/UPDATE/DELETE on the 39 scoped tables and
stamp it on INSERT. It hooks **five** callback chains — Query, **Row**,
Update, Delete and Create. Row is the one that was missing, and missing it
meant every `.Scan()` ran unfiltered; see bug 0 below. **A query with no tenant is a hard error**
(`ErrNoTenantInContext`), never an unfiltered query.

**4. Database constraints** — 16 unique indexes are now
`(tenant_id, <column>)`.

### Key files

| File | What |
|---|---|
| `internal/platform/tenant_context.go` | `WithTenant`, `TenantFromContext`, `AllowCrossTenant`, `RequestContext(c)` |
| `internal/platform/tenant_gorm.go` | The filter, `tenantScopedTables`, `resolveTable` |
| `internal/platform/tenant_scope.go` | `TenantScoped` — the embedded marker |
| `internal/platform/sequence.go` | Per-business code allocation |
| `internal/tenant/` | `Tenant`, `Tier`, repository, seeding, `ForEachActive` |
| `internal/upload/` | File records, authenticated serving, upload validation |
| `internal/migrate/migrate.go` | `backfillTenancy`, `createTenantCompositeUniques`, `backfillUploadedFiles` |

### Two rules that will bite you

**Context must reach GORM.** Repositories were built with a boot-time
`*gorm.DB` that carries no request, so ~530 methods take a
`ctx context.Context` first parameter. Handlers get it from
`platform.RequestContext(c)`. **Any new repository method must take ctx and
call `r.db.WithContext(ctx)`** or it fails at runtime with
"no tenant in context".

**Any new model holding business data must embed `platform.TenantScoped` AND
be added to two lists:** `tenantScopedTables` in
`internal/platform/tenant_gorm.go` and `tenantScopedTables` in
`internal/migrate/migrate.go`. Forgetting the first is a **silent
cross-business leak** — see the `uploaded_files` incident below.

### The deliberate opt-outs (13 non-test call sites, in 9 files)

> Recounted 2026-08-29: 13 in 9, not the 12 in 8 below — the list predates
> `internal/tenant/iterate.go:36` (`ForEachActive`, the per-business job
> iterator).

`grep -rn "AllowCrossTenant(" backend/` is the whole audit. Every entry sets
the boundary aside on purpose:

- `internal/migrate/migrate.go` (4) — migrations legitimately span businesses
- `internal/tenant/seed.go` (2), `internal/employee/seed.go`,
  `internal/puritystandard/service.go`, `internal/loan/approval_limit.go` —
  boot-time seeding, no request
- `internal/auth/service.go`, `internal/customerauth/service.go` — the one
  query that legitimately precedes a tenant, because it *establishes* it
- `main.go` — the background-job launcher

If that list grows long, the isolation has stopped being a boundary.

---

## Three bugs found the hard way — read these before writing code

All three are the same failure: something the filter did not cover, covered
silently. None produced an error. **This is why Step 14 exists**, and why its
tests assert coverage against the schema and against GORM's execution paths
rather than against a hand-kept list.

**0. The unfiltered execution path** (found by the harness, 2026-08-29 — the
largest of the three). `.Scan()`, `.Pluck()`, `.Row()` and `.Rows()` go
through GORM's **Row** callback chain, not **Query**. `RegisterTenantScope`
hooked Query, Update, Delete and Create — which reads as exhaustive and is
not — so every `.Scan()` ran with no tenant predicate *and* no
`ErrNoTenantInContext`, because the callback that raises it never fired. All
16 report endpoints are built with `.Scan()`, so every report returned every
business's rows. `TestTenantScopeSQLShapes` could not catch it: it asserts on
`.Count()`, a Query. Now covered per execution path by
`TestTenantScopeCoversEveryExecutionPath`.

**1. The alias leak.** `db.Table("loans l")` — the shape all 16 report
queries use — makes GORM set `Statement.Table` to `"l"` and keep the real
name in `Statement.TableExpr`. A filter reading `Statement.Table` alone looks
up a table called `l`, decides it is not tenant-owned, and returns **every
business's rows with no filter and no error**. Row counts did not reveal it;
it took dumping generated SQL. `resolveTable` now consults both, and
`TestTenantScopeSQLShapes` asserts the predicate on all four query shapes.

**2. The forgotten table.** `uploaded_files` was created with a `tenant_id`
column but never added to `tenantScopedTables`, so the filter skipped it
entirely — one business could read another's customer photos and KYC
documents, **with every test passing**. The pinned-count test could not catch
it because the count still matched.
`TestEveryTenantScopedModelIsFiltered` now compares the filter's set against
`information_schema`, so any table with a `tenant_id` column missing from the
set fails.

All three were silent. None would have surfaced in normal use. **This was the
argument for Step 14, and Step 14 immediately found the third.**

---

## What is NOT verified

**Superseded 2026-08-29 by the Step 14 harness** — `internal/app/isolation_test.go`,
and see `documents/multitenancy_plan.md`. This section's suspicions were
correct, and worse than stated:

- **The 16 report endpoints** were the top worry here ("SQL shape proven;
  never run with two businesses and the rows compared"). Compared at last,
  they were returning **every business's rows** — `.Scan()` bypasses the
  Query callback chain the filter was registered on. Fixed.
- **Every PDF/Excel export** — now walked, all 16 export keys, per run.
- **The borrower app** — its id-addressed routes are probed now. What remains
  of Step 5 is the reasoning about ownership vs tenancy and the borrower
  password-reset/OTP paths.

What is still unverified is a short, specific list: the **10 routes that call
live third parties** (KYC, eSign, Razorpay, WhatsApp), which cannot be probed
without spending someone's real account and must be checked by hand. The
harness pins that count so it cannot grow quietly.

---

## Blockers before a second business can exist

**1. ~~The frontend has zero tenant awareness.~~ BUILT 2026-08-29** — the
per-business link is live for staff: `/login/<slug>`, `/app/<slug>`, sessions
keyed by slug, and `businessCode` carried on login, forgot-password and
reset-password. Proven with two businesses that both have an `admin` user. See
`documents/multitenancy_plan.md` for the detail, including why a slugged URL
needs a server-side fallback under `output: "export"`.

**Still open:** the **borrower app** (`customer-mobile/`) is a separate client
and has not had the same treatment. Its `/customer/auth/*` endpoints already
accept `businessCode`, so it is client work — tracked under Step 5.

**2. No vendor console.** `internal/tenant` deliberately exposes **no HTTP
routes** — tenant administration belongs to the vendor, whose authentication
does not exist yet, and mounting them now would put the most powerful
operations in the system behind ordinary employee login. A tenant can
currently only be created by SQL.

**3. No quota enforcement.** `grep -rn Quota backend/internal/branch/`
returns **0**. `Tier.BranchQuota` is a column nothing reads. This is the
feature the product was requested for.

---

## Link and login — decided, not built

- Slug-based per-business URL: `/login/<slug>`, `/app/<slug>`.
- **Do not derive the slug from the tenant id.** Sequential or reversible
  slugs let anyone walk `/t/1`, `/t/2` and learn how many customers you have.
  It also defeats a protection already in place: a wrong business code
  returns the *same* error as a wrong password precisely so the login page
  cannot enumerate businesses. Use chosen name-based slugs.
- **Bare `/login` must not dead-end** — show a business-code field there.
- **Treat the slug as immutable.** It is part of the identity; changing it
  breaks every saved bookmark.
- **The slug selects, it does not grant.** After login the business comes
  from the token and is never re-read from the URL. Keep it that way.
- ~~**Deferred, and it will bite:**~~ **fixed 2026-08-29.** All businesses
  share one browser origin, and the single `cloudhouse_token` key meant two
  businesses open in two tabs clobbered each other's session. Keys are now
  per-slug (`cloudhouse_token::<slug>`) and owned solely by
  `frontend/common/services/tenantSession.ts` — no other module knows a
  storage key, which is what keeps the next one from being missed. A legacy
  single-key session is migrated on first load, so the deploy does not sign
  everyone out.

---

## Running and testing

```bash
# Build, vet, unit tests (no database needed)
cd backend && go build ./... && go vet ./... && go test ./...

# Isolation tests need a scratch database
createdb -h localhost -U cloudhouse mt_probe
DB_NAME=mt_probe go run ./cmd/migrate
MT_TEST_DB=mt_probe go test ./internal/platform/ ./internal/tenant/ -v

# Clone live data to rehearse a migration
createdb -h localhost -U cloudhouse mt_probe
pg_dump -h localhost -U cloudhouse cloudhouse | psql -q -U cloudhouse -d mt_probe
DB_NAME=mt_probe go run ./cmd/migrate       # run TWICE — must change nothing

# Run the server against the scratch database
DB_NAME=mt_probe PORT=8099 FRONTEND_DIR=/nonexistent go run .
```

`DB_NAME` overrides `.env` because `godotenv.Load()` does not override
existing environment variables. **Always test against a clone — never the
live database.** A pre-tenancy backup exists at
`c:/Users/PC7/Desktop/adithyan/backup-before-tenancy-20260828-154815.sql`.

Creating a second business by hand (no console yet) — needs a tenant, a role,
its grants, a branch, and an employee whose `role_id` points at **its own**
tenant's role:

```sql
INSERT INTO tenants (name,code,tier_id,status,created_at,updated_at)
  VALUES ('Second','second',3,'active',now(),now());
INSERT INTO roles (tenant_id,name,is_active,is_system,created_at,updated_at)
  VALUES (2,'Administrator',true,true,now(),now());
INSERT INTO role_permissions (tenant_id,role_id,permission_id,permission)
  SELECT 2,(SELECT id FROM roles WHERE tenant_id=2),p.id,true FROM permissions p;
INSERT INTO branches (tenant_id,name,code,address,is_active,created_at,updated_at)
  VALUES (2,'B2 HO','BR-01','X',true,now(),now());
INSERT INTO employees (tenant_id,code,name,role,role_id,branch_id,username,password_hash,phone,email,created_at,updated_at)
  SELECT 2,'EMP-01','B2 Admin','Administrator',
         (SELECT id FROM roles WHERE tenant_id=2),
         (SELECT id FROM branches WHERE tenant_id=2),
         'admin', password_hash, '', '', now(), now()
  FROM employees WHERE id=1;
```

Pointing an employee at another tenant's `role_id` produces
"Permission not found" — that is the isolation working, not a bug.

---

## Recommended order

**1. Step 14, the isolation harness — before any more features.** Two silent
leaks have already shipped; Steps 5–10 all add tables and endpoints, each
another chance to repeat it. The harness should, for **every** endpoint,
authenticate as business A and request business B's records by id, asserting
refusal — run as each role, plus expired sessions and suspended businesses,
and covering exports and PDFs. It turns "~40% verified" into a number worth
trusting.

**2. Frontend login + vendor console + quota** — the three things that make a
second business possible at all.

**3. Step 5** (borrower app audit), then 6–15 in plan order.

---

## Loose ends

**Tenancy:**
- 5 code generators still count rows —
  `internal/{customer,employee,packet,scheme}/service.go` and
  `internal/loan/service.go:527`. `platform.NextSequence` exists and is
  seeded past existing codes; the call sites were left because they need a
  tenant in scope, which they now have. Besides colliding, a global count
  **leaks commercial information** — one business's next customer code
  reveals roughly how many customers the others have.
- **30 hardcoded "CloudHouse Finance" strings** across 7 files — SMS and
  WhatsApp bodies, the indemnity bond, PDF exports. Every business's
  borrowers would be messaged under the first business's name. The loan
  statement (`internal/loan/statement.go`) is the only document that gets
  this right today; it reads the tenant's name. Step 9.
- Backfilled `uploaded_files` rows have a **blank content type** —
  deliberately not guessed from the extension. The effect is that
  pre-existing files download rather than display inline.

**Pre-existing, not caused by this work:**
- **Three pledge records are `Active` while their loan says `Released`** —
  LN-00003, LN-00004, and LN-00008 which is **Closed with a ₹30,000 pledge
  still open**. `CompleteRelease` and `RecordBankPledge` now also consult the
  pledge records, so the drift can no longer fool the guards, but these three
  rows are still wrong. Correcting financial records is the owner's call.
- Fresh installs create a branch with an **empty name** — GORM does not
  populate fields from a raw-string `Where` in `FirstOrCreate`. Since
  `branch.FindAll` filters `name <> ''`, that branch is invisible in the
  branch list.

---

## Things that will surprise you

- **`migrate.Run` executes on every server boot** and now alters schema. Step
  12 is to stop that. Until then, every restart runs migrations unattended
  against live data.
- **The tenancy backfill is deliberately the LAST step in `migrate.Run`.**
  Moving it earlier breaks fresh installs: everything seeded afterwards
  (9 roles, ~620 grants, the admin, the head-office branch) is created with
  `tenant_id = 0`, which satisfies NOT NULL so nothing complains — the
  symptom is an admin who cannot log in.
- **Restarting the backend forces every user to log in again.** Sessions
  predating this work carry no business and are rejected rather than guessed.
- **File serving uses a path-scoped HttpOnly cookie**
  (`upload.AuthCookieName`), set at login for staff and borrowers. An `<img>`
  tag cannot send an Authorization header, which is the whole reason.
- **Suspension must never block repayment or gold release.** A suspended
  business still has real borrowers with real loans; blocking someone from
  collecting gold they have paid for is legally indefensible. Suspension
  restricts new lending and administration only.
- **Shared KYC/SMS/WhatsApp credentials stay shared**, by explicit product
  decision, with per-business usage caps and suspension cut-off still to
  build (Step 13). The costs were accepted knowingly: noisy-neighbour rate
  limits, your bill, and weak regulatory attribution.
