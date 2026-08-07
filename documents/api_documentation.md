# API Documentation

> **Maintenance rule:** this file must be updated in the same change that
> adds, modifies, or removes an API endpoint. When a new endpoint is
> implemented, add it here (method, path, purpose, auth/role requirement).
> When an endpoint is removed from the backend, delete its entry here too
> — this document must never describe an endpoint that no longer exists in
> the system. Do not defer this to a later "docs pass."

## Current state
A real Go backend now exists under `backend/` (Gin + GORM + PostgreSQL,
db `ambikagold`). The Go binary (`cmd/api`, port `8080`) serves both the
REST API and the built Next.js frontend (`frontend/out`) on a single
port, superseding the old `backend/server.mjs` static file server (kept
in the repo for reference only — see [architecture.md](architecture.md)).
Four live domains are implemented so far: **Loan Schemes**, **Gold
Rates**, **Employees**, and **Cash Movements + Expenses**, all documented
below. None have authentication/RBAC yet (tracked as a follow-up per
[architecture.md](architecture.md)), and none are wired to the frontend
yet — `frontend/lib/data.ts`'s mock layer still backs every page,
including the four above; the backend is built and verified independently
first, per architecture.md's sequencing note. All other domains
(customers, loans, etc.) are still client-side only against the mock data
layer — see [database_architecture.md](database_architecture.md).

## Loan Schemes API (`/api/v1/schemes`)
Implemented in `backend/internal/scheme/`. No authentication/RBAC yet
(tracked as a follow-up per [architecture.md](architecture.md)).

Scheme JSON shape:
```json
{
  "id": 1,
  "code": "SCH-01",
  "name": "Swarna Classic",
  "interestRate": 12,
  "startDate": "2026-08-01T00:00:00Z",
  "endDate": "2026-12-31T00:00:00Z",
  "ltvPercent": 75,
  "interestMethod": "Monthly simple interest",
  "penalRate": 2,
  "conditions": "Interest payable monthly; penal 2%/m after due",
  "isActive": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```
`code` is server-generated (`SCH-01`, `SCH-02`, …) — do not send it on
create/update. `startDate`/`endDate` accept `YYYY-MM-DD` or RFC3339.
`isActive` can only be set `true` if today falls within
`[startDate, endDate]`, otherwise the request is rejected (400).

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/schemes` | Create a new scheme | scheme fields (see shape above, minus `id`/`code`) |
| GET | `/api/v1/schemes` | List all schemes | — |
| GET | `/api/v1/schemes/active` | List active schemes only (dedicated endpoint, not a query filter) | — |
| GET | `/api/v1/schemes/inactive` | List inactive schemes only (dedicated endpoint, not a query filter) | — |
| GET | `/api/v1/schemes/:id` | Get one scheme by id | — |
| PUT | `/api/v1/schemes/:id` | Update a scheme | full scheme fields |
| DELETE | `/api/v1/schemes/:id` | Soft-delete a scheme | — |
| POST | `/api/v1/schemes/:id/toggle-active` | Flip active/inactive status | — |
| POST | `/api/v1/schemes/:id/calculate` | Loan-eligibility calculator for this scheme | `{ "goldWeight": 10, "goldRate": 7000 }` → `{ "grossGoldValue": 70000, "eligibleLoanAmount": 52500, ... }` (`Gold Weight × Gold Rate = Gross Gold Value`; `Gross Gold Value × Scheme LTV = Eligible Loan Amount`) |

## Gold Rates API (`/api/v1/gold-rates`)
Implemented in `backend/internal/goldrate/`. No authentication/RBAC yet.
Every publish ("Set Today's Rate") is a new append-only row — there is no
separate "current rate" record to update; the most recent row (by
`date`/`id`) is the current rate. This collapses the frontend mock's
separate `rates` + `rateHistory` shapes into one history table.

GoldRate JSON shape:
```json
{
  "id": 1,
  "date": "2026-08-07T00:00:00Z",
  "k24": 7285,
  "k22": 6690,
  "k18": 5480,
  "setBy": "Rajesh Menon",
  "createdAt": "..."
}
```
`date` accepts `YYYY-MM-DD` on create; omit it to default to today.
`k24`/`k22`/`k18` must all be `> 0`; `setBy` is required.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/gold-rates` | Publish a new rate (creates a history row) | `{ "k24", "k22", "k18", "setBy", "date"? }` |
| GET | `/api/v1/gold-rates` | List full rate history, newest first | — |
| GET | `/api/v1/gold-rates/latest` | Get the current (most recently published) rate | — |
| GET | `/api/v1/gold-rates/:id` | Get one rate entry by id | — |

## Employees API (`/api/v1/employees`)
Implemented in `backend/internal/employee/`. No authentication/RBAC yet.
`code` is server-generated (`EMP-01`, `EMP-02`, …), same pattern as
schemes' `code`. Performance counters (`loansProcessed`/`collections`/
`followups`/`pending`) start at `0` on create — they're intended to be
owned by the loan/ledger domains once those exist — but `PUT` accepts
them directly for admin correction in the meantime.

Employee JSON shape:
```json
{
  "id": 1,
  "code": "EMP-01",
  "name": "Rajesh Menon",
  "role": "Administrator",
  "branch": "Koratty",
  "phone": "9999999999",
  "loansProcessed": 0,
  "collections": 0,
  "followups": 0,
  "pending": 0,
  "createdAt": "...",
  "updatedAt": "..."
}
```
`name`/`role`/`branch` are required; `phone` is optional.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/employees` | Create a new employee | `{ "name", "role", "branch", "phone"? }` |
| GET | `/api/v1/employees` | List all employees | — |
| GET | `/api/v1/employees/:id` | Get one employee by id | — |
| PUT | `/api/v1/employees/:id` | Update an employee (incl. performance counters) | full employee fields |
| DELETE | `/api/v1/employees/:id` | Soft-delete an employee | — |

## Cash Movements + Expenses API (`/api/v1/cash-movements`, `/api/v1/expenses`)
Implemented in `backend/internal/cash/` — two related resources on one
frontend page (Cash & Expenses), one Go package. No authentication/RBAC
yet.

CashMovement JSON shape:
```json
{
  "id": 2,
  "type": "in",
  "source": "Loan",
  "purpose": "",
  "bank": "South Indian Bank",
  "amount": 118000,
  "status": "Open",
  "occurredOn": "2026-08-07T00:00:00Z",
  "createdAt": "..."
}
```
`type` is `"in"` or `"out"`. For `type: "in"`, `source` (`"Savings"` or
`"Loan"`) is required; if `source: "Loan"`, `bank` is also required and
`status` defaults to `"Open"`. For `type: "out"`, `purpose` is required.
`amount` must be `> 0`. `occurredOn` accepts `YYYY-MM-DD`; omit to default
to today.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/cash-movements` | Record a cash-in or cash-out movement | `{ "type", "source"?, "purpose"?, "bank"?, "amount", "occurredOn"? }` |
| GET | `/api/v1/cash-movements` | List all movements, newest first | — |
| GET | `/api/v1/cash-movements/:id` | Get one movement by id | — |
| PATCH | `/api/v1/cash-movements/:id/status` | Set a loan-sourced movement's status (mirrors legacy's `setCashLoanStatus`) | `{ "status": "Open" \| "Closed" }` |

Expense JSON shape:
```json
{
  "id": 1,
  "occurredOn": "2026-08-07T00:00:00Z",
  "category": "Rent & Utilities",
  "amount": 18500,
  "mode": "Bank",
  "payee": "KSEB / Landlord",
  "branch": "Koratty",
  "status": "Pending",
  "receiptImage": "",
  "createdAt": "..."
}
```
`category`/`amount`/`mode`/`payee`/`branch` are required (`amount > 0`);
`status` is always `"Pending"` on create (no approve/reject workflow
exists yet, matching legacy). `receiptImage` is an optional base64 data
URL — there is no object-storage wiring yet, see the "File Uploads" note
in [architecture.md](architecture.md).

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/expenses` | Record an expense | `{ "category", "amount", "mode", "payee", "branch", "occurredOn"?, "receiptImage"? }` |
| GET | `/api/v1/expenses` | List all expenses, newest first | — |
| GET | `/api/v1/expenses/:id` | Get one expense by id | — |

## Server behavior — legacy static file server (`backend/server.mjs`, superseded)
Kept in the repo for reference; no longer the frontend's server. The Go
binary (`cmd/api`, `internal/webstatic`) now serves `frontend/out` with
equivalent clean-URL resolution and MIME handling, on the same port as
the API.
| Aspect | Behavior |
|---|---|
| Server | Plain Node.js `http` server, no framework |
| Static root | `frontend/` |
| Port | `process.env.PORT` (default `8090`) |
| Routing | Serves matching static file by extension → MIME type; unmatched/directory paths fall back to `index.html` |
| Auth | None |
| API routes | None (superseded for API purposes by the Go backend above) |

## Planned API (for future backend implementation)
The remaining client-side operations currently handled by `window.DB`
mutator functions (in `frontend/lib/data.ts`) should become REST endpoints
following the same pattern as the Loan Schemes API above. Suggested
mapping, based on current mock functions:

| Mock function (`data.js`) | Suggested endpoint | Status |
|---|---|---|
| `saveRates` | `PUT /api/rates` | **Done** — implemented as `POST /api/v1/gold-rates` (append-only publish, see above) instead of an in-place `PUT` |
| `addCustomer` | `POST /api/customers` | Not started |
| `saveSchemes` | `PUT /api/schemes` | **Done** — `/api/v1/schemes` |
| `addLoan` | `POST /api/loans` | Not started |
| `updateLoan` | `PATCH /api/loans/:id` | Not started |
| `saveLockers` | `PUT /api/lockers` | Not started |
| `addPayment` | `POST /api/loans/:id/payments` | Not started |
| `addCashMovement` | `POST /api/cash-movements` | **Done** — see above |
| `setCashLoanStatus` | `PATCH /api/loans/:id/cash-status` | **Done** — implemented as `PATCH /api/v1/cash-movements/:id/status` instead of a loan-scoped path, since the loan domain doesn't exist yet |
| `addExpense` | `POST /api/expenses` | **Done** — see above |
| `addEmployee` | `POST /api/employees` | **Done** — see above |
| `updateAuction` | `PATCH /api/auctions/:loanId` | Not started |

Plus read endpoints for each entity (e.g. `GET /api/customers`,
`GET /api/loans/:id`, `GET /api/packets`, `GET /api/reports/...`) and an
authentication endpoint (e.g. `POST /api/auth/login`) to back the sign-in
page in `frontend/index.html`.

This table is a starting proposal only — finalize routes, request/response
schemas, and auth model when the backend is actually built.
