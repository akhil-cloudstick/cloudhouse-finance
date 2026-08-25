# Handoff — Cloudhouse reorganization of gold-app

Written 2026-08-19, at the end of a long session applying `/cloudhouse:go-backend`
and `/cloudhouse:frontend` across the whole stack. Full plan lives at
`C:\Users\PC7\.claude\plans\read-these-skill-to-peppy-hejlsberg.md` (approved,
kept up to date with a status block per part) — this file is the shorter,
narrative version for picking the work back up.

## What was done

### Part A — Go backend (`backend/`) — response envelope migration. COMPLETE.

Every one of ~25 domain packages, plus the auth/permission middleware and the
static-file 404 fallback, now responds through `internal/platform/httpx`:
- Success: `{"success": true, "data": <resource-or-list>}`
- Delete/action confirmation: `{"success": true, "message": "<text>"}`
- Error: `{"success": false, "error": "<clean message>"}`, status classified to
  400/401/403/404/409 — **never 500** (an unclassified error is logged
  server-side via `log.Printf` and answered with a generic 400 instead).

Modules touched, in order: `branch` (pilot), `bank`, `locker`, `employee`,
`ornamenttype`, `puritystandard`, `settings`, `goldrate`, `reminder`, `packet`,
`scheme`, `cash`, `reports`, `auth`, `notification`, `upload`, `customer` (+ its
`/customer/profile/*` routes), `customerauth`, `loan` (+ its
`/customer/loans`/`/customer/payments`/`/customer/loans/:id/statement` routes),
then the cross-cutting `internal/platform/middleware.go` and
`internal/webstatic/handler.go`.

Also, before touching `loan`'s handlers: `internal/loan/model.go` (957 lines,
every entity in one file) was split into `model_loan.go`, `model_ornament.go`,
`model_approval.go`, `model_payment.go`, `model_bank_pledge.go`,
`model_request.go`, `model_draft.go`, `model_auction.go` — pure move, verified
with the package's own test suite (`go test ./internal/loan/...`) before any
logic changed.

**A.0 — also reverted a prior decision, per your explicit instruction:** the
server now calls `internal/migrate.Run(db)` on every boot again (AutoMigrate +
every backfill + permission seeding), instead of the old
`requireMigratedSchema` check-only gate. Verified against your real local dev
DB — clean run, 0 rows unexpectedly touched. The `migrations-only-via-cmd-migrate`
memory file was updated to record the reversal and why (a restart once
silently changed a `numeric(16,2)` money column — that's the risk you're now
knowingly accepting back).

**Disclosed status-code changes** (never silent): a handful of sentinel errors
moved from a blanket 400 to a more accurate code — 409 for state conflicts
(e.g. `packet.ErrInvalidPacketTransition`, `cash.ErrExpenseNotPending`,
`loan.ErrPledgeNotActive`), 403 for an authority check
(`loan.ErrShortfallAuthorityRequired`), 401 for auth failures
(`auth.ErrInvalidCredentials`). Every one is called out in
`documents/api_documentation.md`'s per-module section.

**Verification:** `go build ./...`, `go vet ./...`, and the full
`go test ./...` all pass. Not yet done: an actual manual/curl smoke test of
live endpoints under real traffic — the automated checks are solid but nobody
has clicked through the running app since this landed.

### Parts C/D — mobile apps (`customer-mobile/`, `mobile/`). COMPLETE.

Both apps were already close to the standard (single HTTP client, one service
file per entity, no dead files). Changes:
- Added `apiRequestEnveloped` to both apps' `src/api/client.ts`, with a `data`-
  falls-back-to-`message` unwrap (a real bug caught before it shipped: the
  first version only read `data`, so `forgotPassword`/`resetPassword`-style
  confirmation responses would have silently resolved to `undefined`).
- Switched every service file to the enveloped helper in lockstep with each
  backend module's migration (`goldRate.ts`, `notifications.ts`, `profile.ts`,
  `auth.ts`, `loans.ts`, `payments.ts` on customer-mobile; `branches.ts`,
  `banks.ts`, `lockers.ts`, `employees.ts`, `ornamentTypes.ts`,
  `purityStandards.ts`, `settings.ts`, `goldRates.ts`, `reminders.ts`,
  `packets.ts`, `schemes.ts`, `cash.ts`, `reports.ts`, `auth.ts`, `customers.ts`,
  `loans.ts`, `payments.ts`, `bankPledges.ts`, `auctions.ts` on staff mobile).
- Fixed the `uploadFile` binary-upload path in staff mobile's `uploads.ts` to
  read `data.data.url` instead of `data.url`.
- Renamed `sheetHost.tsx` → `SheetHost.tsx` in both apps (PascalCase
  consistency), fixed the 2-3 import sites in each.

**Verification:** `npx tsc --noEmit` clean on both apps, checked repeatedly
through the session (most recently after Part A finished — no drift since).

### Part B — web frontend (`frontend/`). COMPLETE, including the stretch goal.

All 15 entities moved into `frontend/modules/<entity>/{services,store,components}`:
gold-rates, banks, branches, lockers, packets, ornament-types,
purity-standards, reminders, settings, employees, schemes, customers, cash,
reports, loans (the biggest — service, store, and 7 page components:
`Loans`, `LoanDetail`, `LoanRow`, `NewLoan`, `Auctions`, `BankPledge`,
`Requests`).

Then, since you said to continue with the rest of the plan, the piece
originally flagged as "optional, high-blast-radius, do only if asked" also got
done: **the `lib/` → `common/` consolidation.** Every remaining shared file
moved:
- `common/services/`: `httpClient.ts` (was `lib/api.ts`), `authService.ts`
  (was `lib/authApi.ts`)
- `common/utils/`: `format.ts`, `print.ts`, `purity.ts`, `shrinkImage.ts`,
  `routes.ts`, `data.ts`
- `common/components/`: `Icon.tsx` (was `lib/icons.tsx`, renamed to match its
  export), `Modal.tsx`, `Toast.tsx`
- `common/components/ui/`: `DatePicker.tsx`, `PurityPicker.tsx`,
  `SearchableSelect.tsx`, `Select.tsx`, `StatusChip.tsx`, `StageTracker.tsx`
- `common/components/layout/`: `Sidebar.tsx`, `Topbar.tsx`, `GlobalSearch.tsx`
- `common/components/modals/`: all 19 modal files
- `common/` (root): `auth-context.tsx`, `DataProvider.tsx` — cross-cutting
  session/legacy-mirror providers that don't fit services/utils/components
  cleanly, left at the top level rather than forced into a subfolder

**End state:** `frontend/lib/` is empty. `frontend/components/` holds exactly
one file, `Dashboard.tsx` — a real page with no entity of its own (it
aggregates data from every other module), correctly left where it is rather
than forced into a fake module.

Also in Part B: added `.env.example` (`NEXT_PUBLIC_API_BASE`, `BACKEND_ORIGIN`),
fixing a real `.gitignore` bug where `.env*` would have swallowed the example
file too (`!.env.example` added). Moved `legacy/` from `frontend/legacy/` to
repo-root `legacy/` with a short README — nothing imports it as code, only
doc comments reference it ("ported from legacy/app.js's renderX()"), and those
stay accurate since nothing referenced its old path specifically. Confirmed
`frontend/out/` was already gitignored.

~250+ import references across ~70-80 files were rewritten in this session
(batched `sed` per file-group, one entity/consolidation-step at a time),
every relative import broken by a move fixed to the `@/` alias, and verified
with `tsc --noEmit` after every batch plus **two full `npm run build`**
production builds (static export) at natural checkpoints. The build is
currently green.

**One thing to know:** while I was running batched `sed` commands, the IDE
kept flagging "file changed on disk since you last read it" for files another
process (your own running `next dev`, per its log timestamps) was also
touching indirectly via hot-reload bookkeeping — I read the diffs each time
and they were exactly my own edits reflected back, nothing external
overwrote anything. Also worth knowing: `internal/scheme/handler.go` picked
up a real, independent change during this session (branch-scoping added to
`ListActive`) that I didn't make — it's a legitimate improvement, left as-is.

## Documentation kept in sync throughout

`documents/api_documentation.md`:
- A "Response envelope migration" status note near the top (now marked
  complete), plus a per-module annotation for every migrated module noting
  the new envelope shape and any status-code reclassification.
- A "Frontend restructuring" note near the top mapping the old
  `lib/<entity>Api.ts` / `components/<Entity>.tsx` paths to their new
  `modules/<entity>/...` locations — added instead of rewriting the dozens of
  scattered individual path mentions throughout the rest of that (very long)
  document, which would have been a huge, low-value effort for the same
  information already captured once, clearly, at the top.

Memory file `migrations-only-via-cmd-migrate.md` (and its `MEMORY.md` index
line) updated to record that the manual-migration decision was reversed, and
why, and what the original incident was.

## What's NOT done / worth doing next

1. **No live manual smoke test.** Every check so far is automated (build,
   vet, test, typecheck). Nobody has actually clicked through the running
   staff web app, staff mobile app, or customer mobile app since this
   session's changes landed. Given the scale of what changed — every single
   API response shape in the whole backend — this is the highest-value next
   step before calling it done: `cd backend && go run .`, then exercise a
   handful of screens per app (login, one list page, one create action, one
   delete action) and confirm the UI actually renders what the new envelope
   sends.
2. **`Dashboard.tsx`** is the one file left in `frontend/components/` — fine
   as-is (it's a cross-module aggregator page, not an entity), but worth a
   second look if a `modules/dashboard/` ever makes sense once it grows.
3. **`documents/architecture.md`** still has some old historical path
   mentions (e.g. "eight live domains... `frontend/components/Branches.tsx`")
   that were already stale *before* this session (describing an earlier
   point in time) — not something this session's changes broke, but worth a
   cleanup pass if that document gets used for onboarding.
4. Nothing else from the original plan is outstanding — Parts A/B/C/D are
   all complete, including the stretch-goal `common/` consolidation.

## How to verify this yourself, fast

```bash
# Backend
cd backend && go build ./... && go vet ./... && go test ./...

# Web frontend
cd frontend && npx tsc --noEmit && npm run build

# Staff mobile
cd mobile && npx tsc --noEmit

# Customer mobile
cd customer-mobile && npx tsc --noEmit
```

All four should be clean as of the end of this session.
