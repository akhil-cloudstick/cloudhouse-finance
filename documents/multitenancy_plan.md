# Multi-tenancy — the plan, Steps 0–15

**Purpose:** the numbered plan referenced throughout
`documents/handoff_multitenancy.md` and `documents/change_log.md` existed only
as a row of one-line labels in a handoff table. This file is that plan written
out, so the remaining work can be picked up without reconstructing it.

**Written:** 2026-08-29. **Branch:** `branch-management`.
**Baseline:** `8998934`, merged into `develop` at `648d0a3`.

**Read alongside:**
- `documents/multitenancy_step0.md` — the constraint audit, authorization
  matrix and attack-surface inventory the whole design rests on.
- `documents/handoff_multitenancy.md` — current state, the two silent leaks
  found the hard way, and the rules for writing tenant-safe code.
- `documents/change_log.md` `[Unreleased]` — per-step implementation detail
  for Steps 1–4.

> **Honesty about detail level.** Steps 0–4 are done and documented. Steps 5,
> 7, 9, 12 and 14 have real specified content, recorded below. Steps 6, 8, 10,
> 11, 13 and 15 were never designed beyond their label — what follows for
> those is the intent plus the constraints already known to apply, and each
> still needs a design pass before implementation.

---

## Status at a glance

| Step | Title | State |
|---|---|---|
| 0 | Audits, authorization matrix, attack surface | Done |
| 1 | Tenant/tier tables, `tenant_id` everywhere, constraints, sequences | Done |
| 2 | Isolation layers, context threading, filter live | Done |
| 3 | Background jobs, borrower tokens, realtime | Done |
| 4 | File authorization | Done |
| 5 | Borrower app audit | **Done** — see below |
| 6 | Management cross-branch view + switcher | **Done** — see below |
| 7 | Superadmin console, tiers, quota enforcement | **Backend done** — see below; frontend UI not built |
| 8 | Hide Administrator, token invalidation | **Partly done** — Administrator hidden, superadmin renamed, a severe cross-tenant role-corruption bug fixed; token invalidation itself not built |
| 9 | Branding + billing screens | **Branding done** — see below; billing screens deferred to Step 10 |
| 10 | Card payments | Not started — label only |
| 11 | Audit logging | **Done (first pass)** — see below |
| 12 | Migration safety (stop auto-run on boot) | **Done** — see below |
| 13 | Per-business rate/usage limits | BUILT 2026-08-29 |
| 14 | Automated isolation harness | **Done** — see below |
| 15 | Backups, retention, incident plan | BUILT 2026-08-29 (documentation only) |

**Data isolation: ~85% built, and now genuinely verified** — 666 cross-tenant
probes across all 9 roles, all 179 routes classified, every list, report and
export compared across two businesses. Building that verification is what
turned up the third and largest leak (all 16 reports); the "~40% verified"
this file previously recorded was, as suspected, too generous.

**As a sellable product: ~30%, unchanged** — a tenant can still only be
created by hand-written SQL, cannot be logged into through the UI, and the
tier you would charge for is not enforced. The harness makes the isolation
trustworthy; it does not make the product sellable.

---

## Order of work — deliberately not numeric

**1. ~~Step 14, the isolation harness~~ — DONE 2026-08-29.** It found a third
leak on its first run, larger than the two before it: all 16 report endpoints
were returning every business's rows. Verification is no longer a spot check —
666 cross-tenant probes across 9 roles run on demand, and no endpoint can be
added without classifying it.

**2. The three blockers that make a second business possible at all.**
Frontend per-business login is **done** (2026-08-29, below) — a second tenant
no longer locks the UI out. The remaining two are both Step 7: the
**superadmin console** (a tenant can still only be created by hand-written
SQL) and **quota
enforcement** (`Tier.BranchQuota` is still a column nothing reads). That is
the next work.

**3. ~~Step 5~~ and ~~Step 6~~ — both DONE 2026-08-29.** The borrower app's
same-business ownership checks are now adversarially tested (9 probes, none
failed) and its app gained the same per-lender code the staff frontend got;
Management now sees every branch of its business with a switcher to narrow
the view, proven not to cross businesses via the same header trick that would
be dangerous if it could widen instead of only narrow.

**4. ~~Step 7's backend~~ — DONE 2026-08-29.** The last of the three original
blockers is now clearable through the API: superadmin auth, one-transaction
business creation, quota enforcement, an append-only audit log. It found and
fixed a bug that predates this whole effort — every fresh install's own Head
Office branch had an empty name and was invisible in the branch list — and a
live gap in the employee JWT that let a customer token's shared `tenantId`
field pass `AuthMiddleware`'s only check. Only the frontend console UI is
left of Step 7.

**5. Steps 8–15** in plan order, plus Step 7's frontend whenever that is
prioritized.

---

## Blockers before a second business can exist

**1. ~~The frontend has zero tenant awareness~~ — BUILT 2026-08-29.**

The blocker was real and is now demonstrated fixed. With two businesses in the
database, both with a user called `admin`:

```
POST /auth/login {admin, admin@123}                     -> "please use your
                     organisation's sign-in link, or enter your business code"
POST /auth/login {admin, admin@123, businessCode:default} -> 200, tenantId 1
POST /auth/login {admin, admin@123, businessCode:acme}    -> 200, tenantId 34
```

The first line is what every UI user would have hit the moment a second
tenant existed. Wrong-code and wrong-password return the *same* error, so the
page still cannot be used to enumerate businesses.

**What was built**

- **`frontend/common/services/tenantSession.ts`** — the one place that knows
  about slugs and session storage. Parses the slug from the path, builds
  `/login/<slug>` and `/app/<slug>` links, and owns the storage keys.
- **Sessions are keyed by slug** (`ambikagold_token::<slug>`), which fixes the
  bug the plan flagged as deferred: one shared key meant two businesses in two
  tabs silently clobbered each other's session. `migrateLegacySession()` moves
  an existing single-key session into the keyed layout, so the deploy does not
  sign everybody out.
- **`businessCode` now travels with all three pre-session endpoints** — login,
  forgot-password and reset-password. The last two matter because a phone
  number is unique only *within* a business, so without it the backend cannot
  tell which employee is asking. The reset flow carries it as `?b=<slug>`.
- **Bare `/login` shows a business-code field**, so a truncated or hand-typed
  URL is not a dead end. Arriving through a slugged link hides the field: that
  business is already named.
- **Every redirect keeps the slug** — the 401 bounce in `httpClient`, the app
  shell's auth guard, the root traffic director, both sign-out buttons, and the
  packet/loan QR labels (a scanned label opened `/app`, which had forgotten
  which business the reader belongs to).

**How a slugged URL resolves, given a static export.** `/login/<slug>` cannot
be a Next dynamic route: `output: "export"` needs every parameter known at
build time via `generateStaticParams`, and tenant slugs are created at runtime
by the vendor. So one static page serves every slugged path and reads the slug
from its own URL — a rewrite in `next dev`, and a fallback in
`internal/webstatic` for production. **Those two must stay in step**: a path
that works in dev and 404s in production would fail on the sign-in link, the
worst place to find out. `internal/webstatic/handler_test.go` pins the
production half, including that a real file always wins over the fallback and
that a slug cannot be used to escape the web root.

Verified against the running server with the built frontend: `/login`,
`/login/acme` and `/app/acme` all 200 and serve byte-identical HTML;
`/login/BAD_SLUG`, `/app/acme/extra`, `/nonsense/acme` and
`/login/..%2f..%2fmain.go` all 404.

**Still to do here:** the slug is currently the tenant's `code` column. Step 7
must keep that immutable once staff have the link, and should stop treating
`default` as a changeable code the moment a second business exists.

The decided design this implements (from Step 0 "Decided"):
- Slug-based per-business URLs: `/login/<slug>`, `/app/<slug>`. **Done for
  staff.** The borrower app (`customer-mobile/`) is a separate client and
  still needs the same treatment — its `/customer/auth/*` endpoints already
  accept `businessCode`, so this is client work, tracked under Step 5.
- **Do not derive the slug from the tenant id.** Sequential or reversible
  slugs let anyone walk `/t/1`, `/t/2` and count your customers, and defeat a
  protection already in place: a wrong business code returns the *same* error
  as a wrong password, precisely so the login page cannot enumerate
  businesses. Use chosen, name-based slugs.
- **Bare `/login` must not dead-end** — show a business-code field there as a
  fallback, or "the link stopped working" becomes the commonest support call.
- **The slug is immutable.** It is part of the identity; changing it breaks
  every saved bookmark. If it must change, keep the old one redirecting.
- **The slug selects, it never grants.** After login the business comes from
  the token and is never re-read from the URL.
- **Password reset carries the business too** — the reset link and the SMS OTP
  lookup both key on a phone that is now unique only within a business.
- ~~**Session storage will bite.**~~ **Fixed.** All businesses share one
  browser origin, and one `localStorage` key meant two businesses in two tabs
  clobbered each other's session. Keys are now per-slug
  (`ambikagold_token::<slug>`), owned by
  `frontend/common/services/tenantSession.ts` — no other module knows a
  storage key any more, which is what stops the next one from being missed.
  Signing out of one business deliberately leaves the other's session alone.

**2. No vendor console** — see Step 7.
**3. No quota enforcement** — see Step 7.

---

## Step 5 — Borrower app audit — BUILT 2026-08-29

**Why it was separate from Step 3.** Step 3 gave borrower tokens a business
(`CustomerClaims.TenantID`, set at OTP verification from the customer's own
record) so the app stopped erroring. It did not audit the app adversarially.

**What the audit found: nothing to fix, once actually tested.** Loan routes go
through `customerOwnedLoan`; payment history, profile/KYC and notifications
each have their own inline ownership check
(`notification.Service.Ack`/`Read` compares `CustomerID`, the profile/KYC
handlers force the id from the JWT). The plan had flagged these as "never
tested with two businesses in play" — they are now, and they hold.

**New in the harness — `TestBorrowerCannotReachAnotherBorrowerAtTheSameBusiness`
(`internal/app/isolation_test.go`).** This is the axis the cross-business
probes cannot answer on their own: two borrowers at the *same* business pass
the tenant filter equally, so the only thing between them is each handler's
own ownership check. A second borrower is seeded per business with a loan, a
payment and a notification, and the first borrower's token is used to request
every one of them. **9 probes, all refused.** A leak here would have been
reachable on the single installation running today — it needs no second
business to exist at all — which is why it is worse than a cross-business leak
in one respect.

**The blocker that did exist: the borrower app, like the staff app, sent no
business code.** `customer-mobile/src/api/auth.ts` called
`requestOtp(phone)`/`verifyOtp(phone, code)` with no `businessCode`, so the day
a second lender existed every borrower would hit
`customerauth.ErrBusinessCodeRequired` ("please open your lender's app link")
with no way to answer it. Fixed the same way as the staff frontend:
- `businessCode` added to both calls, optional and empty-safe for a
  single-lender backend.
- **`src/auth/businessCode.ts`** remembers the lender in SecureStore after a
  *successful* sign-in only — a mistyped code is never persisted and offered
  back.
- The login screen gained an optional "Lender code" field, pre-filled from the
  remembered value.

**Reconfirmed, not just assumed:** a borrower with loans at two businesses
still signs in to each separately — `resolveTenant` in `customerauth.Service`
is per-request, keyed on the business code supplied, exactly like the staff
side. The realtime hub is in-memory and keyed by globally-unique customer id,
so it has no query to filter, and its one database-backed feeder
(`ResendPending`) is already per-business — re-verified, not re-architected.

---

## Step 6 — Management cross-branch view + branch switcher — BUILT 2026-08-29

**Before this:** `platform.AdministratorRole` was the *sole* role that
bypassed branch scoping (`internal/platform/branch_scope.go`). Management saw
only its own branch, exactly like a Cashier — the label in the handoff table
("Management-tier users see every branch") described intent, not the code.

**What changed, and how it stays inside the tenant boundary.**

- **`crossBranchRoles`** (Administrator, Management) replaces the single
  role check in `GetBranchScope`/`EnforceBranchOnWrite`. A cross-branch role
  sees every branch of its *own* business by default.
- **The switcher is a request header, `X-Branch-Id`**
  (`platform.SelectedBranchHeader`) — a client-supplied value, which sounds
  like exactly the thing the tenancy design forbids. The difference from a
  tenant header: this one can only ever **narrow** what the session already
  permits. For a non-cross-branch role it is ignored outright — a Cashier
  cannot widen scope by sending it. For a cross-branch role it replaces "all
  branches" with one, and the result still carries the session's tenant
  predicate, so a branch id belonging to another business matches nothing. The
  header selects a view; it grants nothing — the same principle as the
  business-slug URL in Step 6's frontend work (blockers section, above).
- **`GET /branches/switchable`**, a new endpoint, deliberately *not* gated by
  `GetBranchScope`. The ordinary branch list is itself scoped, so once a
  branch is selected it would return just that one branch — a switcher built
  on it could show a single option and never let the user back to the others.
  Answering "which branches may I switch between" needed a different question,
  not a special case threaded through the scoped one.
- **`platform.branch_scope_test.go`** is table-driven and needs no database: 9
  role/selection combinations for the read side, 6 for the write side. The
  two properties that matter are both pinned explicitly — a cross-branch role
  can narrow, a confined role can never widen no matter what it sends (a
  Cashier sending the header is still pinned to its own branch), and an
  unknown role fails closed (confined), never open.
- **`TestBranchSelectionCannotCrossBusinesses`** in the isolation harness is
  the adversarial version of the same claim: business A's staff, across every
  role, points the switcher at business B's real branch id against 8 routes
  including two reports. No leak. **`TestSwitchableBranchesNeverCrossBusinesses`**
  covers the new endpoint itself.
- **Frontend**: `common/services/branchSelection.ts` owns the selection,
  session-scoped (a lens on the current sign-in, not a durable preference —
  logging in fresh starts at "all branches") and keyed per business slug for
  the same reason `tenantSession` keys the JWT. `BranchSwitcher.tsx` renders
  nothing for a non-cross-branch role and nothing for a one-branch business.
  `auth-context.tsx` exposes `isCrossBranch`/`selectedBranchId`/
  `setSelectedBranch`, and clears the selection on both login and logout so a
  new session never inherits a stale one.

**Still open, from the original constraints:** the Step 0 authorization
matrix's **Branch Manager and Accountant rows are inferred, not stated by the
owner** (Step 0, Open question 2) — worth confirming before treating them as
settled, though neither role is cross-branch so nothing here depends on the
answer.

---

## Step 7 — Vendor (now Superadmin) console, tiers, quota enforcement — BACKEND BUILT 2026-08-29

**The three decisions this was built against** (locked in before coding):
`vendor_users` table + its own JWT scheme (not env-only credentials, not a
separate deployment); branch-quota-only metering (no concurrent-login seats);
first-pass scope of Businesses + Tiers + quota + Audit (Sessions/force-logout
and Billing/GST deferred to their own steps).

### Superadmin identity — a genuinely separate scheme, and a gap closed while building it

`internal/vendor` is a new package: `vendor_users` (no `tenant_id` — a vendor
belongs to no business), `platform.VendorClaims` / `IssueVendorToken` /
`ParseVendorToken`, `platform.VendorAuthMiddleware`. Mounted at
`/api/v1/vendor/*`, a **sibling** of the employee-authenticated `protected`
group in `internal/app/app.go`, never nested inside it — gated *solely* by
`VendorAuthMiddleware`, never by `platform.CRUDPermissions`. The whole point:
a tenant's role grants must have no bearing on who can create or suspend a
business.

Designing the third scheme surfaced a real, previously-untested gap in the
other two: `Claims` (the employee JWT) had **no `type` discriminator** at
all, unlike `CustomerClaims`. Since a customer token also carries `tenantId`,
it decoded structurally into `Claims` with a non-zero `TenantID` and passed
`AuthMiddleware`'s only check — nothing exploited this (permission lookups
fail closed on the resulting zero `RoleID`), but it was live. Fixed:
`Claims` now carries `Type string` (`EmployeeTokenType = "employee"`),
checked by `ParseToken` — accepting a **blank** `Type` (every token issued
before this change) but rejecting any *other* scheme's explicit marker, so no
one is forced to re-login. `VendorClaims`/`ParseVendorToken` are strict from
day one (no legacy superadmin tokens exist). Proven by
`TestVendorRoutesRejectStaffAndBorrowerTokens` — all four directions between
the three schemes, plus that a genuine superadmin token actually works.

### Business creation — one transaction, not five hand-written INSERTs

`vendor.Service.CreateBusiness` replaces the manual SQL recipe the handoff
used to document. One `db.Transaction`: tenant row → `authz.SeedRoles`
(`authz.StaffRoles`, the same 9 roles every business gets) → **full grant to
Administrator only** (`authz.Repository.GrantAllToRole`, new — a loop of
single-row upserts, deliberately *not* a batch insert, because GORM's
tenant-stamp callback stamps a slice create's tenant column onto exactly one
element, not all of them; batch inserts were never previously exercised
under an explicit tenant context, only under `AllowCrossTenant`, where the
stamp is skipped entirely) → first branch ("Head Office") → the admin
employee. Every write after the tenant row runs under
`platform.WithTenant(ctx, newTenant.ID)` (never `AllowCrossTenant`) through
repositories built fresh against the transaction handle — so a vendor-created
business is stamped through the *exact same* path a real session's queries
use, rather than parallel machinery that has to be trusted to agree.

**The other 8 roles start with zero grants** — a new business is locked down
except for its own admin, who configures the rest via the existing
role-permission admin screen, same as an on-prem customer would.

Proven end-to-end by `TestVendorCreatedBusinessIsFullyIsolated`: create a
business through the real HTTP API → its own admin logs in through the
*ordinary* `/auth/login` with the superadmin-chosen code → sees exactly its own
seeded branch → neither existing fixture business can see it or it them.

### A bug this found: every fresh install's Head Office had an empty name

The end-to-end test's first run failed — the new admin saw **zero
branches**. Root cause: `branch.Repository.FirstOrCreateByName`'s
`Where("name = ?", name)` is a raw SQL string condition, and GORM's
`FirstOrCreate` only back-fills a struct field from a WHERE clause that is a
struct or map — a raw string gives it nothing to read a value from. `Attrs()`
didn't repeat `Name`, so every branch this method ever created got an
**empty name**, and `branch.FindAll`'s `WHERE name <> ''` made it invisible.
**This was not superadmin-specific** — `select id,tenant_id,name from branches
where name=''` on the scratch DB showed `id=1, tenant_id=1`: the *original
default tenant's own Head Office*, present since this codebase's first
tenancy migration. (The plan's own "Loose ends" section had already recorded
the symptom without a diagnosed cause.) Fixed in `FirstOrCreateByName` by
repeating `Name` inside `Attrs()`; a new `backfillEmptyBranchNames` migration
step repairs existing rows (`UPDATE branches SET name = 'Head Office' WHERE
name = ''` — safe because that literal is the only name this method has ever
been called with). Confirmed on a fresh migrate: `tenancy: repaired 2
branch(es) with an empty name`, including tenant 1's.

### Quota — enforced, and the concurrency argument tested, not just asserted

`tenant.Repository.ReserveBranchSlot`: locks the tenant row
(`SELECT ... FOR UPDATE`), counts active branches, and runs the caller's
insert/save **inside the same transaction** — closing the race
`CountActiveBranches`'s own doc comment had already warned about ("a plain
count-then-create lets two concurrent requests both pass the check").
`branch.Service.Create` and `Update` (only on the `false -> true` IsActive
transition — reactivation is "the other door people forget") both go through
it; `branch.Repository` gained `CreateTx`/`UpdateTx` to run against the
transaction handle rather than the repo's own bound `db`.

`TestBranchQuotaIsEnforced` proves the whole cycle against a real Starter
(quota 1) business created through the vendor API: a second branch is
refused (409, naming the tier and limit); deactivating the first and creating
a replacement succeeds; reactivating the first while the replacement holds
the slot is refused again.

**Lowering a tier below current usage is deliberately not re-checked at
`ChangeTier` time** — `tenant.StatusOverQuota` exists precisely so this is a
billing conversation, not an outage a business discovers on its own; the
quota bites only where a business tries to *add* a branch.

### Verified against the real running server, not only the harness

Booted with `VENDOR_USERNAME`/`VENDOR_PASSWORD` set, over real HTTP: vendor
login → list tiers → `POST /api/v1/superadmin/businesses` (201) → the new business's own
admin logs in via `/auth/login` with `businessCode` → JWT shows
`"type":"employee"`, correct `tenantId`/`branchId`, branch named "Head
Office" → `GET /api/v1/superadmin/audit-log` shows the `create_business` entry with
actor, reason, and detail.

### Not built in this pass, deliberately

- **The frontend vendor console UI.** Nothing here has a screen yet — every
  verification above went through curl/the isolation harness. A tenant can
  now be created without hand SQL, but only by whoever can construct the
  HTTP request.
- **Sessions/force-logout, Billing & GST** — per the locked-in scope, these
  stay Step 8 and Step 10.
- **Provider-credential ownership** (`api_key_settings`) still is not moved
  to the vendor — the Step 14 finding that any tenant's Administrator can
  overwrite the shared KYC/SMS/WhatsApp credentials for every other business
  is unchanged.

**Suspension rule, unaffected by any of this and worth restating:** a
suspended business still has real borrowers with real loans. Suspension
restricts new lending and administration only — `SuspendBusiness`'s own doc
comment says so, and nothing it does touches `CanWrite`'s exemption for
repayment/gold release.

---

## Step 8 — Hide Administrator, token invalidation

### 8a. Hide Administrator — DONE 2026-08-29

Clarified with the owner: "Administrator" was a single-login testing
convenience from before multi-tenancy existed, not a role that needs
demoting. **The role itself is unchanged** — every tenant still gets its own
Administrator, seeded with full access by `superadmin.Service.CreateBusiness`
(Step 7), and `authz.Role.IsSystem` still protects it from being renamed,
deleted, or having its grants edited. What changed is narrower: a business's
own admin should not be casually minting *more* Administrators through the
ordinary "Add Employee" form.

- `frontend/common/components/modals/EmployeeModal.tsx`: `roleOptionsFor()`
  filters "Administrator" out of the role picker, with one exception — an
  employee who **already holds** the role still shows it correctly when
  being edited, rather than silently blanking the field. The canonical
  `ROLES` whitelist (mirroring the backend's `ValidRoles`) is untouched, so
  validation and existing-employee display are unaffected.
- Also confirmed as the vendor console — the separate cross-tenant login the
  owner asked for as "superadmin" already existed as of Step 7
  (`internal/vendor`); **renamed throughout** rather than built twice:
  package `internal/vendor` → `internal/superadmin`, table `vendor_users` →
  `superadmin_users`, `vendor_audit_logs` → `superadmin_audit_logs`,
  `VendorClaims`/`IssueVendorToken`/`ParseVendorToken`/`VendorAuthMiddleware`
  → their `SuperAdmin*` equivalents, routes `/api/v1/vendor/*` →
  `/api/v1/superadmin/*`, env vars `VENDOR_*` → `SUPERADMIN_*`. Verified
  against the real running server: the old `/vendor/login` 404s, the new
  `/superadmin/login` returns a token carrying `"type":"superadmin"`.

### 8b. Token invalidation — not started

Suspending a business, disabling an employee or changing a role currently
takes effect only when the token expires. There is no revocation path. Note
the existing behaviour to preserve: restarting the backend already forces
every user to re-login, because sessions predating the tenancy work carry no
business and are *rejected rather than guessed*. Revocation must also cover
the path-scoped `/uploads` cookie (`upload.AuthCookieName`), or a revoked
session keeps reading files.

### A severe, unrelated bug found while investigating this — FIXED 2026-08-29

Checking "changing a role currently takes effect only at token expiry" led
first to a worse discovery: **changing a role never took effect for anyone
but tenant 1, and every server restart silently corrupted every other
tenant's employees.**

`internal/migrate.backfillEmployeeRoleID` keeps `employees.role_id` — the
field `RequirePermission` actually authorizes against — in sync with the
free-text `Role` name (`employee.Service.Update` only ever sets the name,
never `RoleID`, which is itself worth knowing independently of this bug).
The old implementation resolved each role NAME's id with **one unscoped
lookup** (`authzRepo.RoleIDByName` under `AllowCrossTenant`, returning
whichever tenant's row Postgres happened to return first — in practice
tenant 1's), then applied that single id in a raw, equally unscoped `UPDATE`
against **every employee in the entire table** whose `Role` name matched,
regardless of business. It ran with no tenant filter active at all by
construction, because `migrate.Run` always executes before
`RegisterTenantScope` in both `main.go` and `cmd/migrate` — migrations
legitimately need to run before enforcement turns on, but this function's
own logic was not tenant-safe on top of that.

**Confirmed by direct inspection, not just reasoned about**: two businesses
seeded with real per-tenant Administrator role ids (10 and 19) both had their
employees' `role_id` silently rewritten to `1` — tenant 1's — after a single
re-run of this function. Since `RequirePermission` resolves permissions by
(the caller's own tenant, this roleId), a roleId belonging to a *different*
tenant's `role_permissions` set matches nothing, so every permission check
starts returning "Permission not found" — for every employee of every tenant
but one, from their very next login after **any** server restart or
`cmd/migrate` run. This would have made every business but the first
unusable the moment a real deployment restarted.

It went undetected by the Step 14 harness only because the harness mints its
test tokens with the correct `roleId` baked in directly, never reading this
column at all, and undetected by the one real end-to-end login test in this
session only because no restart happened between creating that business and
testing it.

**Fixed** with one set-based, per-tenant-correct statement — `UPDATE
employees e SET role_id = r.id FROM roles r WHERE r.tenant_id = e.tenant_id
AND r.name = e.role AND ...` — which by construction can never resolve a role
belonging to a different tenant, because the join itself is keyed on
`tenant_id`. New `internal/migrate/backfill_role_id_test.go`
(`TestBackfillEmployeeRoleIDIsPerTenant`) seeds two tenants with
deliberately different role ids, corrupts both to a third wrong value, runs
the real backfill, and asserts each employee's `role_id` lands on **its own**
tenant's role — never the other's. Verified three ways: the unit test; a
manual corrupt-then-fix cycle against the scratch database; and a full
create-business → restart (`cmd/migrate` re-run) → reboot → login cycle
against a real running server, confirming the same `roleId` (265) survives
the restart that would have collapsed it to `1` under the old code.

---

## Step 9 — Branding — BRANDING DONE 2026-08-29, billing screens deferred to Step 10

**All 31 hardcoded "Ambika Gold Finance" occurrences across 7 files fixed**
(SMS/WhatsApp bodies, the indemnity bond in all three languages, PDF export
letterheads). Rather than thread a `%s` placeholder through 26 separate
format strings, `loan.Service.brandedMessage(ctx, format, args...)` runs the
ordinary `fmt.Sprintf` and then does one `strings.ReplaceAll` of the literal
"Ambika Gold Finance" with the caller's own tenant name — every call site
became a one-word change (`fmt.Sprintf` → `s.brandedMessage`, `ctx` as the
first arg), and the message text itself stayed untouched and reviewable.
`auth.Service`, `customerauth.Service`, `reminder.Service` and
`reports.Service` each gained their own `businessName(ctx)`/`BusinessName(ctx)`
(reminder and reports had no tenant repo access at all before this and needed
one injected). The indemnity bond's `BondData` gained a `BusinessName` field,
populated by `bondDataForLoan`, which needed `ctx` threaded in for the first
time. Every fallback matches `loan/statement.go`'s existing pattern: a
neutral, non-branded label on any lookup failure, never another business's
name. New `internal/loan/branded_message_test.go` proves the substitution and
the no-tenant fallback.

**Not done:** per-business logo, and the billing/subscription screens
themselves — folded into Step 10, which is blocked pending a payment
provider and GST decision (see below).

---

## Step 10 — Card payments — BLOCKED, not attempted

**Deliberately not built.** This step needs two real business decisions
neither this session nor the codebase has: which payment provider ships
first, and GST specifics (SAC code, place-of-supply CGST+SGST vs IGST)
confirmed against a practising CA — the plan's own §12 already says both must
be settled *before* either is built. Fabricating either would mean shipping
compliance-shaped code nobody has actually validated. **No Razorpay webhook
exists yet**; when it does, trust **the stored subscription, never the
payload** (attack-surface item 13). Awaiting those two decisions.

---

## Step 11 — Audit logging — DONE (first pass) 2026-08-29

**New `internal/auditlog` package** — the tenant's own "who did what,"
distinct from `internal/superadmin`'s cross-business one. `Entry` is
tenant-scoped (`platform.TenantScoped`, added to `tenantScopedTables` in
`tenant_gorm.go` — the harness's `TestEveryTenantScopedModelIsFiltered`
caught it immediately when this was first forgotten, exactly as designed).
Wired into **employee create/update/delete** (role transitions logged as
`"role: X -> Y"`) and **branch create/update/deactivate** — the two surfaces
where "who changed this" matters most. `ActorName`/`EntityName` are captured
at write time, so the log stays readable even after the actor or the entity
is later deleted. New permission `"can view audit log"`, read-only route
`GET /audit-log?entityType=&action=`, gated the same single-permission way as
reports. Verified against the real server: creating an employee and a branch
each produced a correct entry with the actor's real name.

**Not done:** coverage of the other ~85 mutating endpoints — this is a first
pass on the two highest-value surfaces, not exhaustive. No superadmin-style
mandatory `reason` field either; ordinary staff actions aren't gated on
typing a justification, only the superadmin console's are.

---

## Step 12 — Migration safety — DONE 2026-08-29

**`migrate.Run` no longer runs on server boot.** New `schema_migrations`
table (one row): `Run()` stamps `CurrentSchemaVersion` as its deliberately
*last* step — deliberate so a failure partway through never gets a version
stamped, same reasoning as the tenancy backfill's own "last step" ordering
below. `main.go` now calls `migrate.CheckSchemaVersion(db)` instead of `Run`,
and `log.Fatalf`s with the exact command to run if the stamp is missing or
doesn't match. `cmd/migrate` is now the **only** place `Run` executes. New
`internal/migrate/schema_version_test.go`; verified against a real server —
dropping `schema_migrations` and starting the binary produces `database
schema is not migrated to this server's expected version: ... — run go run
./cmd/migrate`, and it boots normally once that command has run.

**The ordering trap this preserves — do not step on it.** The tenancy
backfill is deliberately the **last** substantive thing `Run` does, one step
before the version stamp. Moving it earlier breaks fresh installs: everything
seeded afterwards (9 roles, ~620 grants, the admin, the head-office branch) is
created with `tenant_id = 0`, which satisfies NOT NULL so nothing complains.
The only symptom is an admin who cannot log in.

---

## Step 13 — Per-business rate and usage limits — BUILT 2026-08-29

**Shared KYC/SMS/WhatsApp credentials stay shared**, by explicit product
decision, with the costs knowingly accepted: noisy-neighbour rate limits, the
vendor's bill, and weak regulatory attribution. Step 13 is the other half of
that decision — a per-business daily usage cap on each shared channel, so one
tenant cannot spend the whole deployment's shared quota or vendor budget on
its own.

Step 0, Open question 1 flags this as **worth re-confirming before launch**,
since it carries the regulatory exposure. This step does not change that —
it only stops one business from being able to exhaust or dominate the shared
credentials.

**What was built**

`backend/internal/platform/usage_cap.go`:

- `UsageCounter` — `(tenant_id, category, day)` primary key, `count` column.
  Deliberately mirrors `platform.Sequence`'s shape: allocation bookkeeping,
  not business data, so it is exempt from the automatic tenant filter the
  same way `sequences` is (both `tenant_gorm_test.go`'s global-table list and
  `tenant_scope_db_test.go`'s exempt map were updated to include
  `usage_counters` **proactively**, avoiding the exact "forgotten table"
  failure mode Step 11 caught for `audit_log_entries`).
- Categories: `whatsapp`, `sms`, `setu_pan`, `setu_aadhaar`, `setu_esign`.
- `DefaultDailyUsageCap = 2000`, with tighter overrides for the Setu KYC
  categories (200 / 200 / 100) since those cost real money per call.
- `CheckAndRecordUsage(db, tenantID, category) error` — one atomic
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`, so two concurrent
  requests from the same business cannot both slip through half a count over
  the cap the way a separate read-then-write would allow (the same race
  `ReserveBranchSlot` closes for branch quota). Call it **before** the
  outbound send/API call it guards — the point is to stop the call from
  happening at all, not to count it after the fact. Refuses outright if
  `tenantID == 0`: a background/cross-tenant context has no business to
  charge the usage to.
- `ErrUsageCapExceeded` is typed via `httpx.NewConflict` (same convention as
  `ErrLockerFull`, `ErrInUse`, etc.), so `httpx.FailErr` renders it as a
  specific 409 with its own message instead of the generic 400 fallback
  every untyped error gets.

Wired into the two outbound sends that currently sit behind shared
credentials:

- `auth.Service.ForgotPassword` — checks `platform.UsageSMS` before sending
  the reset OTP by SMS.
- `customerauth.Service.RequestOTP` — checks `platform.UsageWhatsApp` before
  sending the borrower login OTP by WhatsApp.

Both guarded by `if tenantID, ok := platform.TenantFromContext(ctx); ok { ... }`
— skipped only when there is genuinely no tenant to charge, never silently
skipped otherwise.

Already in place to build on, unchanged by this step: `tenant.ForEachActive`
skips suspended and cancelled businesses for outbound messaging, precisely so
a business that stopped paying does not keep spending the vendor's credits
and contacting borrowers in its own name — a cap on top of that for the
businesses that *are* active and paying.

**Not covered by this step** — the Setu PAN/Aadhaar/eSign call sites
themselves are not yet wired to `CheckAndRecordUsage` (those integrations are
separately blocked/flaky per the Setu sandbox caveats already on file); the
category constants and caps exist and are ready for that wiring once those
integrations are exercised again.

**Tests** — `backend/internal/platform/usage_cap_test.go`:

- `TestCheckAndRecordUsageEnforcesTheCap` — against a real scratch database,
  overrides the cap for one category to 3 for a fast, deterministic run:
  proves 3 calls succeed and the 4th (the one that would push the count over
  the cap) is refused; proves a different tenant and a different category are
  both unaffected by the exhausted counter.
- `TestCheckAndRecordUsageRequiresATenant` — `tenantID == 0` is refused.

Verified with the same rigor as every other step: `go vet ./...` clean, a
fresh `DROP DATABASE`/`createdb`/`cmd/migrate` cycle, and the full
`MT_TEST_DB=mt_probe go test ./... -count=1` suite green across all packages.

---

## Step 14 — Automated isolation harness — BUILT 2026-08-29

Lives in `backend/internal/app/`:

- `isolation_manifest_test.go` — all **179 routes**, each classified by how
  its isolation is proven (probe / collection / public / self / external /
  global), with a reason for every non-probe.
- `isolation_test.go` — the tests.

`main.go`'s wiring moved into `internal/app` (`app.Build`) so the harness
exercises the **real** router: same middleware chain, same permission gates,
same route table. `main()` is now ~60 lines. Background jobs are deliberately
NOT started by `Build` — the due/overdue sweep messages real borrowers.

**What it runs**

| Test | Needs a DB | What it does |
|---|---|---|
| `TestEveryRouteIsClassified` | no | Fails if any mounted route is missing from the manifest, or any entry no longer matches a route |
| `TestExternalRoutesAreProbedByHand` | no | Pins the 10 un-probeable third-party routes |
| `TestCrossTenantAccessIsRefused` | yes | **666 probes**: every id-addressed route × all 9 roles, asking for another business's record |
| `TestBorrowerCannotReachOtherBorrowers` | yes | Borrower app; also that staff tokens are refused on borrower routes |
| `TestCollectionsDoNotLeak` | yes | 63 list/report/**export** responses checked for another business's marker |
| `TestProviderCredentialsAreDeliberatelyShared` | yes | Pins the shared-credentials decision |
| `TestSessionsWithoutABusinessAreRejected` | yes | No token, expired, wrong-secret, crossed schemes, and business hints in query/headers being ignored |

```bash
go test ./...                                   # the classification gate
createdb -h localhost -U ambikagold mt_probe
DB_NAME=mt_probe go run ./cmd/migrate
MT_TEST_DB=mt_probe go test ./internal/app/ -v  # the probes
```

**Two design points worth keeping**

*Positive controls.* A 404 proves nothing on its own — a typo, a fixture that
never inserted, or a route that 404s for everyone all look like airtight
isolation. Every GET probe also runs as the OWNING business and must succeed;
**28 of 29 do**. The one that does not is
`GET /loans/:id/indemnity-bond/esign/status`, which needs a real eSign
transaction to exist, and the harness says so out loud rather than counting it
as passed.

*Introspective fixtures.* Rows are built by asking `information_schema` for
NOT NULL columns and resolving foreign keys to real parent rows, so a new
column or constraint needs no fixture edit. Fixtures are minimal and NOT
business-valid on purpose: a probe asks whether A can reach B's row, and
existence is all that requires.

### What it found immediately

**1. Every one of the 16 report endpoints returned every business's rows.**
The worst of the three leaks so far, and the same failure mode again.

`.Scan()`, `.Pluck()`, `.Row()` and `.Rows()` do **not** go through GORM's
Query callback chain — they go through **Row**, a separate chain.
`RegisterTenantScope` hooked Query, Update, Delete and Create, which reads as
exhaustive and is not. So every `.Scan()` ran with **no tenant predicate and
no `ErrNoTenantInContext`**, because the callback that raises it never fired.
All 16 reports are built with `.Scan()`. 23 call sites across 8 files were
affected.

The existing SQL-shape tests could not catch it: they assert on `.Count()`,
which is a Query. Proof, before the fix:

```
Count(&n)   -> SELECT count(*) FROM loans l WHERE "l"."tenant_id" = 7
Scan(&rows) -> SELECT l.id FROM loans l WHERE l.deleted_at IS NULL     ← no predicate
```

Fixed by registering the same callback on `Row`. Guarded by
`TestTenantScopeCoversEveryExecutionPath` and
`TestUnscopedContextFailsOnEveryExecutionPath`, which assert **per execution
path** rather than per query shape — the coverage is now checkable instead of
assumed.

Note that only 8 of the 16 reports actually showed another business's rows in
the harness; the other 8 were empty because the fixtures did not match their
date/status filters. All 16 were unfiltered.

**2. `checkLoanBranch` skipped the ownership check for the widest roles.**
It returned `nil` immediately when `branchID == nil` — which is exactly
Administrator and Management, the roles with no branch restriction. The loan's
existence was therefore never verified for them, and endpoints like
`GET /loans/:id/auction/history` answered 200 with an empty list for any id at
all, including another business's. 9 call sites relied on it.

No rows escaped — the follow-up queries are tenant-filtered, so the defence in
depth held. But "no branch restriction" is not the same statement as "no
check". Fixed: the loan is now resolved unconditionally and only the branch
comparison is conditional.

**3. `ListLoansForCustomer` was missing its siblings' ownership guard.**
The only one of the five Customer 360 sub-table methods without the
`customerRepo.FindByID` check, so `GET /customers/:id/loans` returned an empty
200 for another business's customer while the other four returned 404. Fixed.

### Still needing a human

- **The 10 external routes** are excluded from probing because they call live
  KYC/eSign/Razorpay/WhatsApp accounts. They must be checked by hand with two
  businesses. The count is pinned so adding one is a visible diff.
- **Provider credentials are writable by every tenant.** `api_key_settings`
  has no `tenant_id` and one global row per category — the documented shared
  decision. But the routes are mounted for every tenant's Administrator, so
  any customer's admin can not only read the shared credentials but
  **overwrite them for every other business**. "The vendor manages one set of
  credentials" and "every customer can rewrite them" are different
  statements. Ownership belongs in the vendor console (Step 7).

### Why it was needed — the original argument, now confirmed

The argument was empirical, not theoretical — two silent leaks had already
shipped:

1. **The alias leak.** `db.Table("loans l")` — the shape all 16 report queries
   use — makes GORM put `"l"` in `Statement.Table` and the real name in
   `Statement.TableExpr`. A filter reading only `Statement.Table` decides `l`
   is not tenant-owned and returns **every business's rows, with no filter and
   no error.** Row counts did not reveal it; it took dumping generated SQL.
2. **The forgotten table.** `uploaded_files` had a `tenant_id` column but was
   never added to `tenantScopedTables`, so the filter skipped it — one
   business could read another's **customer photos and KYC documents, with
   every test passing.** The pinned-count test could not catch it because the
   count still matched.

Both are now covered by `TestTenantScopeSQLShapes` and
`TestEveryTenantScopedModelIsFiltered` (which compares the filter's table set
against `information_schema`). Those two tests are the model; the harness
generalises them.

**What the harness had to do** (all of this is now built): for **every**
endpoint (179 as mounted), authenticate as
business A and request business B's records by id, asserting refusal —
- run as **each role**, not just Administrator;
- include **expired sessions** and **suspended businesses**;
- cover **exports and PDFs**, the classic blind spot: correct on screen,
  leaking in the file;
- cover the **16 report endpoints**, whose SQL shape is proven but which have
  never been run with two businesses and the rows compared;
- cover **`/uploads/:key`**, including traversal attempts.

**Expect 404, not 403,** for another business's record: a 403 confirms the
record exists and belongs to someone else.

---

## Step 15 — Backups, retention, incident plan — BUILT 2026-08-29 (documentation only)

This step is deliberately documentation, not code: actual backup
infrastructure (where dumps are stored, who/what schedules them, retention
enforcement in a cron) is a deployment decision outside this repo's scope.
What follows is the concrete runbook for **this** project's Postgres +
local-disk-uploads setup, so a backup/restore/incident is never improvised
under pressure.

### What has to be backed up together

Two things, and they must be captured as a **matched pair**, not separately
on different schedules — a database restored to a point where a loan
document existed, paired with an uploads folder from a different point where
it didn't (or vice versa), leaves referenced files missing or orphaned files
with no owner:

1. **The Postgres database** (`ambikagold` by default — `DB_NAME`,
   `DB_HOST`, `DB_USER`, `DB_PASSWORD` in `.env` / `internal/platform/config.go`).
   Holds every business's rows, tenant-scoped or not.
2. **The uploads directory** (`./uploads` by default — `UPLOADS_DIR`).
   Customer photos, KYC documents, indemnity bonds — referenced by path from
   `uploaded_files` rows, but the files themselves live on disk, not in the
   database.

A pre-tenancy backup already exists for reference/recovery of the old
single-tenant data:
`c:/Users/PC7/Desktop/adithyan/backup-before-tenancy-20260828-154815.sql`.

### Backup procedure

```bash
# Run from a host that can reach Postgres. Use `pg_dump -Fc` (custom format)
# rather than plain SQL: it's compressed, and it's required for the
# selective per-table restore this project's isolation model benefits from
# (see "Per-business export" below).
export PGPASSWORD=ambikagold
TS=$(date +%Y%m%d-%H%M%S)
pg_dump -h localhost -U ambikagold -Fc -f "ambikagold-$TS.dump" ambikagold

# The uploads folder, taken as close to the same moment as practical.
tar -czf "ambikagold-uploads-$TS.tar.gz" -C /path/to/backend uploads
```

Store both files together, named with the same timestamp, in the same
off-host location — a restore needs both and needs them from the same run.

**Cadence:** daily is the practical minimum for a live loan ledger (every
day without a backup is a day of transactions permanently at risk); more
frequent (hourly) is worth it once real customer money is flowing, via
Postgres WAL archiving / a managed Postgres provider's point-in-time
recovery rather than more frequent `pg_dump` runs. This repo does not
currently automate either — wiring actual cron/CI for this is deployment
work, not a code change here.

### Restore procedure

```bash
# 1. Create a fresh, empty database — never restore on top of a live one.
createdb -h localhost -U ambikagold ambikagold_restored

# 2. Restore the dump.
pg_restore -h localhost -U ambikagold -d ambikagold_restored --no-owner ambikagold-<TS>.dump

# 3. Restore the matching uploads folder alongside it.
tar -xzf ambikagold-uploads-<TS>.tar.gz -C /path/to/restored/backend

# 4. Point a server at the restored database (DB_NAME=ambikagold_restored)
#    and verify with `migrate.CheckSchemaVersion` (Step 12) before serving
#    real traffic — a dump taken from an older binary can predate the
#    current CurrentSchemaVersion, and Step 12 exists precisely to refuse
#    starting against a database that doesn't match what this server
#    expects, rather than serve against a half-migrated schema.
DB_NAME=ambikagold_restored go run ./cmd/migrate
```

Never restore directly onto the live database name. Restore alongside it,
verify, then cut traffic over — a bad restore should never destroy the
still-good original.

### Per-business export (data portability / a cancelling tenant's own copy)

Because every tenant-owned table carries `tenant_id` (`tenantScopedTables` in
`internal/platform/tenant_gorm.go` is the authoritative list), a single
business's data can be extracted without a special export feature:

```bash
# List the tenant-scoped tables to include (see tenantScopedTables for the
# current list — it changes as tables are added, so read it fresh rather
# than trusting a copy pasted into a runbook).
pg_dump -h localhost -U ambikagold -Fc \
  --table=loans --table=customers --table=employees ... \
  -f "business-<tenant_id>-<TS>.dump" ambikagold
# then filter each table's rows to WHERE tenant_id = <id> during restore,
# or dump with a matching row-level query per table — pg_dump alone dumps
# whole tables, not filtered rows, so a genuinely isolated single-tenant
# export needs a short per-table `COPY (SELECT ... WHERE tenant_id = ?) TO`
# script rather than a bare pg_dump flag.
```

No such script exists yet in this repo; this is the starting point if a
"give me my data" or "give me a copy before you delete my account" request
needs to be honored mechanically rather than by hand.

### Retention on cancellation

`internal/superadmin` already models a business's lifecycle status
(suspended/cancelled — see `tenant.ForEachActive`, which already skips both
for outbound messaging). This step does not add automatic deletion. Until a
retention **policy** is confirmed (how long a cancelled business's data is
kept before deletion is a legal/compliance decision, not an engineering
one), the safe default is: **cancelled businesses' rows and uploaded files
are kept indefinitely, excluded from active outbound messaging, and deleted
only by an explicit, logged, manual action** — never a background sweep. If
a retention window is later confirmed (e.g. "delete 90 days after
cancellation"), it should be a scheduled job scoped to
`tenant_id = <cancelled tenant>` using the same per-business export above to
capture a final copy first.

### Incident procedure (suspected cross-tenant data exposure)

If a cross-tenant leak is suspected or reported (a business seeing another
business's data):

1. **Do not restart the server** as a first response — Step 8's live-session
   revalidation means an active exploit path stays reachable regardless, and
   a restart can lose the in-memory state (recent logs, the exact request)
   needed to diagnose what leaked.
2. **Reproduce with the isolation harness first**, not against production.
   `internal/app/isolation_test.go` (Step 14) is built exactly for this: add
   or run the closest existing probe against a scratch database
   (`MT_TEST_DB=mt_probe go test ./internal/app/ -run TestCrossTenantAccessIsRefused -v`)
   to confirm the shape of the leak — which route, which execution path —
   before touching anything live. Both real leaks found and fixed during
   this project (the `.Table("loans l")` alias leak, and the forgotten
   `uploaded_files` table) were confirmed by dumping generated SQL, not by
   guessing from symptoms.
3. **Contain**: if the leaking route can be identified, the fastest safe
   containment is disabling that specific route (comment out its
   registration in `internal/app/app.go` and redeploy) rather than taking
   the whole server down — loan officers mid-transaction on unaffected
   routes should not lose work for an isolated bug.
4. **Fix and add a regression test in the same change** — every prior fix in
   this project (branch scope, role backfill, the alias leak, the forgotten
   table) shipped with a test that fails without the fix and passes with it,
   added to the permanent suite so the same class of bug cannot silently
   return.
5. **Verify against the full isolation harness** before redeploying:
   `MT_TEST_DB=mt_probe go test ./... -count=1`, plus a real-server curl
   check of the specific route that leaked.
6. **Notify** the affected business(es) — what was exposed, to whom, for how
   long (determinable from access/audit logs — `internal/auditlog` for
   tenant-scoped actions, `internal/superadmin.AuditLog` for
   cross-tenant/superadmin actions — plus web server access logs if
   retained). This project does not currently have a formalized
   notification template or legal-timeline requirement (e.g. breach
   notification law in the relevant jurisdiction) — that is a business/legal
   decision to make before this is needed for real, not an engineering one.

---

## Rules that apply to every remaining step

**Context must reach GORM.** Repositories were built with a boot-time
`*gorm.DB` that carries no request, so ~530 methods take `ctx context.Context`
first. Handlers get it from `platform.RequestContext(c)`. **Any new repository
method must take ctx and call `r.db.WithContext(ctx)`** or it fails at runtime
with "no tenant in context".

**Any new model holding business data must embed `platform.TenantScoped` AND
be added to two lists:** `tenantScopedTables` in
`internal/platform/tenant_gorm.go` *and* `tenantScopedTables` in
`internal/migrate/migrate.go`. Forgetting the first is a **silent
cross-business leak** — that is exactly the `uploaded_files` incident.

**Keep the cross-tenant opt-out list short.** `grep -rn "AllowCrossTenant("
backend/` is the whole audit. As of 2026-08-29 there are **13 non-test call
sites in 9 files** — the handoff says 12 in 8, which predates
`internal/tenant/iterate.go:36`. Every one sets the boundary aside on purpose:
migrations (4), boot-time seeding (5), the two login lookups that legitimately
*precede* a tenant because they establish it, the background-job launcher, and
the per-business job iterator. **If this list grows long, the isolation has
stopped being a boundary.**

**Never test against the live database.** Clone it: `DB_NAME=mt_probe`
overrides `.env`, because `godotenv.Load()` does not override existing
environment variables.

---

## Loose ends carried into this plan

- **5 code generators still count rows** —
  `internal/{customer,employee,packet,scheme}/service.go` and
  `internal/loan/service.go:527`. `platform.NextSequence` exists and is seeded
  past existing codes. Besides colliding, a global count **leaks commercial
  information**: one business's next customer code reveals roughly how many
  customers the others have.
- **Backfilled `uploaded_files` rows have a blank content type**, deliberately
  not guessed from the extension. Pre-existing files therefore download rather
  than display inline.
- **Pre-existing, not caused by the tenancy work:** three pledge records are
  `Active` while their loan says `Released` — LN-00003, LN-00004, and LN-00008
  which is **Closed with a ₹30,000 pledge still open.** `CompleteRelease` and
  `RecordBankPledge` now also consult the pledge records so the drift cannot
  fool the guards, but the rows are still wrong. Correcting financial records
  is the owner's call.
- **Pre-existing:** fresh installs create a branch with an **empty name** —
  GORM does not populate fields from a raw-string `Where` in `FirstOrCreate`.
  Since `branch.FindAll` filters `name <> ''`, that branch is invisible in the
  branch list.
