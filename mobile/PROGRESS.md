# ambikagold mobile — build progress

Tracks what's real vs. stubbed against the plan at
`C:\Users\PC7\.claude\plans\i-want-to-build-misty-flame.md`. Update this file
as more screens get wired to the backend.

## Navigation

Sidebar/drawer nav (`app/(drawer)/_layout.tsx`, `expo-router/drawer`) —
replaced the earlier bottom-tabs + Dashboard "More grid". One row per module;
Employees/Settings are hidden from non-Administrators via
`drawerItemStyle: { display: "none" }`.

## Done (real, backend-wired)

- Project scaffold: Expo SDK 57 (Android target) + Expo Router + EAS project
  `ambikagold` / `2eefa477-9d29-496f-9e91-06261ed62690`.
- Gold theme ported verbatim from `frontend/app/app/app.css` (`src/theme/`).
- Auth: login, JWT storage (`expo-secure-store`), session rehydrate via
  `/auth/me`, role/branch exposed via `useAuth()`/`useRole()`/`useIsAdministrator()`.
- API client (`src/api/client.ts`): every call goes through `apiRequest`,
  filters/search always passed as query params — no client-side filtering.
  Includes `ngrok-skip-browser-warning` header for free-tier ngrok tunnels.
- **Dashboard** — gold rate + overdue/due-today KPIs.
- **Customers** — server-side search + detail.
- **Loans** — server-side search + detail, **plus the full auction
  workflow** (eligible → notice → schedule → sale → settle) inline on the
  loan detail screen.
- **Auctions** — list screen filtering loans by `Auction Eligible`/`Defaulted`
  status, linking into the loan detail screen's auction actions above.
- **Bank Pledge / Banks** — directory list + find-or-create.
- **Cash & Expenses** — today's summary, cash movements list + add, expenses
  list + add + approve/reject (Administrator).
- **Employees** — list, detail, create, delete (Administrator-gated route).
- **Gold Rates** — list.
- **Schemes** — list, create, detail, active/inactive toggle, eligibility
  calculator.
- **Purity Standards** — list + find-or-create.
- **Ornament Types** — list + find-or-create.
- **Lockers** — list, create, detail, delete.
- **Packets** — status-filtered list, barcode/QR lookup, detail with
  movement history and a "record movement" action through the stage machine.
- **Reminders/Calendar** — this month's events.
- **Settings (API keys)** — list of fixed categories with configured/not
  status, edit-value form (Administrator-gated route).

## Deliberately left as a stub

- **Reports** — no real backend endpoint exists anywhere in the system
  (`frontend/components/Reports.tsx` is 100% mock, no `backend/internal/report`
  package). Stays on the `ComingSoon` placeholder until a real reporting
  endpoint exists (your call, not part of this plan).

## Known gaps / follow-ups

- No single dashboard-summary endpoint — Dashboard stitches `gold-rates/latest`
  + `reminders/calendar` itself.
- Loan detail's payments and approval-chain actions aren't built yet — only
  the read-only fields and the auction workflow are wired so far.
- Several list endpoints (Employees, Lockers, Cash Movements, Expenses) have
  no server-side search/filter today — verified during planning, branch
  scoping only. Add a query param + `WHERE` clause backend-side if a search
  box turns out to be needed.
- Create forms that need a `branchId` (Schemes, Lockers, Employees) default
  to the logged-in employee's own branch rather than offering a branch
  picker — fine for non-Administrators (they only have one branch anyway);
  an Administrator managing another branch would need to type a different
  branch ID or a proper picker gets added later.

## Not run yet

- Not yet launched on an Android emulator/device against a live backend for
  a full manual pass of every new screen — `tsc --noEmit` and `expo-doctor`
  both pass (20/20), but that's static verification only.
