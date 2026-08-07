# Ambika Gold Finance — Project Handoff

Paste this file's contents into a new Claude session to resume work with full context.

## Goal / architecture decisions (locked in)

- **Single port, no Nginx.** Frontend and backend are separate folders in one
  mono-repo, but at runtime everything is served through **one process on one
  port** — no reverse proxy.
- **Frontend:** Next.js + React + TypeScript, built with `output: 'export'`
  (static export — no SSR/API routes/server components used; it's a pure
  client-rendered SPA build tool). Tailwind CSS is in the long-term stack for
  *new* functionality only — existing ported CSS is kept verbatim, untouched.
- **Backend (target):** Go, RESTful API, PostgreSQL, JWT + RBAC + OTP auth.
  **Not started yet** — currently just a placeholder Node static file server.
- **Deployment (target):** Docker multi-stage build — one stage builds the
  Next.js static export, another builds the Go binary, final image copies
  both in and serves everything from Go on one port. Not started yet.
- **Mobile requirement:** the whole app must work well on phone widths and
  both portrait/landscape orientation — additive CSS only, must not change
  the existing desktop/tablet look.
- **UI preservation requirement:** the original static HTML/CSS/JS app is
  being converted to React **pixel/behavior-identical** — no visual changes,
  no rewritten styles, same localStorage-based fake data behavior for now.
  Deviations from legacy are called out explicitly when they happen (see the
  Hindi indemnity bond note below) — everything else is a faithful port.
- **Stage 2B delivery style**: phased, **2 admin pages per batch** (final
  batch was a single page), reviewed between batches. Stage 2B (all 16 admin
  pages) is now **complete** — see item 11 under "What's DONE".

## Repo layout (current)

```
gold-app/
  backend/
    server.mjs          ← plain Node http server, serves frontend/out/ (Next.js static export)
  frontend/
    legacy/              ← ORIGINAL static site (index.html, app.html, app.js, data.js,
                            qrcode.min.js, app.css, ambika-gold.jpeg) — kept untouched as reference
    app/
      page.tsx            ← Login page ("/"), full 1:1 port of legacy/index.html
      login.css           ← ported verbatim from index.html's inline <style>
      layout.tsx           ← loads Jost + Bodoni Moda via next/font/google; favicon metadata
      globals.css          ← minimal reset — MUST include `*{margin:0;padding:0;box-sizing:border-box}`
                              (see "Gotchas" below — this bit us once already)
      app/
        page.tsx           ← Admin shell ("/app") — sidebar+topbar+hash-route switch to page components
        app.css            ← ported verbatim from legacy/app.css + additive mobile rules
    components/
      Sidebar.tsx, Topbar.tsx, GlobalSearch.tsx, Modal.tsx, Toast.tsx, StatusChip.tsx, LoanRow.tsx
      Dashboard.tsx, Customers.tsx, CustomerDetail.tsx, Loans.tsx, LoanDetail.tsx, NewLoan.tsx, Schemes.tsx,
      GoldRates.tsx, Requests.tsx, Cash.tsx, Auctions.tsx, Packets.tsx, BankPledge.tsx, Reports.tsx,
      Employees.tsx, Calendar.tsx
      modals/
        RateModal.tsx, RegisterCustomerModal.tsx, PaymentModal.tsx, RepledgeModal.tsx, SchemeModal.tsx,
        AddCashModal.tsx, CashOutModal.tsx, ExpenseModal.tsx (+ ReceiptViewModalContent), AuctionModal.tsx
        (+ AuctionConfirmModalContent), LockerModal.tsx, EmployeeModal.tsx
    hooks/
      useHashRoute.ts       ← mirrors legacy's hash-based router (location.hash + hashchange)
    lib/
      data.ts               ← full DB object ported from legacy/data.js (same localStorage keys/behavior)
                               + upsertScheme mutator (added during Schemes page port, not in legacy data.js
                               as a named function — legacy inlined the push/Object.assign in app.js)
      DataProvider.tsx      ← React context wrapping lib/data.ts, hydrates from localStorage after mount
      icons.tsx             ← ported icon() SVG library as <Icon name="..."/>
      format.ts             ← fmt/fmtW/custOf/schemeOf/initials/statusChipColor/kycMarkColor/kycMarkLabel
      routes.ts             ← route → breadcrumb title lookup (TITLES map)
      print.ts              ← openPrintWindow() — ported legacy printDoc(), shared by all print/document features
      shrinkImage.ts         ← Promise-based port of legacy's image downscale/JPEG-encode helper
    next.config.ts          ← output: 'export'
    public/ambika-gold.jpeg
```

## What's DONE

1. **Repo split** into `frontend/` and `backend/` folders (uncommitted on disk,
   plain filesystem moves, no git history rewriting done yet — user wanted to
   test locally first before any commits).
2. **Next.js scaffold** in `frontend/` (TypeScript, App Router, no Tailwind yet,
   `output: 'export'` configured).
3. **Login page** (`/`) — fully ported from `legacy/index.html`: dust particle
   animation, corner ornaments, floating-label form, password show/hide,
   fake verify-then-redirect flow → `/app#dashboard`. Visually verified via
   Playwright screenshots at 1400px and 390px — matches legacy exactly.
4. **Admin shell** (`/app`) — ported from `legacy/app.html` + the chrome parts
   of `app.js`: dark sidebar with nav groups (from `NAV` config), topbar
   (breadcrumb, global search, gold-rate chip, user avatar, sign out), generic
   `Modal` and `Toast` context providers, hash-based routing hook. Verified
   working (screenshots + Playwright interaction test: sidebar off-canvas
   toggle, modal open/close, toast) with **zero console errors**.
5. **Data layer** — `legacy/data.js`'s entire `DB` object (rates, schemes,
   customers, loans, ornaments, ledger, packets, lockers, expenses, cash
   movements, requests, approvals, auctions, banks, employees, calendar
   events + all mutator functions) ported to TypeScript in `lib/data.ts`,
   wrapped in a `DataProvider` React context. Same localStorage keys, same
   behavior. Two-pass hydration (safe defaults during SSR/export prerender,
   real localStorage data after client mount) to avoid hydration mismatches.
6. **Icon library** ported (`lib/icons.tsx`, `<Icon name="..."/>`).
7. **Additive mobile/phone CSS** added on top of the legacy breakpoints in
   both `login.css` (small phones ≤380px, short landscape) and `app.css`
   (≤480px, short landscape) — verified not to alter the existing
   900px/1060px/520px breakpoints' behavior.
8. **`backend/server.mjs`** rewritten to serve `frontend/out/` (the Next.js
   static export) with proper clean-URL resolution (`/app` → `app.html`,
   `_next/static/*` assets, correct MIME types, real 404 handling). Verified
   working end-to-end: `npm run build` in `frontend/` → `node server.mjs` in
   `backend/` → single port 8090 serves both pages correctly.
9. **Favicon fixed** — `app/layout.tsx`'s metadata already pointed at
   `/ambika-gold.jpeg` (matching legacy), but a stray auto-generated
   `app/favicon.ico` was silently overriding it (Next.js App Router prefers
   a static `favicon.ico` over the metadata icon). Deleted `app/favicon.ico`
   — the jpeg logo now shows correctly in the browser tab.
10. **Global CSS reset gap fixed** — `globals.css` was missing
    `margin:0;padding:0` in its `*` reset (legacy's inline `<style>` in both
    `index.html`/`app.html` has `*{margin:0;padding:0;box-sizing:border-box}`).
    Without it, default browser UA margins on `<h1>/<h3>/<p>` were inflating
    `.page-h` and `.card .hd` heights on **every** page. Fixed in
    `app/globals.css`.
11. **Stage 2B admin pages — all 16 of 16 built. Stage 2B is COMPLETE**, in 8 batches:
    - **Batch 1**: Dashboard (`#dashboard`), Customers list + Customer 360°
      detail (`#customers`, `#customer/<id>`).
    - **Batch 2**: Loans list + Loan Detail (`#loans`, `#loan/<id>`) — added
      shared `components/LoanRow.tsx` (reused by Customer Detail's loan
      history table too), `PaymentModal`, `RepledgeModal`.
    - **Batch 3**: New Gold Loan (`#newloan`) + Loan Schemes (`#schemes`) —
      added shared `lib/print.ts` (`openPrintWindow`, first pages needing
      print), `lib/shrinkImage.ts` (ornament photo downscaling), `SchemeModal`,
      `data.ts`'s `upsertScheme` mutator. Also added the **`qrcode`** npm
      package (+ `@types/qrcode`), replacing `legacy/qrcode.min.js` for the
      Print Label button's QR generation — the only spot QR was used.
      **Deliberate deviation from legacy**: added a third Indemnity Bond
      language button, **Hindi**, alongside the existing English/Gujarati
      ones (legacy only has EN/GU) — this was an explicit ask, not a legacy
      feature; the Hindi legal text mirrors the same clause-by-clause
      structure as the English/Gujarati versions.
    - **Batch 4**: Gold Rates (`#goldrates`) + Extensions & Release / Requests
      (`#requests`). Gold Rates reuses the already-existing `RateModalContent`
      (previously only opened from Dashboard). Requests is a read-only table
      with **stub-only** Approve/Reject buttons — legacy has no real
      approve/reject logic anywhere (no data mutation, no loan status change),
      so the React port faithfully replicates the toast-only demo behavior;
      do not "fix" this into a real workflow, it's not scope creep to add.
    - **Batch 5**: Cash & Expenses (`#cash`) + Auctions (`#auctions`) — the
      bigger of the batches so far (4 new modal files). Added
      `AddCashModal.tsx`, `CashOutModal.tsx`, `ExpenseModal.tsx` (also exports
      `ReceiptViewModalContent`), `AuctionModal.tsx` (also exports
      `AuctionConfirmModalContent`). Cash & Expenses' KPI row keeps 4 of 5
      tiles as **hardcoded demo values exactly like legacy** (Opening Cash,
      Collections, Disbursements, today's Expenses) — only "Expected Cash in
      Hand" is computed from `db.cashMovements`; this is intentional, not an
      oversight, don't wire up a real cash-flow engine here. Auctions' modal
      flow **chains one modal into another** (`openModal()` called again with
      new content while already open, instead of `closeModal()`) to replicate
      legacy's schedule → confirmation-with-print-button sequence — first
      precedent of this pattern in the repo, `Modal.tsx`'s `openModal` already
      supported it without changes. `printAuctionLetter(db, loan, toast)` is
      exported as a plain function from `Auctions.tsx` (not a component) so
      the chained confirmation modal can call it too. `lib/data.ts`'s
      `Auction` type gained an optional `venue?: string` field (legacy reads/
      writes `a.venue` via `updateAuction`, but it was never in the seed data
      or the ported type before this batch).
    - **Batch 6**: Packets & Lockers (`#packets`) + Bank Re-Pledge
      (`#bankpledge`). Packets & Lockers' "Scan Packet" button and Bank
      Re-Pledge's "New Re-Pledge" button are both **stub-only**
      (toast-only), faithfully matching legacy — legacy's only real repledge
      flow lives on Loan Detail via the already-existing
      `RepledgeModal.tsx`, and legacy never had a barcode scanner
      implementation either; don't wire either button into a real flow, it's
      not scope creep to add. `lib/data.ts` gained two new mutators not
      named as functions in legacy (`addLocker`, `removeLocker`) — legacy
      did the push/splice inline in `app.js`'s `saveNewLocker`/
      `removeLocker`, but React components shouldn't mutate `db.lockers`
      directly; both replicate the exact validation/dedup/in-use logic and
      return `{ok:true}`/`{ok:false, error}` so the modal can show the same
      inline error text as legacy. Added `components/modals/LockerModal.tsx`
      (`LockerModalContent`). "Remove locker" uses `window.confirm(...)`
      directly (no confirmation-modal component exists anywhere in the repo
      yet, so this is the first and only native-confirm usage — faithful to
      legacy, not a new pattern to generalize elsewhere).
    - **Batch 7**: Reports (`#reports`) + Employees (`#employees`) — the
      simplest batch so far. Reports is **purely static**: a hardcoded array
      of 14 report-type tiles (`components/Reports.tsx`), each `onClick`
      just toasts a "generated in full build (PDF/Excel)" stub — no `db`
      reads, no modal, faithfully matching legacy's `renderReports()` (which
      also reads no data). Employees (`components/Employees.tsx`) is a
      single table over `db.employees` plus one real "Add Employee" modal
      (`components/modals/EmployeeModal.tsx`, `EmployeeModalContent`) reusing
      the already-existing `db.addEmployee` mutator — no data-layer mutator
      work needed, only a type fix: `Employee` gained an optional
      `phone?: string` field (legacy's `saveEmployee()` always passes a
      `phone` value into `D.addEmployee(...)`, but the field was missing
      from the ported `Employee` type/seed data — TS caught this at build
      time). No new CSS or icons were needed for either page.
    - **Batch 8 (final)**: Reminder Calendar (`#calendar`) —
      `components/Calendar.tsx`. The simplest page in the whole port: legacy's
      `renderCalendar()` has **no month-navigation, no day-click handlers, no
      add-reminder modal, and no `Date`-based computation at all** — it's a
      static one-shot render of a hardcoded demo month (`startDow=3` i.e. the
      1st falls on Wednesday, `nDays=31`, `today=30`, all local consts
      labeled "July 2026" in the legacy comment, not derived from the real
      clock). Ported the exact day-grid algorithm verbatim (pad a `week`
      array with `startDow` empty leading cells, push 1..nDays, flush every
      7, pad the trailing partial week with empty cells) and read
      `db.calendarEvents[d]` (keyed by day-of-month number, already fully
      ported, no mutator exists in legacy or here) to render each day's
      `.ev`-tagged reminder chips. No new mutator, CSS, or icons needed — the
      `.cal`/`.ev.due`/`.ev.over`/`.ev.fup`/`.ev.pay`/`.chip` classes and
      `cal` icon all already existed. Dashboard's pre-existing "Calendar →"
      link (`#calendar`) now resolves to a real page instead of falling
      through to itself.
    - All CSS needed for all 16 pages already existed verbatim in `app.css` —
      **zero new CSS classes were added across the entire Stage 2B port**;
      one-off visual tweaks are inline `style={}` just like legacy. One
      pre-existing legacy behavior worth knowing about (not a bug introduced
      by the port): the Auctions stage tracker (`.track`) is a
      horizontally-scrolling strip (`overflow-x:auto`, `min-width:86px` per
      stage × 7 stages), so on narrow/mobile viewports only ~4 of 7 stages
      are visible without scrolling — this matches legacy exactly.
    - `app/app/page.tsx`'s route switch now handles every legacy route:
      `dashboard`, `customers`, `customer`, `loans`, `loan`, `newloan`,
      `schemes`, `goldrates`, `requests`, `cash`, `auctions`, `packets`,
      `bankpledge`, `reports`, `employees`, `calendar` — the `default` case
      (fallback to Dashboard, matching legacy's `routes[route] ||
      renderDashboard`) is now unreachable via the sidebar/global search
      since every nav entry has a real page, but is kept for parity with
      legacy's routing logic and as a safety net for unknown hash values.

## What's NOT done yet

- **All 16 Stage 2B admin pages are built.** The remaining work is
  everything else in this section below (Go backend, Docker, git commits) —
  there is no more frontend page-porting work queued unless new deviations
  or polish items are requested.

- Loan Detail's "Statement" button (currently just a toast placeholder —
  `legacy/app.js`'s `renderLoanDetail`'s non-pending-approval branch) still
  needs real print integration via the now-existing `lib/print.ts` helper —
  a small leftover from an earlier batch, worth picking up whenever
  convenient.
- **Go backend** — nothing built. `backend/` is currently just the Node
  static-file server. Needs: Go module scaffold, RESTful API structure,
  PostgreSQL connection, JWT + RBAC + OTP auth middleware, and eventually
  wiring the frontend's `lib/data.ts`/`DataProvider` over to real API calls
  (replacing the localStorage fake data layer — that swap was explicitly
  deferred to "a later stage" per an earlier decision).
- **Docker** — no Dockerfile yet. Target: multi-stage build (frontend build
  stage → backend build stage → final image serving both from Go on one port).
- **Git commits** — none of this work has been committed. Everything is
  currently uncommitted working-tree state, by the user's explicit request
  ("we will test this first in local, do not change any of the git history").
- **`data.ts` typing** — deliberately pragmatic/loose typing in places
  (nested objects, `Record<string, ...>`) given the prototype nature; fine to
  tighten later but not a blocker.

## Gotchas hit so far (read this before debugging something similar)

- **Global CSS reset**: if a new page's header/card heights look too tall,
  check `globals.css` still has the full `*{margin:0;padding:0;box-sizing:
  border-box}` reset — see item 10 above. This was root-caused once already;
  don't re-diagnose from scratch if it recurs after some future edit
  accidentally narrows the reset again.
- **Favicon**: Next.js App Router silently prefers a static `app/favicon.ico`
  over `metadata.icons.icon` in `layout.tsx`. If the browser tab icon ever
  reverts to the default Next.js icon, check whether a `favicon.ico` has
  reappeared in `app/` (e.g. from a fresh `create-next-app` re-scaffold) and
  delete it.
- **`schemeOf`/`custOf` fallbacks** (`lib/format.ts`): both return a full
  fallback object matching their real type shape (not just `{name}`) so
  TypeScript doesn't narrow callers to a lesser union — needed once
  `LoanDetail.tsx` started reading `scheme.rate/ltv/method/penal` off the
  fallback-inclusive return type.
- **`refresh()` after every mutation**: `db.addCustomer`, `db.saveRates`,
  `db.addLoan`, `db.upsertScheme`, `db.addPayment`, `db.updateLoan`, etc. all
  write to localStorage but do **not** trigger a React re-render on their
  own — always call `refresh()` from `useData()` right after, mirroring
  legacy's `router()` re-render call after every `D.*` mutation.
- **Chaining modals**: `Modal.tsx`'s `openModal(content, wide?)` can be called
  again while a modal is already open — it just replaces the `content`/`wide`
  state, no need to `closeModal()` first. Used by `AuctionModal.tsx` to
  replicate legacy's schedule-auction → confirmation-with-print-button
  sequence. Safe to reuse this pattern for any future multi-step modal flow.
- **`Expense` type has no `desc` field** (`lib/data.ts`) — only `payee`.
  Legacy always sets `payee = desc` in `saveExpense`, so the React port
  (`ExpenseModal.tsx`) does the same instead of adding a redundant field.
- **Build vs. dev server**: `backend/server.mjs` only ever serves whatever
  was last built into `frontend/out/` — it does NOT hot-reload. Always
  `npm run build` before testing a change through the single-port flow (see
  "How to run/test" below). A stale `node server.mjs` left running from a
  previous session will keep serving the *old* build even after a fresh
  `npm run build` — kill and restart it (`taskkill //F //IM node.exe` on
  Windows, or find/kill the specific PID) if changes don't seem to appear.

## How to run/test locally right now

```bash
cd frontend
npm run dev          # hot-reload dev server at http://localhost:3000 (fastest for iterating)
# ...or, to test the actual single-port production-style flow:
npm run build        # rebuilds frontend/out/ — REQUIRED after every change before testing via server.mjs
cd ../backend
node server.mjs       # serves both / and /app on http://localhost:8090
```

## Key files worth reading first in a new session

- `frontend/legacy/app.js` — the original ~1900-line vanilla JS app. All 16
  admin pages are now ported, but this remains the reference for exact
  legacy behavior if a bug report or polish request needs to confirm
  "does legacy actually do X" for any page.
- `frontend/legacy/data.js` — source of truth already fully ported to
  `frontend/lib/data.ts` (double-check both stay in sync if you ever look
  back at the legacy file for reference on a specific page; `data.ts` has
  grown a couple of small helper mutators — like `upsertScheme` — that
  legacy inlined instead of naming).
- `frontend/app/app/page.tsx` — the route switch; all 16 legacy routes now
  have a `case` entry. Any future new page (not part of legacy) would add
  another entry here the same way.
- `frontend/lib/print.ts` and `frontend/lib/shrinkImage.ts` — reusable
  helpers for any future page needing print/document generation or ornament
  /receipt photo uploads (Auctions' letter, Loan Detail's Statement button,
  Cash & Expenses' receipt image, etc.).
- This file (`HANDOFF.md`) — no `.claude/plans/*.md` file will exist in a
  fresh session, so this document is the only carry-over of decisions made
  so far. If you want the exact prior plan text for reference, it doesn't
  survive between sessions — just re-explore + re-plan each new batch the
  same way (Explore agent → plan → implement → build → verify).
