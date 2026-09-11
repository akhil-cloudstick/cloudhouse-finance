# Change Log

All notable changes to this project are documented here. This log reflects
the actual git history at the time of writing; update it as new commits land.

## [Unreleased]
### Added
- **Multi-tenancy, Steps 8b/9/11/12 — token invalidation, branding, tenant
  audit logging, migration safety.**
  - **Step 8b, token invalidation.** `AuthMiddleware` now revalidates every
    request against the employee's LIVE row (`platform.EmployeeSessionChecker`,
    implemented by `employee.Repository.CurrentSession`) instead of trusting
    the JWT's own role/branch for its whole lifetime. A deleted employee's
    token stops working on the very next request; a role change takes effect
    immediately instead of at next login. Found and fixed a second bug while
    proving this: `employee.Service.Create`/`Update` never set `RoleID` at
    all, only the free-text `Role` name — so a role assignment never actually
    took effect until the next `migrate.Run` backfill happened to run. The
    `/uploads` cookie path got the same revalidation. New tests:
    `TestDeletedEmployeeSessionStopsImmediately`,
    `TestRoleChangeTakesEffectImmediately`.
  - **Step 9, branding.** All 31 hardcoded "CloudHouse Finance" strings
    across 7 files replaced via a new `loan.Service.brandedMessage` helper —
    build the message normally, then `strings.ReplaceAll` the literal name
    with the caller's own tenant's. `auth`/`customerauth`/`reminder`/`reports`
    each gained a `businessName(ctx)`; the indemnity bond template (all 3
    languages) and `bondDataForLoan` were updated too.
  - **Step 11, tenant audit logging.** New `internal/auditlog` (tenant-scoped,
    unlike `internal/superadmin`'s cross-business one), wired into employee
    and branch create/update/delete, a new `"can view audit log"` permission,
    read-only `GET /audit-log`. Caught its own "forgotten table" bug
    immediately via `TestEveryTenantScopedModelIsFiltered` — added to
    `tenantScopedTables` and fixed before it ever shipped unfiltered.
  - **Step 12, migration safety.** `migrate.Run` no longer executes on server
    boot. New `schema_migrations` stamp, written as `Run`'s deliberately last
    step; `main.go` now calls `migrate.CheckSchemaVersion` and refuses to
    start with an exact instruction if it doesn't match. `cmd/migrate` is now
    the only place `Run` executes.
  - All four verified against a real running server, not only the test
    suite, and the full backend test suite passes on a fresh database
    throughout.
- **Multi-tenancy, Step 13 — per-business usage caps.** New
  `platform.UsageCounter`/`CheckAndRecordUsage`, a per-tenant daily cap on
  each shared credential channel (`whatsapp`, `sms`, `setu_pan`,
  `setu_aadhaar`, `setu_esign`) so one business cannot exhaust or dominate
  the shared vendor quota/bill. Atomic
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`, mirroring
  `platform.Sequence`'s shape and exempt from the automatic tenant filter the
  same way. Wired into `auth.Service.ForgotPassword` (SMS OTP) and
  `customerauth.Service.RequestOTP` (WhatsApp OTP); the Setu KYC call sites
  are not wired yet (those integrations are separately blocked per the Setu
  sandbox notes already on file). `ErrUsageCapExceeded` typed via
  `httpx.NewConflict` so it surfaces as a specific 409, not a generic 400.
  New tests: `TestCheckAndRecordUsageEnforcesTheCap`,
  `TestCheckAndRecordUsageRequiresATenant`. Verified with `go vet`, a fresh
  migrate cycle, and the full test suite green.
- **Multi-tenancy, Step 15 — backups, retention, incident plan
  (documentation only).** Added a concrete runbook to
  `documents/multitenancy_plan.md`: paired database + uploads backup/restore
  procedure for this project's Postgres + local-disk-uploads setup, a
  per-business export approach (using the existing `tenant_id` columns —
  `tenantScopedTables` — rather than a new export feature), a retention
  default for cancelled businesses (kept indefinitely, excluded from
  outbound messaging, deleted only by explicit manual action pending a
  confirmed retention policy), and an incident procedure for a suspected
  cross-tenant leak that reuses the Step 14 isolation harness to reproduce
  and confirm before touching anything live. No code changes — actual backup
  scheduling/automation is deployment infrastructure outside this repo.

### Fixed
- **SEVERE: every server restart silently corrupted every business's
  employees to another tenant's role, making all permission checks fail for
  everyone but the first tenant.** Found while investigating Step 8's token
  invalidation ("changing a role only takes effect at token expiry"), not by
  any test — the real bug was worse: changing a role never took effect for
  any tenant but the first, and it got actively worse on every restart.
  - `internal/migrate.backfillEmployeeRoleID` keeps `employees.role_id` — the
    field `RequirePermission` actually authorizes against — in sync with the
    free-text `Role` name (`employee.Service.Update` only ever sets the
    name, never `RoleID`). The old implementation resolved each role NAME's
    id with **one unscoped lookup** (`authzRepo.RoleIDByName` under
    `AllowCrossTenant`, returning whichever tenant's row Postgres happened to
    return first — in practice tenant 1's), then applied that single id in a
    raw `UPDATE` against **every employee in the entire table** whose `Role`
    name matched, regardless of business. It ran with zero tenant filtering
    at all, by construction — `migrate.Run` always executes before
    `RegisterTenantScope` in both `main.go` and `cmd/migrate` — and its own
    logic was not tenant-safe on top of that.
  - Confirmed by direct inspection: two businesses seeded with real
    per-tenant Administrator role ids (10, 19) both had their employees'
    `role_id` silently rewritten to `1` after one re-run of this function.
    Since `RequirePermission` resolves permissions by (the caller's own
    tenant, this roleId), the corrupted id then points at a *different*
    tenant's `role_permissions` set, so every check returns "Permission not
    found" — for every employee of every tenant but one, starting with their
    very next login after any restart or `cmd/migrate` run.
  - Undetected by the isolation harness only because it mints test tokens
    with the correct `roleId` baked in directly, bypassing this column
    entirely; undetected by the one real end-to-end login test in this
    session only because no restart happened in between.
  - Fixed with one set-based statement — `UPDATE employees e SET role_id =
    r.id FROM roles r WHERE r.tenant_id = e.tenant_id AND r.name = e.role
    AND ...` — correct by construction, since the join is keyed on
    `tenant_id`. New `internal/migrate/backfill_role_id_test.go`
    (`TestBackfillEmployeeRoleIDIsPerTenant`) seeds two tenants with
    different role ids, corrupts both to a third value, and asserts each
    lands back on its own tenant's role. Verified three ways: the unit test,
    a manual corrupt-then-fix cycle, and a full create-business → restart
    (`cmd/migrate` re-run) → reboot → login cycle against a real running
    server — the same `roleId` (265) survived the restart that would have
    collapsed it to `1` under the old code.
- **Every fresh install's own "Head Office" branch had an empty name and was
  invisible in the branch list.** Found while proving Step 7's business
  creation end-to-end, not specific to it: `branch.Repository
  .FirstOrCreateByName`'s `Where("name = ?", name)` is a raw SQL string
  condition, and GORM's `FirstOrCreate` only back-fills a struct field from a
  WHERE clause that is a struct or map — a raw string gives it nothing to
  read a value from. `Attrs()` didn't repeat `Name`, so this method's created
  row always got an empty name, and `branch.FindAll`'s `WHERE name <> ''`
  hid it. Confirmed on the scratch database's tenant 1 — the very first
  tenant this codebase ever created. Fixed by repeating `Name` inside
  `Attrs()`; a new migration step (`backfillEmptyBranchNames`) repairs
  existing empty-named rows (`UPDATE branches SET name = 'Head Office' WHERE
  name = ''` — safe, since that literal is the only name this method has
  ever been called with). Verified: a fresh migrate reports "repaired 2
  branch(es) with an empty name" including tenant 1's own.
- **The employee JWT had no scheme discriminator**, unlike the customer one.
  Found while adding the vendor scheme as a third token type: a customer
  token shares the `tenantId` JSON key with the employee `Claims` struct, so
  it decoded structurally into `Claims` with a non-zero `TenantID` and passed
  `AuthMiddleware`'s only check — nothing in the codebase exploited this
  (permission lookups fail closed on the resulting zero `RoleID`), but it was
  live and untested. Fixed: `Claims` now carries `Type string` stamped
  `"employee"`; `ParseToken` accepts a blank `Type` (every token issued
  before this change, so nobody is forced to re-login) but rejects any
  *other* scheme's explicit marker.

### Added
- **Multi-tenancy, Step 8a: the vendor console is renamed to "superadmin",
  and "Administrator" is hidden from the employee-creation form.** Two
  changes, both from the same conversation with the product owner:
  clarifying that "Administrator" was a single-login testing convenience
  from before multi-tenancy existed (the role itself, and every tenant's own
  Administrator, is unchanged — `authz.Role.IsSystem` still protects it),
  and confirming that the console built in Step 7 below IS the separate
  cross-tenant "superadmin" login being asked for, just needing its name to
  match.
  - **Renamed throughout, mechanically, no behavior change**: package
    `internal/vendor` → `internal/superadmin`; table `vendor_users` →
    `superadmin_users`, `vendor_audit_logs` → `superadmin_audit_logs`;
    `platform.VendorClaims`/`IssueVendorToken`/`ParseVendorToken`/
    `VendorAuthMiddleware` → their `SuperAdmin*` equivalents; routes
    `/api/v1/vendor/*` → `/api/v1/superadmin/*`; env vars `VENDOR_USERNAME`/
    `VENDOR_PASSWORD`/`VENDOR_NAME` → `SUPERADMIN_USERNAME`/
    `SUPERADMIN_PASSWORD`/`SUPERADMIN_NAME`; every isolation-harness test,
    manifest entry and fixture updated to match (`classVendor` →
    `classSuperAdmin`, `TestVendorRoutesRejectStaffAndBorrowerTokens` →
    `TestSuperAdminRoutesRejectStaffAndBorrowerTokens`, etc.). Generic prose
    uses of "the vendor" meaning "us, the company selling this software"
    (e.g. `tenant.Tier`'s "a plan the vendor sells") were deliberately left
    alone — only the console's own identifiers moved. Verified against the
    real running server: the old `/api/v1/vendor/login` now 404s, the new
    `/api/v1/superadmin/login` returns a token carrying `"type":"superadmin"`.
  - **`frontend/common/components/modals/EmployeeModal.tsx`**: a new
    `roleOptionsFor()` filters "Administrator" out of the Add/Edit Employee
    role picker, with one exception — an employee who already holds it still
    shows correctly when being edited, rather than the field silently going
    blank. The canonical `ROLES` whitelist (mirrored from the backend's
    `ValidRoles`) is untouched, so validation and existing-employee display
    are unaffected; only the picker's options are narrowed.
- **Multi-tenancy, Step 7 (backend): vendor console, business creation, and
  branch quota enforcement.** The last of the three original blockers to a
  second business — until now a tenant could only be created by hand-written
  SQL. Built against three decisions locked in beforehand: `vendor_users` +
  its own JWT scheme (not env-only credentials, not a separate deployment),
  branch-quota-only metering (no concurrent-login seats), and a first pass
  scoped to Businesses + Tiers + quota + Audit (Sessions/force-logout and
  Billing/GST deferred to their own steps). **Only the backend — no frontend
  console UI yet.**
  - **New `internal/vendor` package.** `vendor_users` (no `tenant_id` — a
    vendor belongs to no business), `platform.VendorClaims` /
    `IssueVendorToken` / `ParseVendorToken` / `VendorAuthMiddleware`. Mounted
    at `/api/v1/vendor/*`, a SIBLING of the employee-authenticated group in
    `internal/app/app.go`, never nested inside it, gated solely by
    `VendorAuthMiddleware` — never `platform.CRUDPermissions` — so a tenant's
    role grants can have no bearing on who reaches these routes.
  - **`vendor.Service.CreateBusiness`** replaces the handoff's five
    hand-written INSERTs with one transaction: tenant row → `authz.SeedRoles`
    → full grant to Administrator only (new `authz.Repository
    .GrantAllToRole`, a loop of single-row upserts rather than a batch
    insert — GORM's tenant-stamp callback only reliably stamps one element of
    a slice create, and this path had never been exercised under an explicit
    tenant context before) → first branch → the admin employee. Every write
    after the tenant row runs under `platform.WithTenant(ctx, newTenant.ID)`
    through repositories built fresh against the transaction handle, so a
    vendor-created business is stamped through the exact same path a real
    session's queries use. The other 8 roles start with zero grants — a new
    business is locked down except for its own admin, same as an on-prem
    customer.
  - **`tenant.Repository.ReserveBranchSlot`** closes the race
    `CountActiveBranches`'s own doc comment had already flagged: locks the
    tenant row, counts active branches, and runs the insert/save inside the
    SAME transaction. Wired into `branch.Service.Create` and into `Update`
    only on the `false -> true` IsActive transition (reactivation is "the
    other door people forget"); new `branch.Repository.CreateTx`/`UpdateTx`
    run against the transaction handle instead of the repo's own bound db.
  - **Isolation harness additions**: a new `classVendor` manifest class (mounted
    under `/vendor`, legitimately cross-tenant by design — the ordinary
    "another business's data is a leak" probe does not apply);
    `TestVendorRoutesRejectStaffAndBorrowerTokens` (all four directions
    between the three JWT schemes, plus that a genuine vendor token actually
    works); `TestVendorCreatedBusinessIsFullyIsolated` (create a business
    through the real HTTP API, its own admin logs in via the ordinary
    `/auth/login`, sees only its own seeded branch, neither existing fixture
    business can see it or it them); `TestBranchQuotaIsEnforced` (a real
    Starter/quota-1 business: second branch refused 409, replacement after
    freeing the slot succeeds, reactivating the original while at quota is
    refused again).
  - Verified against the real running server, not only the harness: vendor
    login → list tiers → create a business (201) → its own admin logs in
    with `businessCode` → JWT shows `"type":"employee"`, correct
    `tenantId`/`branchId`, a correctly-named "Head Office" branch → the audit
    log shows the `create_business` entry with actor, reason and detail.
  - `internal/migrate.Run` now takes `platform.Config`, needed to seed the
    first vendor login (`VENDOR_USERNAME`/`VENDOR_PASSWORD`/`VENDOR_NAME`,
    create-only, same shape as `employee.SeedAdmin` but with no safe fixed
    password to bake in for a console that can create and suspend every
    business on the deployment). All three call sites (`main.go`,
    `cmd/migrate`, the isolation harness) updated.
  - **Deliberately not done here:** the frontend console UI; Sessions/
    force-logout and Billing & GST (their own steps); moving
    `api_key_settings` ownership to the vendor (the Step 14 finding that any
    tenant's Administrator can overwrite the shared provider credentials for
    every other business is unchanged).
- **Multi-tenancy, Step 6: Management sees every branch, with a switcher.**
  `platform.AdministratorRole` was previously the sole role that bypassed
  branch scoping — Management was confined to its own branch exactly like a
  Cashier, though the plan's own status table had recorded the opposite as
  already true.
  - `crossBranchRoles` (Administrator, Management) replaces the single-role
    check in `GetBranchScope`/`EnforceBranchOnWrite`.
  - The switcher is a request header, `X-Branch-Id`. That is a client-supplied
    value in a design whose whole premise is that the business never comes
    from one — the difference is that this header can only **narrow** what
    the session already permits, never widen it: ignored outright for a
    non-cross-branch role, and for a cross-branch role it still runs inside
    that session's tenant predicate, so a branch id belonging to another
    business matches nothing.
  - New `GET /branches/switchable`, deliberately not scoped by
    `GetBranchScope`: the ordinary branch list is itself branch-scoped, so
    once a selection is active it would return just the one selected branch
    — a switcher built on it could show a single option and no way back to
    the others.
  - `internal/platform/branch_scope_test.go`: table-driven, no database. Two
    properties pinned explicitly — a cross-branch role can narrow, a confined
    role can never widen no matter what it sends, and an unknown role fails
    closed rather than open.
  - Isolation harness additions: `TestBranchSelectionCannotCrossBusinesses`
    (every role, 8 routes including two reports, switcher pointed at another
    business's real branch id — no leak) and
    `TestSwitchableBranchesNeverCrossBusinesses`.
  - Frontend: `common/services/branchSelection.ts` (session-scoped, keyed per
    business slug like the JWT), `BranchSwitcher.tsx` (renders nothing for a
    non-cross-branch role or a one-branch business), and `auth-context.tsx`
    exposing `isCrossBranch`/`selectedBranchId`/`setSelectedBranch`, cleared on
    both login and logout.
- **Multi-tenancy, Step 5: the borrower app audited, and given a lender
  code.** The audit found the existing ownership checks hold —
  `customerOwnedLoan` plus each handler's own `CustomerID` comparison — but
  turned up the same lockout the staff frontend had: `customer-mobile`'s
  `requestOtp`/`verifyOtp` sent no `businessCode`, so a second lender would
  lock every borrower out with "please open your lender's app link" and no way
  to answer it.
  - New isolation-harness test,
    `TestBorrowerCannotReachAnotherBorrowerAtTheSameBusiness`: two borrowers
    at the SAME business, one asking for the other's loan, payment and
    notification. This is the axis the cross-business probes cannot cover —
    both rows pass the tenant filter equally, so only each handler's own
    ownership check stands between them. 9 probes, all refused.
  - `businessCode` added to both OTP endpoints; `src/auth/businessCode.ts`
    remembers the lender in SecureStore after a successful sign-in only, so a
    mistyped code is never persisted and offered back; the login screen
    gained an optional, pre-filled "Lender code" field.
  - Reconfirmed rather than assumed: a borrower with loans at two businesses
    still signs in to each separately (`customerauth.Service.resolveTenant`
    is per-request, keyed on the supplied code, exactly like the staff side).
- **Per-business sign-in links — the frontend is tenant-aware.** Until now
  `businessCode` and `tenantId` appeared nowhere in `frontend/`, and
  `authService.login()` sent only an identifier and password. The backend
  requires a business code as soon as a second business exists, so **the day
  one was created every UI user would have been locked out.** Demonstrated
  with two businesses that both have a user called `admin`: login with no code
  returns "please use your organisation's sign-in link, or enter your business
  code", while `businessCode: default` and `businessCode: acme` each return a
  token for their own tenant. A wrong code and a wrong password still return
  the identical error, so the page cannot be used to enumerate businesses.
  - **`frontend/common/services/tenantSession.ts`** is the single module that
    knows about slugs and session storage: it parses the slug from the path,
    builds `/login/<slug>` and `/app/<slug>`, and owns the storage keys. No
    other module knows a key any more — which is what stops the next one being
    missed.
  - **Sessions are keyed by business** (`cloudhouse_token::<slug>`), fixing the
    bug the plan had recorded as deferred: every business shares one browser
    origin, so a single key meant two businesses open in two tabs silently
    clobbered each other's sign-in. Signing out of one now deliberately leaves
    the other alone. `migrateLegacySession()` carries an existing single-key
    session into the keyed layout so the deploy does not sign everyone out.
  - **`businessCode` travels with all three pre-session endpoints** — login,
    forgot-password and reset-password. The last two are not an afterthought:
    a phone number is unique only WITHIN a business now, so without it the
    backend cannot tell which employee is asking. The reset flow passes it as
    `?b=<slug>` (a step in a flow, not a bookmarkable identity).
  - **A bare `/login` shows a business-code field**, so a truncated or
    hand-typed URL is not a dead end — otherwise "the link stopped working"
    becomes the commonest support call. Arriving through a slugged link hides
    the field, because that business is already named. The field stays
    optional: with one business the backend still resolves it alone.
  - **Every redirect keeps the slug**: the 401 bounce in `httpClient`, the app
    shell's auth guard, the root traffic director, both sign-out buttons, and
    the packet/loan QR labels — those last printed a bare `/app` URL, so a
    scanned label opened an app that had forgotten which business the reader
    belongs to.
  - **How a slugged URL resolves at all.** `/login/<slug>` cannot be a Next
    dynamic route: the frontend builds with `output: "export"`, where every
    route parameter must be known at build time via `generateStaticParams`,
    and tenant slugs are created at runtime by the vendor. So one static page
    serves every slugged path and reads the slug from its own URL — a rewrite
    under `next dev`, and a fallback in `internal/webstatic` in production.
    The two must stay in step: a path that works in dev and 404s in production
    fails on the sign-in link, the worst possible place to discover it. New
    `internal/webstatic/handler_test.go` pins the production half — including
    that a real file always wins over the fallback (a slug colliding with a
    genuine asset path must not shadow it) and that a slug cannot escape the
    web root. Verified against the running server with the built frontend:
    `/login`, `/login/acme`, `/app/acme` all 200 with byte-identical HTML;
    `/login/BAD_SLUG`, `/app/acme/extra`, `/nonsense/acme` and
    `/login/..%2f..%2fmain.go` all 404.
  - The slug **selects, it never grants** — after login the business comes from
    the token and is never re-read from the URL, which the isolation harness
    already asserts (`TestSessionsWithoutABusinessAreRejected` checks that a
    business hint in the query string or an `X-Tenant-ID`/`X-Business-Code`
    header changes nothing).
  - Not done here: the **borrower app** (`customer-mobile/`) is a separate
    client and still needs the same treatment. Its `/customer/auth/*`
    endpoints already accept `businessCode`, so it is client work — tracked
    under Step 5.

### Fixed
- **Every one of the 16 report endpoints was returning every business's rows.**
  The third cross-tenant leak in this codebase, the largest, and silent like
  the two before it.
  - `.Scan()`, `.Pluck()`, `.Row()` and `.Rows()` do **not** go through GORM's
    Query callback chain — they go through **Row**, a separate chain.
    `RegisterTenantScope` hooked Query, Update, Delete and Create, which reads
    as exhaustive and is not. So every `.Scan()` ran with **no tenant
    predicate and no `ErrNoTenantInContext`**: the callback that raises the
    error never fired, so the query neither filtered nor complained. All 16
    reports are built with `.Scan()`; 23 call sites across 8 files were
    affected.
  - The existing SQL-shape tests could not catch it — they assert on
    `.Count()`, which is a Query. The generated SQL, before the fix:
    `Count(&n)` produced `WHERE "l"."tenant_id" = 7`, while the identical
    query ending in `Scan(&rows)` produced no predicate at all.
  - Fixed by registering the same callback on the `Row` chain. Guarded now by
    `TestTenantScopeCoversEveryExecutionPath` and
    `TestUnscopedContextFailsOnEveryExecutionPath`, which assert **per
    execution path** (Count, Find, Scan, Scan-with-joins, Pluck) rather than
    per query shape — so the coverage is checkable rather than assumed. That
    framing is the actual lesson: a filter defending four of GORM's five
    execution paths looks complete.
- **`checkLoanBranch` skipped its ownership check for the widest roles.** It
  returned `nil` immediately when `branchID == nil` — which is exactly
  Administrator and Management, the roles with no branch restriction — so the
  loan's existence was never verified for them. `GET /loans/:id/auction/history`
  and `GET /loans/:id/bank-pledge/history` answered 200 with an empty list for
  any loan id at all, including another business's. 9 call sites relied on it.
  No rows escaped, because the follow-up queries are tenant-filtered and the
  defence in depth held — but "no branch restriction" is not the same
  statement as "no check". The loan is now resolved unconditionally; only the
  branch comparison is conditional.
- **`GET /customers/:id/loans` answered 200 for another business's customer.**
  `ListLoansForCustomer` was the only one of the five Customer 360 sub-table
  methods missing the `customerRepo.FindByID` guard the other four all have,
  so it returned an empty list where its siblings returned 404.

### Added
- **Multi-tenancy, Step 14: the automated isolation harness.** The three fixes
  above are its first run's output.
  - `main.go`'s wiring moved into **`internal/app`** (`app.Build`), so the
    harness exercises the **real** router — same middleware chain, same
    permission gates, same route table. A harness built on a miniature
    stand-in would have proved nothing about the server that ships: one of the
    earlier leaks was visible only in the generated SQL of a fully wired
    query. `main()` is now ~60 lines. Background jobs are deliberately not
    started by `Build` — the due/overdue sweep messages real borrowers.
  - **`internal/app/isolation_manifest_test.go`** classifies all **179**
    mounted routes by how isolation is proven: probe, collection, public,
    self, external, global — with a reason recorded for every non-probe.
    `TestEveryRouteIsClassified` fails when a route is mounted that the
    manifest does not list, and when an entry no longer matches a route. It
    needs **no database**, so it runs in plain `go test ./...`. This is the
    load-bearing piece: neither shipped leak was a mistake in reasoning, both
    were an endpoint no list mentioned, so the defence is a list that cannot
    be left incomplete.
  - **`TestCrossTenantAccessIsRefused`** runs **666 probes** — every
    id-addressed route against all 9 roles, requesting another business's
    record. Roles get every permission granted, deliberately: that removes the
    permission layer from the experiment, so what comes back is the isolation
    boundary's own doing, and a leak the default grants happen to hide today
    would surface the moment an admin widened a role. The assertion is "not
    2xx" rather than a specific status, so the harness needs no valid request
    body for ~90 mutating endpoints — bodies whose drift would quietly turn
    probes into no-ops.
  - **Positive controls**, because a 404 proves nothing alone: a typo, a
    fixture that never inserted, or a route that 404s for everyone all look
    like airtight isolation. Every GET probe also runs as the owning business
    and must succeed — **28 of 29 do**, and the one that cannot
    (`esign/status`, which needs a real eSign transaction) is reported out
    loud rather than counted as passed.
  - **`TestCollectionsDoNotLeak`** checks 63 list, report and **export**
    responses for another business's marker string — including every one of
    the 16 export keys, since a report can be correct on screen and leaking in
    the file. Fixtures carry a per-tenant marker, so a leak is B's own string
    in A's response rather than a row count to be interpreted. This is the
    test that caught the reports leak.
  - **`TestBorrowerCannotReachOtherBorrowers`** covers the Step 5 surface —
    payment history, notifications and receipts, the routes that do not go
    through `customerOwnedLoan` — plus that a staff token is refused on
    borrower routes and vice versa.
  - **`TestSessionsWithoutABusinessAreRejected`**: no token, expired token,
    token signed with the wrong secret, crossed JWT schemes, and a business
    hint smuggled in via query string or `X-Tenant-ID`/`X-Business-Code`
    headers being ignored — the last one asserting the design's central claim,
    that the business comes from the token and nowhere else.
  - **Fixtures are introspective**: NOT NULL columns come from
    `information_schema` and foreign keys resolve to real parent rows, so a
    new column or constraint needs no fixture edit. Hand-written fixtures
    would drift from the schema, and the drift would show up as a probe that
    silently stopped running — the exact failure this harness exists to
    prevent. Rows are minimal and not business-valid on purpose: a probe asks
    whether A can reach B's row, and existence is all that requires.
  - **`TestExternalRoutesAreProbedByHand`** pins the 10 routes excluded from
    probing because they call live KYC/eSign/Razorpay/WhatsApp accounts. The
    class is a debt, not a clearance, and the pinned count makes adding one a
    visible diff rather than a quiet opt-out.
  - **`TestProviderCredentialsAreDeliberatelyShared`** pins the
    shared-credentials decision (`api_key_settings` has no `tenant_id` and one
    global row per category) and fails with instructions if the table ever
    gains one. **Found and not fixed, because it is a product decision:** those
    routes are mounted for every tenant's Administrator, so any customer's
    admin can not only read the shared provider credentials but **overwrite
    them for every other business**. Ownership belongs in the vendor console
    (Step 7).
  - Reclassified `GET /employees/:id/permissions/by-employee` from probe to
    self after the harness showed the owning business could not call it
    either: the handler requires the path id to equal the authenticated
    employee's, so no cross-tenant request is expressible and a probe there
    would have been theatre.
- **`documents/multitenancy_plan.md` — the multi-tenancy plan, Steps 0–15.**
  The numbered plan this log and the handoff both refer to existed only as a
  row of one-line labels in a handoff table, so "Step 9" or "Step 14" could
  not be acted on without reconstructing what they meant. Each step is now
  written out with its intent, the constraints already known to apply, and the
  traps to avoid, plus the order of work — which is deliberately **not**
  numeric: the isolation harness (14) comes before any further feature,
  because two cross-tenant leaks have already shipped silently with every test
  green. (Step 14 has since been built, and found a third — see above.)
  - The document says plainly which steps are specified and which are still
    only a label (6, 8, 10, 11, 13, 15), rather than dressing intent up as
    design.
  - Figures were re-verified against the code rather than copied: `Quota`
    appears **0 times** in `internal/branch/` (the tier quota is still
    unenforced); `businessCode`/`tenantId` appear **0 times** in `frontend/`;
    the hardcoded business name occurs **31 times across 7 files**; and there
    are **13 non-test `AllowCrossTenant` call sites in 9 files**, not the 12
    in 8 the handoff records — that count predates
    `internal/tenant/iterate.go:36`.
- **The loan "Statement" button is real.** It previously raised a
  "Receipt/statement PDF — full build" toast and did nothing; it was removed
  in `dc83f5a` and is now restored, wired end to end.
  - `GET /api/v1/loans/:id/statement` renders a customer-facing PDF:
    loan and customer details, the pledged ornaments with weight and value
    totals, full payment history broken down into interest / penal /
    principal with running balance, and a balance summary ending in the
    total outstanding and the settlement amount payable today.
  - Every figure comes from `Service.Get`, the same enriched loan the detail
    screen renders — which accrues interest up to the moment of the
    request — so the printed statement can never disagree with the screen it
    was printed from. Verified against a live loan: principal ₹74,250,
    outstanding ₹33,258.86, five payments totalling ₹41,000, all matching
    the API exactly.
  - The header carries **the tenant's own business name**, not a hardcoded
    one. A statement handed to a customer under another business's name is
    the most visible possible version of a tenancy mistake, and this is the
    first document to get it right — the other 30 hardcoded
    "CloudHouse Finance" strings still need the Step 9 branding work.
  - Penal interest and processing-fee lines appear only when non-zero: a
    line reading "0.00" against a penalty invites a question at the counter
    that has no answer.
  - Gated by `can view loan`, branch- and tenant-scoped through `Service.Get`.
    Verified: unknown loan 404, no token 401, malformed id 400, loan with no
    payments 200.
  - Frontend `downloadLoanStatement()` mirrors `reportsService.exportReport`
    so there is one recognisable shape for authenticated binary downloads.
    The button disables while the request runs — it accrues interest
    server-side before rendering, so a double-click would otherwise produce
    two documents whose figures differ by a few seconds of interest.
- **Multi-tenancy, Step 4: uploaded files are no longer world-readable.**
  `router.Static("/uploads", ...)` served every file to anyone who asked — no
  login, no ownership check — and those files include **customer photos and
  KYC documents**. That was a privacy problem on a single installation and a
  cross-business one the moment there are two.
  - New `uploaded_files` table: the authorization record behind every file.
    Without a row saying who owns a file there is nothing to check a request
    against, so the record is what makes a decision possible at all.
  - `/uploads/:key` is now a handler. It authenticates, resolves the key
    through the database under the caller's business, and only then reads
    from disk. **The path is never used to locate the file** — the URL
    segment is matched as an exact `storage_key` and the disk path is built
    from the row — so traversal is unreachable rather than defended against.
    A file belonging to another business returns 404, not 403: a 403 would
    confirm the file is real and someone else's.
  - Authentication is a **path-scoped HttpOnly cookie** (`/uploads` only),
    set at login for both staff and borrowers. An `<img>` tag cannot send an
    Authorization header, so a header-only scheme would have meant rewriting
    every image in the app to fetch bytes through JavaScript. A query-string
    token was rejected: URLs leak into server logs, browser history and
    Referer headers.
  - **Uploads are validated by sniffing the bytes**, never the extension or
    the declared Content-Type — both are supplied by the caller. 10 MB cap,
    and files are validated before anything touches disk. **SVG is refused
    outright**: an SVG is a document that can carry `<script>`, so serving
    one from this origin means running attacker-supplied script with the
    viewer's session. There is no safe way to serve arbitrary SVG same-origin,
    so it is rejected rather than sanitised.
  - Server-generated files (the signed indemnity bond) go through
    `SaveBytesRecorded`, or they would be written, linked from the loan, and
    404 on every attempt to open them.
  - Migration backfills a record for every file already referenced by
    existing data, inheriting the referencing row's business. Files nothing
    references are deliberately **not** adopted — an orphan has no owner to
    infer, and guessing one would be inventing an authorization answer.

  **A bug this step introduced and then caught.** `uploaded_files` was added
  to the schema but not to `tenantScopedTables`, so the filter skipped it
  entirely: one business could read another's files, with every test green.
  The pinned-count test could not catch it — the count still matched.
  `TestEveryTenantScopedModelIsFiltered` now compares the filter's table set
  against `information_schema`, so any table with a `tenant_id` column that
  is missing from the set fails the build. Verified end to end: logged out
  404, own file 200, other business's file 404, traversal 404.
- **Multi-tenancy, Step 3: the surfaces the query filter cannot reach.**
  - **The borrower app was broken by Step 2 and is fixed.**
    `CustomerAuthMiddleware` set `customerId` but no business, so every
    borrower endpoint would have failed with "no tenant in context".
    `CustomerClaims` now carries `TenantID`, set at OTP verification from the
    customer's own record; `request-otp` and `verify-otp` take an optional
    `businessCode` on the same terms as staff login. A borrower with loans at
    two businesses signs in to each separately — merging them would tell each
    business the person also borrows elsewhere.
  - **Background jobs now iterate businesses instead of seeing all of them.**
    `tenant.ForEachActive` runs a job once per active business with a context
    scoped to it. The due/overdue sweep **sends messages to real borrowers**,
    so a single cross-tenant pass would have texted every business's
    customers in one undifferentiated batch. Suspended and cancelled
    businesses are skipped — outbound messaging runs on shared provider
    credentials, so continuing to send for a business that stopped paying
    spends the vendor's money and contacts borrowers in that business's name.
    A failure in one business never stops the rest.
  - **No Razorpay webhook exists yet** — payment verification is
    client-initiated under customer auth, so the webhook concern belongs to
    Step 10 (billing), not here. Recorded so it is not assumed handled.
  - **The realtime hub needs no change**: it is in-memory and keyed by
    customer id, which is globally unique, so it has no query to filter. Its
    only database-backed feeder (`ResendPending`) is now per-business.
  - Tests: `TestForEachActive` asserts one pass per active business, each
    correctly scoped, suspended ones skipped, and that one failure does not
    halt the others.

  **Found, not fixed:** 30 outbound strings across 7 files hardcode
  "CloudHouse Finance" — SMS and WhatsApp bodies, the indemnity bond, and
  PDF exports. Every business's borrowers would be messaged under the first
  business's name. Not a data leak, but a branding one, and it needs the
  per-business branding from Step 9.
- **Multi-tenancy, Step 2: tenant isolation is live.** Every read, update and
  delete on the 38 tenant-owned tables now carries a `tenant_id` predicate
  from the authenticated session, and every insert is stamped with it.
  Verified over HTTP with two businesses sharing one database: each sees only
  its own banks, branches and employees, and **both have a user called
  `admin`** — impossible before the composite constraints.
  - Request context is threaded handler → service → repository across ~530
    methods, following the `branchID *uint` precedent already in the
    codebase. Driven by the compiler, so no call site could be missed.
  - **Login now resolves the business first.** `POST /auth/login` accepts an
    optional `businessCode`; it is the one query that legitimately precedes a
    tenant, so it is explicitly cross-tenant, and everything after it is
    scoped. The code is optional while exactly one business exists — a
    single-business installation is unaffected — and required once there are
    two, since a username is only unique within a business. A wrong business
    code returns the same error as a wrong password, so the login page cannot
    be used to enumerate which businesses exist. `forgot-password` and
    `reset-password` take it too, for the same reason.
  - **Migration ordering corrected.** The tenancy backfill originally ran
    mid-sequence, so everything seeded after it — 9 roles, ~620 permission
    grants, the admin employee, the Head Office branch — was created with
    `tenant_id = 0`. That satisfies NOT NULL, so nothing complained; the
    symptom was a fresh install whose admin could not log in. The backfill is
    now the last step in `migrate.Run`, which is also the only point at which
    "every row has a tenant" is true.
  - `AllowCrossTenant` opt-outs total **16, in 6 files** — migrations, the
    two seed paths, and the two background jobs. `grep -rn AllowCrossTenant`
    is the audit.
  - `Claims.TenantID` is now in the session token, set at login from the
    employee record. It is the only source of a request's tenant: never a
    header, query string, body or URL segment. Tokens minted before this
    change carry no tenant and are rejected with a 401 asking the user to
    sign in again — defaulting them to a business would be precisely the
    guess this field exists to prevent. **Everyone currently logged in gets
    one 401 and a fresh login.**
  - `platform.RegisterTenantScope` installs GORM callbacks that append
    `tenant_id = ?` to every read, update and delete on the 38 tenant-owned
    tables, and stamp it on insert (so a tenant cannot be forged through a
    request body). A query with no tenant in context is a hard error, not an
    unfiltered query.
  - `AllowCrossTenant(ctx)` is the deliberate, greppable opt-out for
    migrations, the vendor console, and jobs that iterate businesses
    explicitly.
  - **A silent-leak bug found and fixed during this work.** For
    `db.Table("loans l")` — the shape all 16 report queries use — GORM parses
    the alias out and sets `Statement.Table` to `"l"`, keeping the raw string
    in `Statement.TableExpr`. A filter reading `Statement.Table` alone looks
    up a table called `l`, finds it is not tenant-owned, and returns **every
    business's rows with no filter and no error**. Caught by inspecting
    generated SQL, not by row counts. `resolveTable` now consults both, and
    `TestTenantScopeSQLShapes` asserts the predicate on all four query shapes
    so it cannot regress. A subquery as the primary table is refused loudly
    rather than skipped.
  - Tests: pure-logic coverage runs always; SQL-shape regressions need a
    scratch database and skip cleanly without one
    (`MT_TEST_DB=<db> go test ./internal/platform/`).

  **Correction to the plan.** It claimed the callback meant existing
  repository methods needed no edits. That was wrong: the filter reads the
  tenant from the query's context, and repositories were built with a
  long-lived `*gorm.DB` at boot that carries no request. Roughly 530 methods
  had to take a context. The callback removes the need to *write a `WHERE`
  clause per query* — it does not remove the need to pass a context.

  The background jobs were left cross-tenant by this step and are corrected
  in Step 3 above.
- **Multi-tenancy, Step 1: the tenant foundation.** Schema only — no
  behaviour changes yet, and the app still runs as a single business. See
  `documents/multitenancy_step0.md` for the audit this implements.
  - New `internal/tenant` package: `tiers` (Starter 1 / Growth 3 /
    Enterprise 10 branches) and `tenants` (name, immutable URL `code`, tier,
    status). Deliberately **no HTTP routes** — tenants are vendor-administered
    and vendor authentication does not exist yet; mounting them now would
    leave the most powerful operations in the system reachable by any
    authenticated employee.
  - `platform.TenantScoped` embedded in **all 37** persisted models. Not just
    the branch-owning ones: the query filter that lands in Step 2 can only add
    a condition to a table it can see, so a direct `payments/:id` lookup has no
    loan in it to reach through. Inheritance via foreign keys would silently
    reintroduce the error the filter exists to remove. The two exceptions are
    `permissions` (global catalogue) and `api_key_settings` (shared
    credentials, by product decision).
  - **16 unique constraints moved from global to per-business** — loan number,
    customer/employee/packet/scheme/branch/locker codes, bank and ornament-type
    and role names, approval limits, and the four login identifiers. Each of
    these previously meant "only one of your paying customers may ever use this
    value"; the second business's first loan is `LN-00001` and was rejected
    outright. Partial predicates on the employee identifiers are carried over
    verbatim so blank usernames/phones/emails stay exempt.
  - **Per-business code sequences** (`platform.NextSequence`), replacing
    "count every row that ever existed, add 1". Besides colliding, a global
    count leaked commercial information — one business's next customer code
    revealed roughly how many customers the others had. It was also already
    racy: two concurrent creates read the same count and the second died on the
    unique index as a 500. Allocation is now a single atomic upsert. The five
    call sites still count; they are rewired in Step 2, when a tenant is
    available in request context.
  - Migration follows add-nullable → backfill → constrain, the order
    `scheme.BackfillBranchID` already established here. Verified against a
    clone of the live database: 39 columns backfilled and set NOT NULL,
    sequences seeded past existing codes (loan → 21), a second run changing
    nothing, and a second business successfully created with the same branch
    code, bank name and role name as the first.
- **"Save Draft" on the New Gold Loan page is real.** It used to raise a
  "Draft saved (demo)" toast and throw the form away. There is now a
  `loan_drafts` / `loan_draft_ornaments` schema behind it and a
  `/loans/drafts` CRUD API (`POST` save, `GET` list/get, `PUT` overwrite,
  `DELETE` discard), plus a "Saved drafts" card on the page to reopen or
  discard one. Drafts are private to the employee who saved them (owner taken
  from the JWT, branch-scoped on listing) and deliberately unvalidated —
  only `branchId` is required, so a part-filled form is storable exactly as
  left, with the real rules still applied at "Submit for Approval".
  Re-pressing the button updates the same draft rather than piling up
  copies, and submitting a loan from a draft discards it server-side
  (fail-soft: a draft that won't delete never fails the submission).
  Run `go run ./cmd/migrate` for the two new tables.

- **"Apply Payment To" picker on Record Payment.** The modal posted every
  payment as `Partial` (the full fee → penal → interest → principal
  waterfall). Staff now choose where the amount lands: **Both** (the
  waterfall, still the default), **Interest only**, **Penal interest only**,
  **Principal only**, or **Full settlement**. Every mode still clears an
  outstanding processing fee first — a fee is a real charge, not something
  that can be deferred — and the backend rejects an amount that overshoots
  the buckets the chosen mode may touch.

  `Penal Interest` is a new payment type: it stops one bucket earlier than
  `Interest`, which pays penal FIRST (penal interest is interest too) and
  then regular interest. `POST /loans/:id/payments` now accepts only these
  five types — `Adjustment`, `Waiver`, `Auction Sale` and `Auction Write-Off`
  are raised by their own flows and were never meant to be postable by a
  client (an Auction Sale would have moved gold proceeds through the till
  twice). Covered by `internal/loan/payment_alloc_test.go`.

- **A payment that clears all arrears withdraws the loan from auction
  automatically.** Previously *any* part-payment on a loan in the auction
  pipeline froze the case and raised a keep/remove escalation for a manager,
  even when the customer had caught up on every rupee of interest and penal
  interest owed. There is nothing left to weigh in that case — principal not
  yet due is not grounds to sell someone's gold — so the case is now
  withdrawn on the spot, any pending escalation is resolved as
  `RemovedFromAuction`, and the loan returns to `Active` (out of Overdue, the
  same rule `refreshServicingStatus` applies to loans that never entered the
  pipeline). A payment that leaves ANY arrears standing still raises the
  escalation, so a token ₹100 cannot pull a scheduled auction without a
  manager.

### Fixed
- **Customer WhatsApp messages are sent in the background.**
  `loan.Service.notifyCustomer` called the WhatsApp gateway inline, so every
  action that notifies a customer held its HTTP request open for that
  external round-trip — "Issue Auction Notice" sat on "Sending…" until the
  gateway answered, and sanction/release/payment actions paid the same cost.
  Nothing was gained by waiting: the send result is only written to commlog
  and the server log, never returned to the caller and never able to fail the
  operation. The send and its commlog write now run on a detached goroutine
  (`context.WithoutCancel`, so tenant scope survives but the request's
  cancellation doesn't abort the log write), with a `recover` so a gateway
  failure can't take the process down. The in-app notification stays
  synchronous — it's a local DB write and should exist before the response
  returns. Delivery outcomes are read from the Communication History report,
  as before.

- **Closed, released and auctioned loans can no longer be re-pledged to a
  bank.** `Service.RecordBankPledge` had no status check at all, so a loan
  whose gold had already gone back to the customer (`Closed`), been sold
  (`Auctioned` / `Auctioned - Balance Due`), or was still awaiting sanction
  (`Pending Approval`) could be pledged straight back into the Bank Pledge
  worklist. `Closure Requested` is refused too — the release is already
  committed, and pledging at that point deadlocks it, since `CompleteRelease`
  refuses while a pledge is active.

  **Only an open pledge blocks a new one.** `Bank Pledged` is refused with
  `ErrBankPledgeStillActive` — a second pledge previously overwrote
  `bankPledgeStatus` and orphaned the first with no release path. `Released`
  is eligible: the gold has come back *from* the bank, so the loan may be
  pledged again and can cycle pledge → release → pledge. (A stricter
  once-per-loan-lifetime rule shipped first, with an `ErrBankPledgeAlreadyUsed`
  error; the product owner reversed it, and that error is gone. The
  orphaning risk it guarded against is now handled directly by the
  `BankPledgeRepository.HasActive` record check.)

  The rule lives in one place, `loan.bankPledgeRefusal` over
  `loan.CanAcceptBankPledge` / `bankPledgeIneligibleStatuses`, and is applied
  at all four entry points:
  the service (`ErrLoanNotPledgeable`), `LoanFilter.ExcludeBankPledged` so the
  "New Re-Pledge" picker never offers a loan the save would reject,
  `LoanDetail.tsx`'s "Repledge to Bank" button, and `PacketDetail.tsx`'s
  packet-side button — the last checked after the loan loads, since a packet
  sitting in a locker is not on its own proof the loan is still pledgeable.

- **A loan can no longer be closed while a bank pledge is still open against
  it.** `CompleteRelease` gated only on the loan's `bankPledgeStatus` column,
  which is a stored copy of what the `bank_pledge_records` rows say. The two
  can disagree — before the guard above existed a loan could hold two `Active`
  pledge records, and releasing either one overwrote the loan-level string
  while leaving the other open — so the release guard passed on a loan that
  still had a live pledge. That is the likely route by which a `Closed` loan
  in the dev database has a ₹30,000 pledge open against it. `CompleteRelease`
  and `RecordBankPledge` now both ask the pledge records via
  `BankPledgeRepository.HasActive` in addition to reading the string. The
  status matrix itself moved into pure `loan.bankPledgeRefusal` and now has a
  table test (`internal/loan/bank_pledge_test.go`), which the original change
  shipped without. Enforcement only — no migration, and the already-drifted
  rows are deliberately left for the product owner to decide on.

- **Bank pledges are no longer counted as expenses.** Recording a pledge wrote
  the same amount twice — a cash-in `CashMovement` *and* a mirrored
  auto-approved `"Bank Pledge"` expense — so one ₹1,00,000 pledge showed as
  both "Cash In (today)" and "Expenses (today)" on the Cash-in-Hand screen.
  Expected Cash in Hand was always correct (the mirror was `mode: "Bank"`, and
  only `mode: "Cash"` expenses are subtracted), but the accounting was not: the
  bank's advance against pledged gold is borrowing, not spending. A full
  pledge→release cycle netting zero left ₹2,00,000 sitting in the expense
  register and in every expense report.

  Pledging now books cash in only; the expense belongs to the release leg,
  where the money genuinely goes back to the bank. The release expense stays
  `mode: "Bank"` — a cash-out movement already covers the same amount, so
  making it `"Cash"` would subtract it from Expected Cash in Hand twice.

  `RecordBankPledgeExpense` is removed from `loan.CashRecorder` and
  `cash.MovementService`; `BankPledgeRecord.ExpenseID` is retired (kept as a
  column, always nil on new pledges). Run `go run ./cmd/migrate` — a new
  idempotent step deletes the historical mirror rows, matching on category
  **and** the `"Auto-recorded from bank pledge workflow"` remark so a manually
  entered expense filed under the same category is never touched, and nulls
  the `bank_pledge_records.expense_id` links that pointed at them.
  `"Bank Pledge Release"` rows are left alone. Existing expense totals and the
  expense-cashflow report will drop by the previously mirrored pledge amounts.
- **Aadhaar eSign: the indemnity bond was uploaded to Setu under the wrong
  multipart field name** (`files`, where Setu's integration guide specifies
  `document`), and without an explicit `application/pdf` part content type.
  Note this alone does **not** make the sandbox accept the call — every eSign
  endpoint, including a plain signature-status `GET`, currently answers
  `400 {"message": "Bad request."}` with credentials that work for PAN
  verify — including calls with no request body to get wrong — which points at
  the eSign product instance not being provisioned rather than at our
  requests. Verify with `go run ./cmd/esigntest upload <file.pdf>`.
- **An in-flight eSign request survives a page reload.** `LoanDetail.tsx`
  tracked "sent for signing" only in component state, so reloading mid-flow
  put the header back to "Send Indemnity Bond for eSign" — no way to poll the
  outstanding request, and an invitation to start a second one against the
  same bond. The flag is now seeded from the loan's persisted
  `indemnityBondSignStatus === "sign_initiated"`.
- **`/esign-callback` exists.** The signing request has always passed that
  URL to Setu as its post-signing redirect, but no such route was ever
  built, so a customer who completed Aadhaar eSign landed on a 404. It is now
  a plain static page (deliberately unauthenticated and API-free — it opens
  on the customer's own device). Signing outcome is still confirmed by staff
  via "Check eSign Status", never inferred from the redirect.

### Changed
- **The "New Bank Re-Pledge" loan picker is a paginated, searchable
  dropdown instead of a native `<select>` over every loan.** It now uses the
  same `SearchableSelect` component as the bank/customer pickers, backed by
  real API calls: `GET /loans` accepts `limit`/`offset` (returning the
  `{items, hasMore}` envelope, matching `GET /customers`) plus
  `excludeBankPledged=true`, and the modal fetches 10 eligible loans per
  request, appending the next page as the list is scrolled. The eligibility
  rule ("gold isn't already with a bank") moved from a client-side
  `.filter()` over the page's loan array to a server-side `WHERE`, so the
  picker no longer depends on the whole loan book being in the browser.
- **Loan sanction chain cut from 4 stages to 3, so nobody signs off
  twice.** The flow is now: *made* by a Loan Operator → *verified* by the
  Loan Operator (`LoanOperator`, action `"Verified"`) → *approved* by the
  Branch Manager (`BranchManager`) → *final sanction* from Management
  (`FinalSanction`) → `Approved` / `Active`. The old
  `AuthorizedManagement` checkpoint between Branch Manager and Final
  Sanction is retired: it made Management approve twice, and above the Loan
  Operator's hard cap the Branch Manager had to act twice as well (once to
  clear the operator's stage, once at their own).
  `go run ./cmd/migrate` moves loans still parked on it to `FinalSanction`
  (`loan.MigrateRetiredSanctionStage`); `Service.Approve` also normalizes
  the old value, as do the web and mobile clients, so no loan is stranded
  at a stage no role can clear.
  Consequences: the Loan Operator stage is a *verification*, so the
  operator's approval limit is **advisory only** now — `Rejected` aside, no
  amount check blocks any stage, and `ErrExceedsApprovalLimit` /
  `ErrAwaitingOperatorVerification` (with the two-step "Verify & Escalate"
  hand-off they drove) are gone. `"Verified"` now *advances* the chain
  instead of only annotating it, is valid at the `LoanOperator` stage only,
  and `"Approved"` stays accepted there for older clients.
- **Approve/Reject on the loan detail page are `btn sm`,** matching Print
  Label / Print Slip / Record Payment beside them instead of rendering a
  size larger than every other button in that header.
- **A recorded opening cash balance is no longer asked for again that
  day.** Cash-in-Hand's "Opening Cash Balance — Today" card now shows the
  figure read-only with a "Change" button once it exists for the selected
  branch. It also stops reporting a set balance as ₹0 after a refresh: the
  first summary request fires before the branch list loads (so it's
  unscoped, and opening cash is per-branch), and if that one resolved last
  it overwrote the real figure — the card now ignores stale responses. New
  `isSet` on `GET /cash/opening-balance` and `openingCashSet` on
  `GET /cash/summary` distinguish an entered ₹0 from no entry, which
  `amount` alone could not.
- **Packet detail lists the packet's contents.** `PacketDetail.tsx` gained
  a "Contents of the Packet" table (ornament, purity, gross/net weight,
  qty, gold value, remarks) from the joined loan's already-preloaded
  ornaments — no extra round-trip. Staff opening a locker can now check the
  packet against its manifest without opening the loan. Ornament photos
  aren't in that preload and stay on the loan page.
- **The purity Karat/Fineness toggle is wider** (fixed 148px, 12px labels
  instead of shrink-to-fit 9.5px), with the ornament row's purity cell
  widened to match.
- **Record Payment simplified to a single Amount field, plus an optional
  processing fee that's added to the loan's total owed and deducted first.**
  `PaymentModal.tsx`'s Payment Type dropdown (Interest/Principal/Partial/
  Full Settlement/Adjustment/Waiver) is removed — every payment now always
  allocates processing fee → penal interest → interest → principal (the
  backend's existing `"Partial"` waterfall, `allocatePayment`), so a
  payment covering everything owed (including any outstanding fee)
  auto-closes the loan via the same generic zero-outstanding check that
  already ran regardless of type. Adjustment/Waiver are no longer
  reachable from this modal (an explicit scope decision). New optional
  `processingFee` on `POST /loans/:id/payments` adds to a new
  `Loan.OutstandingProcessingFee` running balance *before* `amount` is
  allocated — so this same payment's `amount` clears it first, folded into
  `TotalOutstandingBalance`/`SettlementAmount` so it shows up as part of
  "what's owed" — rather than being extra cash collected on top of
  `amount` (the cash-in movement is just `amount`, not
  `amount + processingFee`). `LoanPayment` gained `ProcessingFeeApplied`
  (how much of this entry's `amount` actually paid down the fee, distinct
  from `ProcessingFee`, the amount newly charged) for the Payment Ledger's
  breakdown line; outstanding fee also surfaces in Financial Summary,
  Settlement Preview, and Record Payment's notice.
- **Loan Operator's approval limit is now a real, editable, hard-enforced
  cap — not just an advisory hardcoded number.** New `internal/loan.ApprovalLimit`
  table (seeded with the previous hardcoded ₹50,000 default via
  `SeedLoanOperatorLimit`) replaces `sanctionLimits["Loan Operator"]`
  (Branch Manager/Management keep their old hardcoded, advisory-only
  entries — unchanged, an explicit scope decision). `Service.Approve`'s
  stage-role check now hard-blocks a `"Loan Operator"`-role actor's own
  `Approved` action on a loan whose `principalAmount` exceeds the limit
  (new `ErrExceedsApprovalLimit`) — `Rejected` is never blocked by this.
  Branch Manager/Management/Administrator may still act at that stage to
  clear an over-limit loan (same "step in early" pattern as
  Administrator's existing stage bypass), so an over-limit loan escalates
  rather than getting stuck. New `GET`/`PUT /api/v1/loans/approval-limits/
  loan-operator` endpoints; `Employees.tsx` gained a "Roles" button opening
  `RolesModal.tsx` to view/edit the limit.
- **Loan approval/payment/release actions now bind to the real logged-in
  user, not a client-submitted identity — plus Cashier can no longer create
  loans.** `POST /loans/:id/approve`, `POST /loans/:id/payments`, `PUT
  /loans/requests/:requestId/decide`, `POST /loans/requests/:requestId/
  approve`, and `POST /loans/:id/complete-release` used to accept
  `employeeId`/`role` as plain JSON body fields and trust them outright —
  any caller with a valid token for *any* role could submit
  `{"role":"Administrator"}` and self-approve any stage. New
  `platform.ActorFromContext(c)` reads the acting employee's real
  `employeeId`/`role` from the JWT (already set on every request by
  `AuthMiddleware`) instead; all five handlers now use it, and no longer
  bind those fields from the body at all. `Administrator`'s existing "may
  act at any pending stage" bypass is unchanged, just keyed off the real
  authenticated role. `LoanDetail.tsx`'s dev-only "Acting as: ___" role
  selector (a stand-in from before real auth existed) is removed — the
  Approve/Reject buttons now only render for the role the current stage
  actually requires (or Administrator), with an "Awaiting `<role>`
  approval" message otherwise; every `loansApi.ts` call site that used to
  pass a placeholder `employeeId: 1` no longer sends one. Separately,
  `Cashier` is explicitly outside the loan creation/approval flow: a new
  `authz.Repository.SetPermission` sets `(Cashier, loans, create)` to
  `Allowed=false` (narrower than the whole-resource `RestrictResourceToRole`
  used for Branches), and the "New Loan"/"New Gold Loan" nav item and
  buttons (`Sidebar.tsx`, `Loans.tsx`, `Dashboard.tsx`,
  `CustomerDetail.tsx`) are hidden for that role; `NewLoan.tsx` itself also
  gate-checks the role as a catch-all against direct navigation.
- **Gold purity is no longer a fixed 24K/22K/18K enum — only the 24K rate is
  published, every other purity is resolved per-ornament.** `GoldRate` now
  only carries `K24`; its old independently-entered `K22`/`K18` columns were
  renamed to `legacy_k22`/`legacy_k18` (preserved read-only, not dropped —
  see `goldrate.MigrateLegacyColumns`) rather than kept live, since nothing
  tied their values to K24's true mathematical relationship. `Ornament.Purity`/
  `OrnamentPurityTest.TestedPurity` moved from a closed `"24K"|"22K"|"18K"`
  switch to an open unit-suffixed string (`"22K"` or `"91.6%"`), range-checked
  to 10-24 karat / 0-100 fineness% (`internal/loan/purity.go`'s `ParsePurity`/
  `rateForPurity`, replacing the old fixed `rateForPurity` switch) and
  resolved against K24 as `K24 × karat/24` or `K24 × fineness%/100`, rounded
  to the nearest rupee. A new `internal/puritystandard` reference table
  (seeded every whole karat 24K→10K) powers a Karat/Fineness% toggle +
  suggest-or-create picker (`PurityPicker.tsx`) wired into `NewLoan.tsx`'s
  ornament rows and `Dashboard.tsx`'s gold calculator; it's suggestion-only
  (no FK from Ornament/GoldRate) so editing a purity standard later can never
  reinterpret a historical ornament's already-computed `GoldValue`. A one-time
  idempotent migration (`loan.NormalizeLegacyPurities`) re-parses/reformats
  every existing purity string through the same validation path, flagging
  (not coercing) anything unparseable or out of range. `Topbar`/`GoldRates`/
  `Dashboard`'s 22K/18K tiles are now labeled as client-computed reference
  values rather than separately published rates.
- **Bank re-pledge record now captures bank identity, pledged gold snapshot,
  and a bank-side due date.** `BankPledgeRecord` gained `bankId` (FK to the
  registered `bank.Bank` row picked from the frontend's search dropdown,
  alongside the existing `bankName` denormalized snapshot for display
  history), `pledgedGrossWeight`/`pledgedNetWeight` (server-computed
  snapshot of the loan's ornament totals at pledge time), and
  `bankPledgeDueDate` (optional — when the bank's own loan/pledge term is
  expected to end, distinct from `releaseDate`). A one-time idempotent
  migration (`backfillBankPledgeBankID` in `cmd/migrate`) backfills `bankId`
  for existing rows by find-or-creating a matching `bank.Bank` per distinct
  historical `bankName`. `RepledgeModal.tsx` now shows the loan's ornament
  list for staff to review before confirming a pledge, and accepts an
  optional due-date input.
- **Row-level branch scoping enforced everywhere, Branch Management
  restricted to Administrator, Schemes made branch-owned.** Previously the
  `branches` table, employee/customer/loan/locker `branchId` FKs, and
  JWT `role`/`branchId` claims all existed but nothing filtered requests by
  the caller's own branch — every logged-in employee could see and edit
  every branch's data, and any role could manage the Branches table
  itself. New `platform.GetBranchScope`/`platform.EnforceBranchOnWrite`
  helpers (`backend/internal/platform/branch_scope.go`) are now threaded
  through Employees, Customers, Loans (incl. Extension/Release requests,
  Bank Repledge, Auction), Lockers, Cash Movements/Expenses, Packets (via
  their Loan's branch), and Reminders (via their Customer's branch,
  including live-derived calendar events) — `Administrator` is the sole
  bypass role; everyone else's list/get/create/update/delete is confined to
  their own branch, with a cross-branch `GET/:id` returning `404` (not
  `403`, to avoid leaking existence) and writes silently pinned to the
  caller's own branch regardless of what's submitted. Branch Management
  (`/api/v1/branches` create/update/delete) is now Administrator-only via
  a new `authz.Repository.RestrictResourceToRole` (read stays open to all
  roles, since every branch-selector dropdown needs it). Schemes gained a
  required `branchId` FK (previously a global catalog) — existing rows
  backfilled to branch 1. A migration also backfills any pre-existing
  employee or cash-movement rows with a null/zero `branchId` to branch 1;
  the latter also fixes a real bug where the "all branches" cash-in-hand
  total disagreed with a single branch's total because untagged cash
  movements were silently excluded once a branch filter was applied.
  Frontend: `auth-context.tsx` now exposes `branchId`/`isAdmin`;
  Employee/Scheme create modals auto-lock the branch field to the caller's
  own branch for non-admins; the Branches nav item is hidden for
  non-admins.
- **Login switched from email+password to username-or-phone+password;
  forgot-password switched from an emailed link to a texted 6-digit OTP.**
  `Employee` gained a unique `Username` field (alongside a now-unique
  `Phone`) — `POST /auth/login` takes `{ "identifier", "password" }`,
  matched against either. `Email`/`platform.Mailer` are no longer used for
  auth (kept for any other future contact-info use). Forgot/reset password
  (`POST /auth/forgot-password` / `POST /auth/reset-password`) now looks
  the employee up by `phone`, generates a 6-digit OTP (10-minute expiry,
  SHA-256 hashed at rest, same as the old link-token pattern), and sends
  it via a new `platform.SMSSender` interface — currently `LogSMSSender`,
  a log-only stub (no real SMS gateway is wired up yet; swap one in later
  via the existing `internal/settings` "sms" API-key category). New
  `employee.ErrUsernameInvalid/ErrUsernameTaken/ErrPhoneTaken` validation
  errors; `EmployeeModal.tsx` gained Username/Password fields so an
  Administrator can set up an employee's login credentials from the UI.
  Frontend: `login/page.tsx` now collects "Username or Mobile Number" +
  password; `forgot-password/page.tsx` collects a phone number and
  redirects to `reset-password/page.tsx`, which collects phone + the
  6-digit code + new password (previously a `?token=` link).
- **Spec-compliance sweep: 4-stage loan approval, auction workflow rebuild,
  loan status lifecycle flags, bank pledge fields, Customer 360, dashboard
  cleanup.** Closes most of the gaps found in a spec-compliance audit
  against the client proposal (Management Dashboard explicitly deferred,
  see below).
  - **Loan approval: 2-step → 4-stage.** `Loan.ApprovalStage` now
    progresses `LoanOperator → BranchManager → AuthorizedManagement →
    FinalSanction → Approved`, replacing the old `PendingManager →
    PendingManagement` pair (those two constants are now Release-request-only).
    `POST /loans/:id/approve` requires a `role` matching the current
    stage's required role, except `"Administrator"` which may act at any
    stage. Loan amount is never a hard block — a hardcoded, advisory-only
    `sanctionLimits` table only populates a new `Loan.ApprovalWarning`
    string. New `GET /loans/:id/approvals` returns the full decision
    history. `LoanDetail.tsx` gained a role selector, warning banner, and
    a shared `StageTracker` component (`frontend/components/
    StageTracker.tsx`) instead of a plain approve/reject button pair.
  - **Loan status lifecycle: `isDueSoon`/`isOverdue`/`isDefaulted`/
    `daysOverdue`.** Computed fresh on every loan read
    (`loan/accrual.go`'s `enrichStatusFlags`) from `dueDate` vs today —
    display/filter flags only, no cron/scheduler added. `isDefaulted` =
    overdue by more than 90 days; existing penal-interest accrual is
    untouched (it already ran independently off `dueDate`). `Loans.tsx`
    gained a "Defaulted" tab; these three categories now filter
    client-side instead of via the server `status` query param, since
    nothing ever sets `Loan.Status` to those values.
  - **Auction: one-shot `RecordAuction()` → full 7-stage `AuctionRecord`
    workflow.** New `AuctionRecord`/`AuctionNotice` models
    (`internal/loan/model.go`) track `AuctionEligible → NoticeIssued →
    AuctionScheduled → Auctioned → Settled`, replacing the old single
    `POST /loans/:id/auction` that jumped straight to `"Auctioned"`. New
    endpoints: `GET/POST .../auction/{eligible,notice,schedule,sale,settle}`.
    Sale recording computes and persists `SurplusShortfall`. `Auctions.tsx`
    and `AuctionModal.tsx` rebuilt around the real per-stage actions and
    the shared `StageTracker`, replacing the old cosmetic 4-box progress
    bar.
  - **Bank pledge gained `bankInterestRate`/`referenceNumber`** — spec-called-out
    fields that were missing from `BankPledgeRecord`. Threaded through
    `RecordBankPledge`, the frontend types/API, and `RepledgeModal.tsx`'s
    form + `LoanDetail.tsx`'s pledge summary.
  - **Customer 360°.** New `GET /customers/:id/profile360`
    (`internal/loan/service.go`'s `GetCustomer360` — lives in the loan
    package, not customer, to avoid a customer↔loan import cycle) returns
    a customer's full loan/ornament/payment/bank-pledge/auction history
    plus running totals in one call. `CustomerDetail.tsx` rebuilt around
    it instead of a client-side filter over the shared loans list that
    only ever showed a bare loan table.
  - **Dashboard dead-mock-data cleanup.** `Dashboard.tsx`'s "Extension
    Requests"/"Gold Release Requests" tiles and "Needs Attention" list now
    read `listLoanRequests()` (a real, already-existing endpoint) instead
    of the always-empty legacy `db.requests` mock. "Interest Collected"
    now calls a new `GET /loans/interest-collected` endpoint instead of
    reading the always-empty `db.ledger` mock.
  - **Deferred, not part of this change:** a Management Dashboard
    (interest receivable, collections, overdue totals, auction case count,
    bank-pledged totals in one management view) — tracked for later.
- **Bank re-pledge picker can no longer create a bank inline; banks now
  carry an account number.** Per the Bank & Gold Re-Pledge spec, a bank
  must be a fully registered resource (branch, IFSC, account details,
  address) before gold can be pledged against it. `RepledgeModal.tsx`'s
  bank `SearchableSelect` previously ran with `allowCreate`, letting staff
  spawn a bare, detail-less `Bank` row (name only) straight from the
  repledge flow — that's removed; the picker now only searches existing
  banks, and new banks must go through "+ Add Bank" (`BankModalContent`).
  Added `Bank.AccountNo` (`account_no`, optional) to `backend/internal/bank`
  end-to-end (model/service/handler + `bankApi.ts`), and a required
  "Account Number" field to `BankModalContent`'s form.

- **Loan scheme duration is now a real field, not a laundered date window.**
  `Scheme` previously had no tenure field at all — `StartDate`/`EndDate`
  (meant as the scheme *program's* offer-validity window) were the only
  duration-like data on the backend, and the frontend's "Loan Duration"
  dropdown in `SchemeModal.tsx` faked a real period by starting that window
  "today" and running it for N months (`schemesApi.ts`'s `toRequestBody`/
  `monthsBetween`), then reading the fake window back and re-deriving
  months from it. Replaced with a real `durationMonths int` column on
  `Scheme` — `POST`/`PUT /api/v1/schemes` now take `durationMonths`
  directly (400 `ErrInvalidDuration` if `<= 0`), and `StartDate`/`EndDate`
  are gone entirely, along with the `isActive`-requires-being-inside-the-
  window rule they existed to support (`ToggleActive` is now a plain flip).
  `frontend/lib/schemesApi.ts` no longer does any date math — `BackendScheme`
  carries `durationMonths` straight through. No change needed to
  `NewLoan.tsx` (it already read `scheme.durationMonths` to compute a new
  loan's `dueDate`) or `SchemeModal.tsx` (its form already collected a
  plain months value).

### Fixed
- **"Loan not found" flash when clicking into a loan.** `LoanDetail.tsx`
  looked up a loan by number via `listLoans({q: id})` + a client-side
  `.find()` + a second `getLoan(numericId)` call — two round trips that
  could transiently return an empty/non-matching list if that request
  overlapped with another in-flight `/loans` call (e.g. the same page's own
  `refreshLoans()`), showing "Loan not found" until a manual refresh.
  Replaced with a new, single, atomic `GET /loans/by-number/:loanNumber`
  endpoint (`loan.Repository.FindByLoanNumber`, `Service.GetByLoanNumber` —
  mirrors `packet`'s existing `by-code` lookup) and a matching
  `getLoanByNumber()` in `loansApi.ts`, removing the race entirely.

### Added
- **Reminder Calendar, backed by a new `reminder` module.** The previously
  static, hardcoded-July-2026 `Calendar.tsx` is now real end-to-end. New
  backend package `internal/reminder`: a `Reminder` table for manually
  logged Customer Follow-Ups / Promise-to-Pay dates / Custom reminders
  (plain CRUD + `PUT /:id/complete`), plus a read-only aggregation endpoint
  `GET /reminders/calendar?from=&to=` that merges those with events
  computed live from `internal/loan` — each open loan's Due Date, an
  `Overdue` event once it's passed, and a monthly "interest payment"
  reminder on the loan's opened-date anniversary (`loan.Repository`
  gained a lean `FindOpenForCalendar` for this, avoiding the full
  `preloadAll` graph). Frontend: new `remindersApi.ts` +
  `modals/ReminderModal.tsx` ("Add Reminder", customer-picker via
  `SearchableSelect`); `Calendar.tsx` rebuilt with real month navigation, a
  click-to-inspect day panel (Done/Delete on manual reminders, "Open loan"
  links), and an "Add Reminder" action; Dashboard's "Upcoming Reminders"
  card now reads the next 14 days from the same calendar feed instead of
  mocked pending-approval/request data.
- **Loan Extension & Gold Release workflow, backed by the interest/penal-
  interest ledger.** The "Extensions & Release" page (`Requests.tsx`) is now
  real end-to-end: staff log an Extension or Release request in person on a
  customer's behalf (`POST /:id/extension-request` /
  `/:id/release-request`). Extension is a one-step decision
  (`PUT /requests/:requestId/decide`) reviewing the loan's live outstanding
  principal/interest/penal interest, blocked only if the loan is already
  Closed/Auctioned/Defaulted. Release goes through the same fixed
  Manager→Management approval chain used for loan sanctioning
  (`POST /requests/:requestId/approve`, new `RequestApproval` audit table),
  gated by a four-item verification checklist (`PUT
  /requests/:requestId/verify`: payment, packet location, bank pledge,
  customer confirmation) plus a staff-entered `charges` override — approving
  snapshots `settlementAmount = totalOutstandingBalance + charges` and moves
  the loan to `"Closure Requested"`. The actual hand-back
  (`POST /:id/complete-release`) is a separate, hard-gated step: it refuses
  to run until `totalOutstandingBalance <= 0` (every `RecordPayment` call
  reduces this automatically as repayments come in) and any bank pledge is
  already released, then moves the loan's packet through to `Released` via
  a new `loan.PacketMover.RecordGoldReleaseMovement` method and closes the
  loan. Frontend: new `ReleaseReviewModal.tsx` (checklist + approval UI),
  `LoanDetail.tsx` gained a "Complete Release" button (enabled only once its
  own gates are met), and `RequestReleaseModalContent` now shows the live
  principal/interest/penal-interest/settlement breakdown instead of just the
  outstanding amount.
- **Bank pledge/release now moves Cash-in-Hand.** A new `loan.CashRecorder`
  interface (implemented by `cash.MovementService`, mirroring the existing
  `loan.PacketMover` wiring) makes `POST /:id/bank-pledge` create a cash-in
  `CashMovement` (`source: "Bank"`) for the pledged amount, and
  `PUT /:id/bank-pledge/:pledgeId/release` delete that same movement.
  `BankPledgeRecord` gained a nullable `cashMovementId` to link the two.
  `LoanDetail.tsx`'s Bank Pledge card also gained a "Release from Bank"
  button (previously this action only existed on the Bank Re-Pledge page).
- **JWT login + role-based permissions (RBAC)** — the backend's first real
  authentication/authorization layer, replacing the "no auth exists
  anywhere" gap flagged below and in `api_documentation.md`/
  `architecture.md`:
  - `Employee` gained `email` (unique, nullable/partial-index),
    `passwordHash` (bcrypt, cost 14, never serialized), and
    `passwordResetTokenHash`/`passwordResetExpiresAt` (SHA-256 hash of the
    reset token + a 1-hour expiry, also never serialized). Set via the
    existing `PUT /api/v1/employees/:id` (and `POST`) with optional
    `email`/`password` fields — no separate `users` table.
  - New `backend/internal/auth/` package: `POST /api/v1/auth/login`
    (email+password → JWT), `POST /api/v1/auth/forgot-password` (always
    `200`, emails a reset link, never reveals account existence),
    `POST /api/v1/auth/reset-password` (token + new password), and
    `GET /api/v1/auth/me`. JWT (HS256, `github.com/golang-jwt/jwt/v5`)
    encodes `employeeId`/`role`/`branchId`; expiry from `JWT_EXPIRY`
    (currently `3d`, defaults to 7 days).
  - New `backend/internal/authz/` package: a `permissions` table
    (`role`, `resource`, `action`, `allowed`) checked per-request.
    Seeded allow-all for all 9 roles × all resources on every startup
    (idempotent — never overwrites existing rows), so today every
    logged-in role can do everything; a future admin UI will flip
    individual rows to restrict roles, with no code change/redeploy.
  - New `platform.AuthMiddleware` (validates the JWT, 401 if
    missing/invalid/expired) and `platform.RequirePermission`/
    `CRUDPermissions` (403 if the role isn't allowed for that
    resource/action) wired in front of every `/api/v1/*` route in
    `main.go` except the three public `/auth/*` routes above.
  - New `platform.Mailer` (`net/smtp`) sends the password-reset email;
    configured via `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/
    `SMTP_FROM`. New `JWT_SECRET`/`JWT_EXPIRY` env vars for token
    signing/expiry. All added to `backend/.env.example`.
  - **Role rename:** `"Auction Admin"` → `"Auction Administrator"` in
    `employee.ValidRoles`, `main.go`'s `staffRoles`, and
    `frontend/components/modals/EmployeeModal.tsx`'s `ROLES` constant, to
    match the final 9-role list.
  - Out of scope for this change: audit logging (deferred, to be revisited
    separately) and HTTPS termination (expected at the reverse proxy/
    hosting layer, not the Go process).
  - See `api_documentation.md` (new Authentication section) and
    `architecture.md` (new Authentication & Authorization section) for
    full details.

- **Gold Packet Management, Barcode/QR & Locker Management** (compliance
  doc §9–10), delivered end to end:
  - New `backend/internal/locker/` package (model/repository/service/
    handler/routes) — real per-branch Locker/Vault CRUD
    (`GET|POST|PUT|DELETE /api/v1/lockers`, `GET /api/v1/lockers/:id`),
    replacing `LockerModal.tsx`'s old `localStorage`-backed mock. Occupancy
    (`occupied`) is derived, never stored — computed via the narrow
    `locker.PacketCounter` interface (implemented by `packet.Repository`),
    injected at `main.go`'s wiring level so `internal/locker` never imports
    `internal/packet`; the reverse capacity/existence check for a lockerId
    goes through `packet.LockerCapacityProvider` (implemented by
    `locker.Repository.Capacity`), so neither package imports the other.
  - New `backend/internal/packet/` package (model/repository/service/
    handler/routes) — `Packet` + `PacketMovement` with a full stage-
    transition graph (`Packet Generated → Locker Stored → {Bank Pledged |
    Ready For Release}`, `Bank Pledged → Returned`, `Returned → {Locker
    Stored | Ready For Release}`, `Ready For Release → Released`),
    rejecting any other transition with 400 `ErrInvalidPacketTransition`.
    `Service.Create(loanID)` auto-generates a `PKT-%06d` code and the first
    movement row. Endpoints: `GET /api/v1/packets` (filters: `loanId`,
    `branchId`, `status`, `lockerId`), `GET /api/v1/packets/:id`,
    `GET /api/v1/packets/by-code/:code` (keyboard-wedge-scanner-compatible
    lookup — no camera scanning yet), `GET|POST /api/v1/packets/:id/movements`.
  - `loan.Service` gained two narrow interfaces — `PacketCreator`
    (`CreatePacketForLoan(loanID) error`, called at the end of `Create()`)
    and `PacketMover` (`RecordBankPledgeMovement`/`RecordBankReleaseMovement`,
    called from `RecordBankPledge`/`ReleaseBankPledge` after their own
    state change succeeds) — both implemented by `packet.Service` and
    wired in `main.go`. Both are fail-soft: an error logs and the
    loan-level action still succeeds, since packet tracking is an
    enrichment, not a hard lending-flow dependency.
  - Migration: `locker.Locker`, `packet.Packet`, `packet.PacketMovement`
    added to `backend/cmd/migrate/main.go`'s `AutoMigrate` call and applied
    against the dev database.
  - New `frontend/lib/lockerApi.ts` / `frontend/lib/packetApi.ts`, mirroring
    `branchApi.ts`/`loansApi.ts`'s conventions.
  - `frontend/components/modals/LockerModal.tsx` rewired from
    `db.addLocker()` to real `createLocker()`/`updateLocker()`, with
    Code/Capacity/Branch validation and edit-mode support.
  - `frontend/components/Packets.tsx` rewritten to read real data
    (`listPackets()`/`listLockers()`) instead of synthesizing rows from the
    loan list, plus a manual "Enter or scan packet code" lookup input
    (`getPacketByCode()`, submits on Enter).
  - New `frontend/components/PacketDetail.tsx` (routed via `#packet/<code>`)
    — a 6-stage visual stepper, full movement-history table, and staff
    action buttons (Check In to Locker with a locker-picker, Check Out,
    Mark Ready for Release, Mark Released) calling `recordMovement()`.
  - `frontend/components/NewLoan.tsx`: after `createLoan()` succeeds, fetches
    the backend-auto-created packet's real Code (`listPackets({loanId})`)
    and prefers it in `printPacketLabel()`'s QR/label over the previous
    provisional loan-id-based URL.
- Added a `phone` field to the `Bank` resource (`backend/internal/bank/`,
  10-digit format validated server-side, optional) and a new "+ Add Bank"
  button/modal (`frontend/components/modals/BankModal.tsx`) on the Bank
  Re-Pledge page for registering a bank's Name, IFSC Code, Branch Address,
  and Phone Number directly, instead of only via the find-or-create
  combobox in the Re-Pledge flow. `frontend/lib/bankApi.ts` gained
  `createBankFull()` for this. Note: per the backend's existing
  find-or-create semantics, these extra fields are only persisted when a
  *new* bank name is created — reusing an existing bank name returns that
  row unchanged.
- New `backend/internal/bank/` resource (model/repository/service/handler/
  routes, mirroring `ornamenttype`'s find-or-create layering) — banks are
  now a real backend-backed reference list instead of free text.
  `GET|POST /api/v1/banks` (`frontend/lib/bankApi.ts`). RepledgeModal's
  "Bank" field is now a `SearchableSelect` with `allowCreate` against this
  endpoint, matching NewLoan.tsx's ornament-type picker UX. `BankPledge.tsx`
  also gained a "+ New Re-Pledge" button (via a new
  `SelectLoanForRepledgeModalContent` in `RepledgeModal.tsx`) so a repledge
  can be started directly from the Bank Re-Pledge page, not only from a
  loan's own detail page.
- Cursor-free pagination for `GET /api/v1/customers` and
  `GET /api/v1/schemes/active`: passing `limit`/`offset` switches the
  response to `{ "items": [...], "hasMore": bool }` (omitting `limit` keeps
  the old plain-array response for existing callers). `SearchableSelect`
  (`frontend/components/SearchableSelect.tsx`) now paginates in fixed pages
  of 5 with infinite scroll — opening a dropdown with an empty query loads
  page 0 immediately (a listing, not a debounced search), typing debounces
  and restarts pagination, and scrolling near the bottom of the open list
  loads the next page. Wired into `NewLoan.tsx`'s customer
  (`searchCustomersPage`) and scheme (`searchActiveSchemesPage`) pickers;
  the ornament-type and bank pickers keep single-page fetches (small
  reference lists) via `searchOrnamentTypesPage`/`searchBanksPage` wrappers
  that satisfy the same paginated `fetchFn` contract.
- `NewLoan.tsx`: staff can now override the auto-computed eligible loan
  amount with a manual "Loan amount to disburse" figure before submitting.
- Fixed `NewLoan.tsx` defaulting `custId`/`schemeId` to the first
  verified customer / active scheme while their `SearchableSelect` labels
  stayed blank — a loan could be submitted against that hidden default
  without anyone ever picking a customer or scheme. Both now start empty.
- Enforced "today's gold rate must be set" before a loan can be created:
  - Backend: `backend/internal/loan/service.go`'s `Create()` now compares
    the latest published gold rate's `Date` against the server's current
    date (`time.Now()`, compared by calendar year/day — `Year()` +
    `YearDay()`, no explicit timezone conversion beyond whatever the
    server's local time already is) after the existing
    `goldrate.Repository.FindLatest()` call. A rate published on an
    earlier day now fails with a new `ErrGoldRateNotSetToday` ("today's
    gold rate has not been set yet — please publish it before creating a
    loan."), mapped to 400 in `handler.go`'s `statusForErr` alongside the
    existing `ErrNoGoldRate`. Previously any rate — however old — passed
    this check as long as one existed at all.
  - `frontend/lib/GoldRatesProvider.tsx`'s `useGoldRates()` now exposes a
    derived `isTodaySet` boolean (`latest.date === "YYYY-MM-DD"` for
    today, matching the `new Date().toISOString().slice(0, 10)`
    convention already used across `Auctions.tsx`/`Cash.tsx`/
    `Dashboard.tsx`/etc.) — false both when no rate has ever been
    published and when the newest one is from an earlier day.
  - Added a `warning` icon to `frontend/lib/icons.tsx`. `Topbar.tsx`'s
    rate chip now shows it next to the 22K/24K figures whenever
    `!isTodaySet`, with a tooltip and a click handler that opens the
    existing `RateModalContent` (`components/modals/RateModal.tsx`) via
    `useModal()`.
  - `frontend/components/NewLoan.tsx`: when `!isTodaySet`, an inline
    banner (styled like the app's existing `.notice` blocks) now renders
    at the top of the form with its own 24K/22K/18K inputs and a "Save
    Rate" button that calls the same `publishGoldRate()`
    (`frontend/lib/goldRateApi.ts`) `RateModal.tsx` uses, reusing its
    ">0" validation rule and error copy, then calls `refresh()` from
    `useGoldRates()` so the form unblocks immediately without navigating
    away. The "Submit for Approval" button is disabled while
    `!isTodaySet`, and `submitNewLoan()` still guards against the race
    where the rate goes stale between page load and submit, surfacing
    the backend's `ErrGoldRateNotSetToday` message via the existing
    toast error handling.
- Fully wired the Employees feature onto the real `backend/internal/employee`
  API, replacing the mock/localStorage-only implementation:
  - Backend: added a server-side role whitelist (`employee.ValidRoles` in
    `backend/internal/employee/service.go`, identical to the frontend's
    `ROLES` constant) enforced in `validateCreate`/`Update` via a new
    `ErrInvalidRole` (400). Added phone format validation — optional field,
    but if provided must match `^\d{10}$` (mirrors `BranchModal.tsx`'s
    10-digit rule; Customer's phone field is required-only with no format
    regex, so it wasn't the pattern followed here) — via a new
    `ErrPhoneInvalid` (400). Both new errors mapped to 400 in
    `handler.go`'s `statusForErr`.
  - New `frontend/lib/employeeApi.ts` mirroring `branchApi.ts`'s
    conventions: `listEmployees()`, `getEmployee()`, `createEmployee()`,
    `updateEmployee()`, `deleteEmployee()`, a `BackendEmployee` raw-JSON
    type, and an `EmployeeView` UI shape (`branchName` derived from the
    nested `branch.name`). `updateEmployee()` takes an `EmployeeUpdateInput`
    that also carries the four performance counters, since the backend's
    `PUT` overwrites them unconditionally — the frontend now round-trips
    the employee's current counters instead of resetting them to 0 on
    every edit.
  - `frontend/components/modals/EmployeeModal.tsx` now supports both add
    and edit modes (`employee?: EmployeeView` prop, following
    `BranchModal.tsx`'s dual-mode convention) and calls
    `createEmployee`/`updateEmployee` instead of the mock `db.addEmployee()`.
    Added client-side validation: name (letters only, ≥3 chars, trimmed),
    role (must be one of `ROLES`), branch (required), and phone (digits
    stripped as typed, capped at 10, format-checked against `^\d{10}$` if
    non-empty) — inline error text via the same `err` state / red
    paragraph pattern as `LockerModal.tsx`/`BranchModal.tsx`.
  - `frontend/components/Employees.tsx` now fetches employees from the real
    API (local `useEffect`+state fetch, mirroring `Branches.tsx` — no
    dedicated Provider needed) instead of `useData()`/`db.employees`, and
    gained Edit (opens `EmployeeModalContent` pre-filled) and Delete
    (hard delete via `window.confirm`, matching `Branches.tsx`'s
    deactivate-confirm UX) row actions.
  - Left the mock `Employee` type / `db.employees` / `db.addEmployee()` in
    `frontend/lib/data.ts` in place: `frontend/components/GlobalSearch.tsx`
    still reads `db.employees` for its search index and was not migrated
    as part of this change.
- Wired the Gold Rates page onto the already-complete `backend/internal/goldrate`
  API (no backend changes were needed — `GET /api/v1/gold-rates`,
  `GET /api/v1/gold-rates/latest`, `GET /api/v1/gold-rates/:id`, and
  `POST /api/v1/gold-rates` already existed and were complete):
  - New `frontend/lib/goldRateApi.ts` (`listGoldRates()`,
    `getLatestGoldRate()`, `publishGoldRate()`, `GoldRateView` UI shape +
    `toView(BackendGoldRate)` mapper, mirroring `customersApi.ts`).
  - New `frontend/lib/GoldRatesProvider.tsx` (mirrors `CustomersProvider.tsx`'s
    fetch-once-and-refresh Context pattern, exposing `useGoldRates()` ->
    `{ latest, history, loading, error, refresh }`), mounted in
    `frontend/app/app/page.tsx` alongside the other providers.
  - `GoldRates.tsx`, `Topbar.tsx`, `Dashboard.tsx`, and `NewLoan.tsx` now all
    read the real published rate/history via `useGoldRates()` instead of the
    mock `db.rates`/`db.rateHistory` (localStorage keys `agf_rates`/
    `agf_rate_history`).
  - `RateModal.tsx`'s `save()` now calls the real `POST /gold-rates`
    endpoint instead of the old `db.saveRates()` (which wrote straight to
    localStorage with zero validation). Added client-side validation
    rejecting any of K24/K22/K18 <= 0 (matching the backend's
    `ErrInvalidRate`), shown via an inline error message (same pattern as
    `LockerModal.tsx`'s `err` state); backend validation/network errors are
    also surfaced through the same inline message.
  - Removed the now-dead mock rate code from `frontend/lib/data.ts`
    (`Rates`/`RateHistoryEntry` types, `DB.rates`/`DB.rateHistory`/
    `DB.saveRates`, and the `agf_rates`/`agf_rate_history` localStorage
    read/write) — nothing else in the codebase referenced it.
- New `POST /api/v1/loans/:id/auction` endpoint (`backend/internal/loan/`):
  records `auctionDate`/`auctionAmount`, sets `status: "Auctioned"`, and
  zeroes `outstandingAmount` in one call. Added to close the gap left by
  the Loan Module having no way to record an auction outcome.
- Wired the Loan Module frontend end-to-end onto the real backend API:
  - `frontend/lib/loansApi.ts` gained `listLoans()`, `getLoan()`,
    `approveLoan()`, `recordPayment()`, `recordBankPledge()`,
    `releaseBankPledge()`, `recordAuction()`, `addOrnament()`,
    `updateOrnament()`, `recordPurityTest()`, and a `LoanView` UI shape +
    `toView(BackendLoan)` mapper (mirrors `customersApi.ts`'s
    `CustomerView`/`toView()` pattern). `createLoan()`/`addOrnamentImage()`
    are unchanged.
  - New `frontend/lib/LoansProvider.tsx` (mirrors `CustomersProvider.tsx`'s
    fetch-once-and-refresh Context pattern), mounted in
    `frontend/app/app/page.tsx` alongside `CustomersProvider`/
    `SchemesProvider`.
  - `Loans.tsx`, `LoanDetail.tsx`, `LoanRow.tsx`, `Dashboard.tsx`,
    `CustomerDetail.tsx`, `GlobalSearch.tsx`, `Auctions.tsx`, and
    `BankPledge.tsx` now all read/write real loans via `useLoans()` /
    `loansApi.ts` instead of the mock `db.loans`. `NewLoan.tsx`'s existing
    `createLoan()` flow is unchanged; it now also calls
    `useLoans().refresh()` after a successful submit so the new loan shows
    up immediately in `Loans.tsx`.
  - `PaymentModal.tsx`, `RepledgeModal.tsx`, and `AuctionModal.tsx` now post
    to the real payment/bank-pledge/auction endpoints instead of mutating
    the mock `db`.
  - Gaps with no backend equivalent, tracked explicitly rather than
    silently dropped: gold-packet/locker tracking (`Loan.packet`/`.locker`,
    the "Gold Packet Tracking" card) — lockers stay mock-only, sourced from
    `frontend/lib/data.ts`, since no backend locker module exists;
    `db.banks` (a hardcoded bank directory with per-bank exposure totals)
    — dropped from `BankPledge.tsx`, replaced with a free-text bank-name
    field matching `BankPledgeRecord.BankName`; the old mock payment
    "mode" (Bank Transfer/UPI/Cash) — replaced with the backend's payment
    "type" (Interest/Principal/Partial/Full Settlement), a different axis
    with no direct mapping; `db.auctions`/`db.approvals` (always-empty mock
    lists with no way to add rows) — replaced with derived views over real
    loans filtered by `status`/`approvalStage`. No auth/session exists
    anywhere in this codebase yet, so `employeeId` on approve/payment calls
    is hardcoded to `1` on the frontend as a placeholder.
- Server-side search (`?q=`, case-insensitive partial match via `ILIKE`) on
  `GET /api/v1/customers` (across `name`/`code`/`phone`) and on
  `GET /api/v1/schemes` + `GET /api/v1/schemes/active` (across `name`),
  wired handler → service → repository. `frontend/lib/customersApi.ts` and
  `frontend/lib/schemesApi.ts` gained `searchCustomers()` /
  `searchActiveSchemes()` respectively, without touching the existing
  `listCustomers()`/`listSchemes()` exports.
- New `internal/ornamenttype` module (mirrors `internal/scheme`'s
  handler/service/repository/model/routes layering): `OrnamentType{id,
  name}` backed by an `ornament_types` table. `GET /api/v1/ornament-types`
  lists/searches by name (`?q=`); `POST /api/v1/ornament-types` trims the
  given name, rejects empty (400), and finds-or-creates it — returns the
  existing row (200) on a case-insensitive name match, otherwise creates
  and returns a new one (201). Registered in `backend/main.go` and added
  to the `AutoMigrate` list in both `backend/main.go` and
  `backend/cmd/migrate/main.go`.
- `frontend/lib/ornamentTypesApi.ts` (new) and `frontend/lib/loansApi.ts`
  (new): thin `apiFetch`-based clients for the ornament-type and loan-create
  endpoints, matching the conventions of the existing `*Api.ts` files.
- `frontend/components/SearchableSelect.tsx` (new): a reusable
  debounced (~300ms), stale-response-guarded combobox — text input +
  dropdown backed by a server-side `fetchFn`, with an optional
  `allowCreate` mode that shows a "+ Create '<query>'" row wired to an
  `onCreate` callback.
- `NewLoan.tsx` rewired end-to-end onto real backend calls: the customer
  and scheme pickers are now `SearchableSelect`s backed by
  `searchCustomers()`/`searchActiveSchemes()` (customer results still
  filtered client-side to `panStatus === "Verified" && aadhaarStatus ===
  "Verified"`); the per-row ornament-type `<select>` is now a
  `SearchableSelect` in `allowCreate` mode backed by
  `searchOrnamentTypes()`/`createOrnamentType()`, replacing the old
  `localStorage`-backed type list and `window.prompt()` "add type" flow
  entirely. `submitNewLoan()` now calls `loansApi.createLoan()` with a real
  payload (ornament `purity` mapped to the backend's exact `"24K"/"22K"/
  "18K"` strings) instead of writing to the mock `db`, then calls
  `addOrnamentImage()` for any ornament row with a photo, zipping the
  response's `ornaments` array to the input rows by index (the backend
  creates and returns ornaments in submission order — see
  `internal/loan/service.go`'s `Create` and
  `OrnamentRepository.FindByLoanID`'s `order by id asc`). Errors from the
  API are toasted via their message instead of silently falling back to
  the mock db. Since `NewLoan.tsx` had no branch/session context, the
  branch is picked from a new "Branch" dropdown backed by
  `listActiveBranches()`, defaulting to the first active branch — the same
  "fetch active branches, default to first" pattern already used by
  `EmployeeModal.tsx`/`ExpenseModal.tsx`/`LockerModal.tsx`. **Known gap:**
  `LoanDetail.tsx`/`Loans.tsx` still read the in-memory mock `db.loans`
  (string ids like `"GL-1001"`), so navigating to a newly-created real loan
  by its `loanNumber` will show "Loan not found" until those are wired to
  the backend loan API too — left as-is per scope, noted with a `// TODO`-
  style comment in `NewLoan.tsx`.
- Gold Loan Creation & Ornaments Management (`backend/internal/loan/`) —
  `Loan`, `Ornament`, `OrnamentPurityTest`, `OrnamentImage`, `LoanApproval`,
  `LoanPayment`, `BankPledgeRecord`, all Gin + GORM + PostgreSQL, following
  the vertical-slice pattern of the existing domains. Consumes the
  already-existing `customer`/`branch`/`scheme`/`goldrate` modules rather
  than rebuilding any of them.
  - Valuation: per-ornament `netWeight = grossWeight - deductionWeight`,
    `goldValue = netWeight × the latest GoldRate field matching the
    ornament's declared purity`; loan-level
    `eligibleLoanAmount = totalGoldValue × scheme.ltvPercent / 100`.
    Operator-chosen `principalAmount` is capped at `eligibleLoanAmount`;
    `dueDate` is entered manually.
  - Fixed 3-step sanction-approval chain
    (`PendingManager → PendingManagement → Approved`, flipping
    `status` to `"Active"`; `"Rejected"` at any stage closes the loan) via
    `POST /api/v1/loans/:id/approve`, fully audited in `LoanApproval` rows
    (actor/stage/timestamp) — **no employee-authority/role check is
    enforced yet** (deferred to a future access-control middleware); any
    `employeeId` can call this endpoint today.
  - `POST /api/v1/loans` hard-requires `customer.kycStatus == "Verified"`
    (currently always true, since the Customer Module stubs every customer
    to `"Verified"` at creation — this starts enforcing automatically once
    that stub is replaced with real verification).
  - Purity-test results and ornament photos are separate child tables
    (`OrnamentPurityTest` 1:1, `OrnamentImage` 1:many) rather than fields
    on `Ornament`, preserving the distinction between pledge-time declared
    values and later staff-verified ones; photos are uploaded via the
    existing shared `internal/upload` endpoint (URL-based, not base64).
  - Payments and bank pledge are lightweight audit tables
    (`LoanPayment`, `BankPledgeRecord`), not full sub-workflows; auction is
    tracked only via `auctionDate`/`auctionAmount` fields plus existing
    status values — no bidding/settlement workflow.
  - `Loan` carries a real `branchId` FK into `branches` (same pattern as
    the existing `Customer`/`Employee`/`Expense` models).
  - Backend-only in this change — not yet wired into `NewLoan.tsx`/
    `LoanDetail.tsx` (still on the mock data layer); frontend wiring is a
    tracked follow-up.
  - See `api_documentation.md` for the new endpoints and JSON shapes.

- **Customer Module — stage 1** (`backend/internal/customer/`,
  `backend/internal/upload/`) — real, backend-persisted customer
  registration with an auto-verified KYC status stub (no live
  verification call yet; see below). Gin + GORM + PostgreSQL, following
  the vertical-slice pattern of the existing domains.
  - `Customer` carries a real, required `branchId` FK into `branches`
    (same `checkBranch` validation pattern as `Employee`), plus PAN
    (plaintext — needed verbatim for a future Setu PAN-verify call),
    Aadhaar (AES-256-GCM encrypted at rest via a new `AADHAAR_ENCRYPTION_KEY`
    — a **separate** key/cipher instance from Settings', generalized out of
    the existing `platform.Cipher` as `NewCipher`/`NewAadhaarCipher`; only
    the last-4 digits are ever exposed, the encrypted value never is),
    photo/identity-proof/address-proof/KYC-document URLs, and optional
    nominee name/relation/phone.
  - `kycStatus`/`panStatus`/`aadhaarStatus` are hardcoded `"Verified"` at
    creation — **explicitly a stage-1 stub**, no Setu/DigiLocker call is
    made yet. This unblocks New Loan's customer picker (and now the Loan
    module's `POST /api/v1/loans` KYC gate) for end-to-end testing.
  - API responses use a `CustomerResponse` DTO — a structurally separate
    type from the DB model, not just `json:"-"` tags — so the encrypted
    Aadhaar field has no path onto the wire even if a future field
    addition forgets to guard it.
  - New shared `backend/internal/upload` module (`POST /api/v1/uploads`,
    static-served from `UPLOADS_DIR`, default `./uploads`, gitignored) —
    used for Customer's own documents and to fix a pre-existing bug where
    `NewLoan.tsx` stored ornament photos as giant base64 strings in
    `localStorage` (now uploads and stores a URL instead); a stray,
    already-dead `agf_orn_photos` localStorage read in `LoanDetail.tsx`
    was also removed.
  - `branch/repository.go`'s `CountReferences` (blocks deactivating an
    in-use branch) now also checks the `customers` table — previously only
    checked employees/expenses/cash_movements, so a branch with active
    customers could have been deactivated unguarded.
  - Frontend: new `frontend/lib/customersApi.ts`, a shared
    `CustomersProvider`/`useCustomers()` context (mirrors the existing
    `DataProvider` pattern) mounted in `app/app/page.tsx`, and a full sweep
    of every remaining mock-`db.customers` consumer (`Customers.tsx`,
    `CustomerDetail.tsx`, `RegisterCustomerModal.tsx`, `NewLoan.tsx`'s
    customer picker, `GlobalSearch.tsx`, and the `custOf()` helper's 7 call
    sites) — nothing customer-related is left on mock data. Also fixed a
    related latent bug: `schemeOf()`/`db.schemes` were still stale mock
    reads post-Schemes-wiring; added an equivalent `SchemesProvider` and
    rewired the same call sites.
  - Loan/ornament/payment/auction history on `CustomerDetail.tsx` is
    unchanged (still mock) — that's the Loan module's territory, not this
    change's.
  - See `api_documentation.md` and `database_architecture.md` for the new
    endpoints/table.

- Admin-only **Settings** page (`backend/internal/settings/`) for storing
  third-party integration API keys — Notifications, SMS, WhatsApp, KYC
  Verification, Aadhaar Verification, PAN Verification (a fixed set of 6
  categories, not admin-extensible). Values are encrypted at rest with
  AES-256-GCM (new `backend/internal/platform/crypto.go` `Cipher`, key
  from the new `SETTINGS_ENCRYPTION_KEY` env var — falls back to a fixed
  dev-only key with a startup warning if unset) and are fully retrievable
  by the admin (no masking) via `GET/PUT/DELETE /api/v1/settings/api-keys[/:category]`.
  Storage only — no provider is actually called with these keys yet.
  - Frontend: new `frontend/components/Settings.tsx` +
    `frontend/lib/settingsApi.ts`, added to the "Administration" nav
    section next to Branch Management. Added `eye`/`eyeOff`/`gear` icons
    to `frontend/lib/icons.tsx`.
  - See `api_documentation.md` and `database_architecture.md` for the new
    endpoints/table (`api_key_settings`).

- Centralized **Branch Management** (`backend/internal/branch/`) — the
  first real multi-branch concept in the app. `Branch` (name, code,
  address, phone, active/inactive) is a real Gin + GORM + PostgreSQL
  table with full CRUD (`GET/POST/PUT/DELETE /api/v1/branches`); `DELETE`
  deactivates rather than hard-deletes, and is rejected if the branch
  still has linked employees/expenses/cash movements. Admin-only by
  convention — no auth/RBAC exists yet to enforce that server-side.
  - `Employee` and `Expense` had their free-text `branch` string replaced
    with a `branch_id` FK into the new `branches` table (validated on
    create/update); `CashMovement` gained an optional/nullable `branch_id`
    too. `backend/cmd/migrate/main.go` backfills existing free-text branch
    values into real `Branch` rows and populates `branch_id` on legacy
    rows, idempotently.
  - Frontend: new `frontend/components/Branches.tsx` +
    `frontend/components/modals/BranchModal.tsx` (a new "Administration"
    nav section) call the live API directly — the first frontend page to
    do so, ahead of the general "migrate mock data to real API" effort.
    `EmployeeModal.tsx` and `ExpenseModal.tsx` now source their branch
    dropdown from `frontend/lib/branchApi.ts` instead of a hardcoded list,
    though the employee/expense records themselves are still saved to the
    mock layer for now.
  - See `api_documentation.md` and `database_architecture.md` for the new
    endpoints/table.

### Changed
- Moved the API entrypoint from `backend/cmd/api/main.go` to `backend/main.go`
  (removed the now-empty `cmd/api/` directory). `backend/cmd/migrate/main.go`
  is unaffected. Run with `go run .` (or `go build .`) from `backend/` instead
  of `go run ./cmd/api`.

### Added
- Go backend domains: **Gold Rates** (`backend/internal/goldrate/`),
  **Employees** (`backend/internal/employee/`), and **Cash Movements +
  Expenses** (`backend/internal/cash/`) — Gin + GORM + PostgreSQL,
  following the same vertical-slice pattern (`model`/`repository`/
  `service`/`handler`/`routes`) as the existing `internal/scheme` module.
  Wired into `cmd/api/main.go` and `cmd/migrate/main.go`. No
  authentication/RBAC yet and not wired to the frontend yet — verified
  independently end-to-end via curl (create/list/get, plus gold-rates'
  `/latest` and cash-movements' status-toggle endpoints), per
  `architecture.md`'s sequencing note. See `api_documentation.md` and
  `database_architecture.md` for the new endpoints/tables.

### Changed
- Restructured project from a flat root layout (`public/`, `server.mjs`) into
  a `backend/` + `frontend/` directory split.
  - Removed (root, uncommitted at time of writing): `server.mjs`,
    `public/index.html`, `public/app.html`, `public/app.js`,
    `public/app.css`, `public/data.js`, `public/qrcode.min.js`,
    `public/cloudhouse-gold.jpeg`.
  - Added: `backend/` (Node.js static file server), `frontend/` (all
    former `public/` assets, moved and renamed conceptually as the SPA).
- Added `documents/` folder with project documentation (this file,
  `project_overview.md`, `architecture.md`, `database_architecture.md`,
  `api_documentation.md`, `context.md`) and a root `README.md`.

## 2026-08-07 (approx.) — a729d6a — Initial commit: gold app
- Initial commit of the CloudHouse Finance prototype.
- Static customer sign-in page (`index.html`) and admin SPA (`app.html`,
  `app.js`, `app.css`) with a hash-based client-side router.
- Mock data layer (`data.js`) backing all app screens via `window.DB`,
  persisted to `localStorage`.
- Modules covered: Dashboard, Customers, Loans, Schemes, Gold Rates,
  Packets & Lockers, Cash & Expenses, Calendar, Requests/Approvals,
  Bank Re-Pledge, Auctions, Reports, Employees.
- Basic Node.js static file server (`server.mjs`) to serve the frontend.
- No backend API, no database, no real authentication yet.

---
*Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Since there is no `package.json`/version number yet, entries are grouped by
commit/date rather than semantic version until versioning is introduced.*
