# API Documentation

> **Maintenance rule:** this file must be updated in the same change that
> adds, modifies, or removes an API endpoint. When a new endpoint is
> implemented, add it here (method, path, purpose, auth/role requirement).
> When an endpoint is removed from the backend, delete its entry here too
> — this document must never describe an endpoint that no longer exists in
> the system. Do not defer this to a later "docs pass."

## Current state
A real Go backend now exists under `backend/` (Gin + GORM + PostgreSQL,
db `ambikagold`). The Go binary (`backend/main.go`, port `8080`) serves both the
REST API and the built Next.js frontend (`frontend/out`) on a single
port, superseding the old `backend/server.mjs` static file server (kept
in the repo for reference only — see [architecture.md](architecture.md)).
Nine live domains are implemented so far: **Branches**, **Settings
(integration API keys)**, **Loan Schemes**, **Gold Rates**, **Employees**,
**Cash Movements + Expenses**, **Customers**, **Loans (+ Ornaments,
Approvals, Payments, Bank Pledge)**, and **Uploads**, all documented
below. None have authentication/RBAC yet (tracked as a follow-up per
[architecture.md](architecture.md)) — Branch Management, Settings,
Customers, and Loans are admin-only by convention only, not enforced
server-side, since no auth/role system exists yet; the Loans module's
3-step approval chain is likewise not gated by any real employee-authority
check yet (see below). `Branches`, `Settings`, `Schemes`, and `Customers`
are the exceptions to the "not wired to the frontend" note below:
`frontend/components/Branches.tsx`, `frontend/components/Settings.tsx`,
`frontend/components/Schemes.tsx`, and `frontend/components/Customers.tsx`/
`CustomerDetail.tsx`/`modals/RegisterCustomerModal.tsx` all call their real
APIs directly. The new Loans API is real end-to-end in the backend but not
yet wired to the frontend — `NewLoan.tsx`/`LoanDetail.tsx` still run
against the mock data layer in `frontend/lib/data.ts` (frontend wiring is
a follow-up, out of scope for the backend work that added this API) — see
[database_architecture.md](database_architecture.md). Employees, Expenses,
Customers, and now Loans carry a real `branchId` foreign key into the
`branches` table (see below); Employees'/Expenses' own record persistence
is still mock (their "Add" modals fetch the branch dropdown from the real
Branches API), but Customer and Loan records are fully real end-to-end in
the backend.

**Customer Module — stage 1 caveat:** `kycStatus`/`panStatus`/
`aadhaarStatus` are hardcoded to `"Verified"` at creation time — **no live
PAN/Aadhaar verification call happens yet**. This unblocks downstream
flows (New Loan's customer picker) for testing; replace with a real Setu
PAN-verify / DigiLocker Aadhaar call before treating this status as
production-accurate. Aadhaar numbers are AES-256-GCM encrypted at rest
(never stored in plaintext) and are never returned by any endpoint — only
the last 4 digits (`aadhaarLast4`) are exposed.

## Branches API (`/api/v1/branches`)
Implemented in `backend/internal/branch/`. No authentication/RBAC yet —
admin-only by convention. Every other branch-scoped domain (Employees,
Expenses, Cash Movements today; Customers/Loans/Lockers in a future
phase) links to a branch via `branchId`.

Branch JSON shape:
```json
{
  "id": 1,
  "name": "Koratty",
  "code": "KOR01",
  "address": "Main Road, Koratty, Thrissur",
  "phone": "9999999999",
  "isActive": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```
`name` and `address` are required and `name` must be unique. `code` is
optional free text (not server-generated, unlike Scheme/Employee codes).
`DELETE` does not hard-delete — it sets `isActive: false` (a
"deactivate"), and is rejected with 400 if the branch still has any
linked employees, expenses, or cash movements.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/branches` | Create a new branch | `{ "name", "code"?, "address", "phone"? }` |
| GET | `/api/v1/branches` | List all branches (active and inactive) | — |
| GET | `/api/v1/branches/:id` | Get one branch by id | — |
| PUT | `/api/v1/branches/:id` | Update a branch (incl. `isActive`) | full branch fields |
| DELETE | `/api/v1/branches/:id` | Deactivate a branch (soft-disable; 400 if still referenced) | — |

## Settings — Integration API Keys API (`/api/v1/settings/api-keys`)
Implemented in `backend/internal/settings/`. No authentication/RBAC yet —
admin-only by convention, same caveat as Branches. Backs the admin-only
**Settings** page (`frontend/components/Settings.tsx`), which stores API
keys for 6 fixed third-party integrations. These keys are **storage
only** — nothing in the backend actually calls Notification/SMS/WhatsApp/
KYC/Aadhaar/PAN providers with them yet.

The 6 categories are fixed (not admin-extensible): `notification`, `sms`,
`whatsapp`, `kyc_verification`, `aadhaar_verification`, `pan_verification`.
Values are **encrypted at rest** with AES-256-GCM (`internal/platform.Cipher`,
key from `SETTINGS_ENCRYPTION_KEY` — see `.env.example`) and are **fully
retrievable** — `GET` returns the decrypted value, there is no masking.

ApiKeyView JSON shape:
```json
{
  "category": "sms",
  "name": "Twilio prod key",
  "value": "sk_live_abc123",
  "isSet": true,
  "updatedAt": "2026-08-10T12:00:00Z"
}
```
`name` is the admin's own free-text label for the key; `value` is
required on write and is never validated against the actual provider.
`isSet: false` (with empty `name`/`value`) is returned for any of the 6
categories that haven't been configured yet — `GET /settings/api-keys`
always returns all 6, configured or not.

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET | `/api/v1/settings/api-keys` | List all 6 categories (configured or not) | — |
| GET | `/api/v1/settings/api-keys/:category` | Get one category | — |
| PUT | `/api/v1/settings/api-keys/:category` | Set/update a category's key (upsert) | `{ "name"?, "value" }` |
| DELETE | `/api/v1/settings/api-keys/:category` | Clear a category's stored key | — |

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
| GET | `/api/v1/schemes` | List all schemes | query: `q`? (case-insensitive partial match on `name`) |
| GET | `/api/v1/schemes/active` | List active schemes only (dedicated endpoint, not a query filter) | query: `q`? (case-insensitive partial match on `name`); optional `limit`/`offset` — see pagination note below |
| GET | `/api/v1/schemes/inactive` | List inactive schemes only (dedicated endpoint, not a query filter) | — |
| GET | `/api/v1/schemes/:id` | Get one scheme by id | — |
| PUT | `/api/v1/schemes/:id` | Update a scheme | full scheme fields |
| DELETE | `/api/v1/schemes/:id` | Soft-delete a scheme | — |
| POST | `/api/v1/schemes/:id/toggle-active` | Flip active/inactive status | — |
| POST | `/api/v1/schemes/:id/calculate` | Loan-eligibility calculator for this scheme | `{ "goldWeight": 10, "goldRate": 7000 }` → `{ "grossGoldValue": 70000, "eligibleLoanAmount": 52500, ... }` (`Gold Weight × Gold Rate = Gross Gold Value`; `Gross Gold Value × Scheme LTV = Eligible Loan Amount`) |

**Pagination (`/schemes/active` only):** when `limit` (> 0) is passed, the
response shape changes from a bare array to `{ "items": [...], "hasMore": bool }`
— `items` holds at most `limit` rows starting at `offset`, and `hasMore`
reports whether another page exists (determined by fetching one extra row
server-side, no separate `COUNT` query). Omitting `limit` keeps the plain
array response for existing callers (e.g. the Loan Schemes list page).
Backs `NewLoan.tsx`'s scheme `SearchableSelect`, which pages in 5 at a time
via infinite scroll (`frontend/lib/schemesApi.ts`'s `searchActiveSchemesPage`).

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
them directly for admin correction in the meantime. `branch` (free-text
string) has been replaced by `branchId`, a foreign key into the new
`branches` table (see Branches API above); the response embeds the full
`branch` object via a preload.

Employee JSON shape:
```json
{
  "id": 1,
  "code": "EMP-01",
  "name": "Rajesh Menon",
  "role": "Administrator",
  "branchId": 1,
  "branch": { "id": 1, "name": "Koratty", "code": "KOR01", "address": "...", "phone": "...", "isActive": true },
  "phone": "9999999999",
  "loansProcessed": 0,
  "collections": 0,
  "followups": 0,
  "pending": 0,
  "createdAt": "...",
  "updatedAt": "..."
}
```
`name`/`role`/`branchId` are required (`branchId` must reference an
existing branch); `phone` is optional.

**Validation (added):**
- `role` must be one of a server-side whitelist (`employee.ValidRoles` in
  `backend/internal/employee/service.go`): `Administrator`, `Management`,
  `Branch Manager`, `Loan Operator`, `Cashier`, `Accountant`,
  `Collection Staff`, `Auction Admin`, `Auditor`. This list mirrors the
  `ROLES` constant in `frontend/components/modals/EmployeeModal.tsx` —
  keep both in sync manually, there is no shared codegen. Submitting a
  role outside this list returns `400` with `ErrInvalidRole`
  ("role must be one of the predefined roles").
- `phone`, if provided, must match `^\d{10}$` (exactly 10 digits) — the
  same convention used by the Branches API's phone field. It stays
  optional; validation only runs when a value is supplied. A malformed
  phone returns `400` with `ErrPhoneInvalid` ("phone must be a 10-digit
  number").

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/employees` | Create a new employee | `{ "name", "role", "branchId", "phone"? }` |
| GET | `/api/v1/employees` | List all employees | — |
| GET | `/api/v1/employees/:id` | Get one employee by id | — |
| PUT | `/api/v1/employees/:id` | Update an employee (incl. performance counters — the frontend now round-trips the current counter values so they aren't reset to 0 on every edit) | full employee fields |
| DELETE | `/api/v1/employees/:id` | Soft-delete an employee | — |

**Frontend wiring:** `frontend/components/Employees.tsx` and
`frontend/components/modals/EmployeeModal.tsx` now call the real API via
`frontend/lib/employeeApi.ts` (`listEmployees`/`getEmployee`/
`createEmployee`/`updateEmployee`/`deleteEmployee`), following the same
pattern as `frontend/lib/branchApi.ts`/`Branches.tsx`. `EmployeeModal.tsx`
supports both add and edit modes (`employee?` prop) and validates name
(letters only, ≥3 chars), role (must be in `ROLES`), branch (required),
and phone (10 digits if provided, non-digit characters stripped as you
type) client-side before submitting. The legacy mock `db.employees`/
`db.addEmployee()` in `frontend/lib/data.ts` remains in place (unused by
Employees.tsx/EmployeeModal.tsx now) because `frontend/components/
GlobalSearch.tsx` still reads `db.employees` for its search index — it
was not migrated as part of this change.

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
  "branchId": 1,
  "branch": { "id": 1, "name": "Koratty", "code": "KOR01", "address": "...", "phone": "...", "isActive": true },
  "occurredOn": "2026-08-07T00:00:00Z",
  "createdAt": "..."
}
```
`type` is `"in"` or `"out"`. For `type: "in"`, `source` (`"Savings"` or
`"Loan"`) is required; if `source: "Loan"`, `bank` is also required and
`status` defaults to `"Open"`. For `type: "out"`, `purpose` is required.
`amount` must be `> 0`. `branchId` is optional (nullable) — not every
cash movement is tied to a till yet; when present it must reference an
existing branch. `occurredOn` accepts `YYYY-MM-DD`; omit to default
to today.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/cash-movements` | Record a cash-in or cash-out movement | `{ "type", "source"?, "purpose"?, "bank"?, "amount", "branchId"?, "occurredOn"? }` |
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
  "branchId": 1,
  "branch": { "id": 1, "name": "Koratty", "code": "KOR01", "address": "...", "phone": "...", "isActive": true },
  "status": "Pending",
  "receiptImage": "",
  "createdAt": "..."
}
```
`category`/`amount`/`mode`/`payee`/`branchId` are required (`amount > 0`,
`branchId` must reference an existing branch); `status` is always
`"Pending"` on create (no approve/reject workflow exists yet, matching
legacy). `receiptImage` is an optional base64 data URL — there is no
object-storage wiring yet, see the "File Uploads" note in
[architecture.md](architecture.md).

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/expenses` | Record an expense | `{ "category", "amount", "mode", "payee", "branchId", "occurredOn"?, "receiptImage"? }` |
| GET | `/api/v1/expenses` | List all expenses, newest first | — |
| GET | `/api/v1/expenses/:id` | Get one expense by id | — |

## Customers API (`/api/v1/customers`)
Implemented in `backend/internal/customer/`. No authentication/RBAC yet —
admin-only by convention. The consolidated Customer Module: personal/KYC
details, PAN/Aadhaar, identity/address/KYC-document uploads, and nominee
info. **Stage 1 — no live verification**: `kycStatus`/`panStatus`/
`aadhaarStatus` are hardcoded `"Verified"` at creation (see the
model-level comment in `backend/internal/customer/model.go`); replace with
a real Setu PAN-verify / DigiLocker Aadhaar call before relying on this
status in production. Loan/ornament/payment/auction history for a
customer is not embedded in this API's response — fetch it separately via
`GET /api/v1/loans?customerId=` (see Loans API below); `CustomerDetail.tsx`
on the frontend now reads this from the real `LoansProvider`/`loansApi.ts`
(filtering the shared loan list client-side by `customerId`) instead of
the mock loan data in `frontend/lib/data.ts`.

Customer JSON shape (the only shape ever returned — a `CustomerResponse`
DTO, deliberately never the raw DB row, see below):
```json
{
  "id": 2,
  "code": "CUST-02",
  "name": "Anil Varma",
  "phone": "9876543210",
  "dob": "1985-06-15T00:00:00Z",
  "address": "Koratty, Thrissur",
  "branchId": 1,
  "branch": { "id": 1, "name": "Koratty", "code": "KOR01", "address": "...", "phone": "...", "isActive": true },
  "photoUrl": "/uploads/3e5c2c0ee21b47dd-photo.png",
  "identityProofUrl": "",
  "addressProofUrl": "",
  "kycDocumentUrl": "",
  "pan": "ABCDE1234F",
  "aadhaarLast4": "7777",
  "nomineeName": "Priya Varma",
  "nomineeRelation": "Spouse",
  "nomineePhone": "9876500000",
  "kycStatus": "Verified",
  "panStatus": "Verified",
  "aadhaarStatus": "Verified",
  "createdAt": "...",
  "updatedAt": "..."
}
```
`name`, `phone`, and `branchId` are required (`branchId` must reference an
existing branch). `dob` accepts `YYYY-MM-DD`, optional. `photoUrl`/
`identityProofUrl`/`addressProofUrl`/`kycDocumentUrl` are URLs returned by
`POST /api/v1/uploads` (below) — upload the file first, then pass the
returned URL when creating/updating the customer. `pan` is stored as
plaintext (needed verbatim for a future Setu verify call). `aadhaar` is
accepted as plaintext on write only — the server AES-256-GCM encrypts it
immediately (`AADHAAR_ENCRYPTION_KEY`) and **never** returns the plaintext
or ciphertext in any response; only the last 4 digits (`aadhaarLast4`) are
exposed. `code` is server-generated (`CUST-01`, `CUST-02`, …) — do not
send it on create/update.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/customers` | Register a new customer | `{ "name", "phone", "dob"?, "address"?, "branchId", "photoUrl"?, "identityProofUrl"?, "addressProofUrl"?, "kycDocumentUrl"?, "pan"?, "aadhaar"?, "nomineeName"?, "nomineeRelation"?, "nomineePhone"? }` |
| GET | `/api/v1/customers` | List all customers | query: `q`? (case-insensitive partial match across `name`, `code`, `phone`); optional `limit`/`offset` — see pagination note below |
| GET | `/api/v1/customers/:id` | Get one customer by id | — |
| PUT | `/api/v1/customers/:id` | Update a customer | full customer fields (same shape as create) |
| DELETE | `/api/v1/customers/:id` | Soft-delete a customer | — |

**Pagination:** same convention as `/schemes/active` above — passing
`limit` (> 0) switches the response from a bare array to
`{ "items": [...], "hasMore": bool }`; omitting it keeps the plain array
for existing callers (e.g. the Customers & KYC list page). Backs
`NewLoan.tsx`'s customer `SearchableSelect`, paging in 5 at a time via
infinite scroll (`frontend/lib/customersApi.ts`'s `searchCustomersPage`).

## Banks API (`/api/v1/banks`)
Implemented in `backend/internal/bank/` — a small reference-data resource
for the external banks staff can pick from when re-pledging a loan's gold
(`RepledgeModalContent`'s "Bank" field, opened either from a loan's own
detail page or from the "+ New Re-Pledge" button on the Bank Re-Pledge
page), plus a dedicated "+ Add Bank" button on that same page
(`BankModalContent`) for registering a bank's full details up front.
Mirrors Ornament Types' find-or-create pattern below. No
authentication/RBAC yet.

```json
{
  "id": 1,
  "name": "State Bank of India",
  "branch": "MG Road",
  "ifsc": "SBIN0001234",
  "phone": "9876543210",
  "createdAt": "2026-08-10T00:00:00Z",
  "updatedAt": "2026-08-10T00:00:00Z"
}
```

`POST` trims the given `name` and rejects an empty value (400); `phone`,
if given, must be exactly 10 digits (400 `ErrPhoneInvalid` otherwise).
Lookup for an existing row is case-insensitive: if a row with the same
name (any case) already exists, that existing row is returned as-is with
`200 OK` (its `branch`/`ifsc`/`phone` are NOT overwritten by the new
request's values); otherwise a new row is created (using the request's
`branch`/`ifsc`/`phone`, all optional) and returned with `201 Created`.
This lets the frontend's "create if missing, else reuse" combobox flow
(`RepledgeModal.tsx`'s bank `SearchableSelect` with `allowCreate`) and the
full "Add Bank" form both call the same endpoint without checking
existence first.

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET | `/api/v1/banks` | List/search banks, ordered by name asc | query: `q`? (case-insensitive partial match on `name`) |
| POST | `/api/v1/banks` | Find-or-create a bank by name | `{ "name", "branch"?, "ifsc"?, "phone"? }` |

## Ornament Types API (`/api/v1/ornament-types`)
Implemented in `backend/internal/ornamenttype/` — a small reference-data
resource for the ornament type names offered when entering ornaments on a
loan (`NewLoan.tsx`'s ornament-type picker). No authentication/RBAC yet.

```json
{
  "id": 1,
  "name": "Gold Chain",
  "createdAt": "2026-08-10T00:00:00Z",
  "updatedAt": "2026-08-10T00:00:00Z"
}
```

`POST` trims the given `name` and rejects an empty value (400). Lookup for
an existing row is case-insensitive: if a row with the same name (any
case) already exists, that existing row is returned as-is with `200 OK`;
otherwise a new row is created and returned with `201 Created`. This lets
the frontend's "create if missing, else reuse" combobox flow always call
the same endpoint without checking existence first.

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET | `/api/v1/ornament-types` | List/search ornament types, ordered by name asc | query: `q`? (case-insensitive partial match on `name`) |
| POST | `/api/v1/ornament-types` | Find-or-create an ornament type by name | `{ "name" }` |

## Loans API (`/api/v1/loans`)
Implemented in `backend/internal/loan/` — the Gold Loan Creation &
Ornaments Management domain. No authentication/RBAC yet — admin-only by
convention, and the 3-step approval chain below has **no real
employee-authority check** yet either: any `employeeId` can call
`POST /:id/approve` for any stage today. `LoanApproval` rows still record
every actor/stage/timestamp so a real authority check can be added later
without a schema change. This API is real end-to-end in the backend and is
now wired to the frontend end-to-end too: `NewLoan.tsx` (loan creation,
unchanged from before), and `Loans.tsx`/`LoanDetail.tsx`/`LoanRow.tsx`/
`Dashboard.tsx`/`CustomerDetail.tsx`/`GlobalSearch.tsx`/`Auctions.tsx`/
`BankPledge.tsx` (all reads/mutations) via `frontend/lib/loansApi.ts` +
`frontend/lib/LoansProvider.tsx` (mirrors `CustomersProvider.tsx`'s
fetch-once-and-refresh pattern). No auth/session exists yet anywhere in
this codebase, so `employeeId` on approve/payment calls is currently
hardcoded to `1` on the frontend — a placeholder until a real session
exists.

**Customer must be KYC-verified.** `POST /loans` requires
`customer.kycStatus == "Verified"` (400 `ErrCustomerNotVerified`
otherwise). Since the Customer Module currently hardcodes every customer
to `"Verified"` at creation (see Customers API above), this check always
passes today — it starts enforcing automatically once real PAN/Aadhaar
verification replaces that stub, with no change needed on the loan side.

**Today's gold rate must be set.** `POST /loans` requires the latest
published gold rate (`GET /api/v1/gold-rates/latest`) to exist (400
`ErrNoGoldRate` if none has ever been published) **and** to have been
published today — its `date` (server local time, compared by
calendar day) must match the server's current date. A rate from any
earlier day fails with 400 `ErrGoldRateNotSetToday` ("today's gold rate
has not been set yet — please publish it before creating a loan."),
even though a (stale) latest rate exists. Publish a fresh
`POST /api/v1/gold-rates` for today to clear this.

**Valuation.** Per ornament: `NetWeight = GrossWeight - DeductionWeight`;
`GoldValue = NetWeight × the GoldRate field matching the ornament's
declared purity` (`k24`/`k22`/`k18`, from the latest published
`GET /api/v1/gold-rates/latest` row — 400 `ErrNoGoldRate` if none exists
yet). A loan's `totalNetWeight`/`totalGoldValue` are the sum across its
ornaments; `eligibleLoanAmount = totalGoldValue × scheme.ltvPercent / 100`.
`principalAmount` is operator-chosen and must be `<= eligibleLoanAmount`
(400 `ErrPrincipalTooHigh` otherwise); `outstandingAmount` starts equal to
`principalAmount`. `dueDate` is entered manually (no scheme-tenure field
exists) and must be after `openedDate`.

**Approval chain (fixed, 3 steps for every loan):** `status` starts
`"Pending Approval"` / `approvalStage` starts `"PendingManager"`.
`POST /:id/approve` with `{ stage: "Manager", action: "Approved" }`
advances to `approvalStage: "PendingManagement"`; a second call with
`{ stage: "Management", action: "Approved" }` sets
`approvalStage: "Approved"` and `status: "Active"`. `action: "Rejected"`
at either stage sets `approvalStage: "Rejected"` and `status: "Closed"`
(the doc's status list has no distinct "Rejected" bucket, so "Closed" is
reused). The `stage` sent must match the loan's current expected stage —
mismatches return 400 `ErrWrongStage`; calling again after a terminal
state returns 400 `ErrAlreadyDecided`.

**Payments/Bank Pledge are lightweight audit logs**, not full workflows.
`POST /:id/payments` records a `LoanPayment` row; non-`"Interest"` types
(`"Principal"`/`"Partial"`/`"Full Settlement"`) reduce `outstandingAmount`
and auto-close the loan (`status: "Closed"`) once it reaches `0`.
`POST /:id/bank-pledge` records a `BankPledgeRecord` and sets
`bankPledgeStatus: "Bank Pledged"`; `PUT /:id/bank-pledge/:pledgeId/release`
stamps its `releaseDate` and sets `bankPledgeStatus: "Released"`.
`POST /:id/auction` records `auctionDate`/`auctionAmount`, sets
`status: "Auctioned"` and zeroes `outstandingAmount` in one step — no
separate "scheduled" vs "sold" sub-state, and no bidding/settlement
sub-workflow exists.

Loan JSON shape (abbreviated — `customer`/`scheme`/`branch` are the full
preloaded objects from their own APIs above):
```json
{
  "id": 1,
  "loanNumber": "LN-00001",
  "branchId": 1,
  "customerId": 2,
  "schemeId": 1,
  "openedDate": "2026-08-10T00:00:00Z",
  "dueDate": "2027-02-10T00:00:00Z",
  "totalNetWeight": 18.5,
  "totalGoldValue": 134727.5,
  "eligibleLoanAmount": 101045.6,
  "principalAmount": 100000,
  "outstandingAmount": 100000,
  "status": "Pending Approval",
  "approvalStage": "PendingManager",
  "bankPledgeStatus": "Not Pledged",
  "auctionDate": null,
  "auctionAmount": null,
  "ornaments": [
    {
      "id": 1,
      "loanId": 1,
      "name": "Chain",
      "purity": "22K",
      "grossWeight": 20,
      "deductionWeight": 1.5,
      "netWeight": 18.5,
      "quantity": 1,
      "goldValue": 134727.5,
      "remarks": "",
      "purityTest": null,
      "images": []
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/loans` | Create a loan with its ornaments | `{ "branchId", "customerId", "schemeId", "openedDate", "dueDate", "principalAmount", "ornaments": [{ "name", "purity", "grossWeight", "deductionWeight"?, "quantity"?, "remarks"? }] }` |
| GET | `/api/v1/loans` | List/filter loans | query: `status`, `branchId`, `customerId`, `q` (matches `loanNumber`) |
| GET | `/api/v1/loans/:id` | Get one loan with ornaments/approvals/payments/bank-pledge history | — |
| POST | `/api/v1/loans/:id/ornaments` | Pledge an additional ornament, recalculates loan totals | `{ "name", "purity", "grossWeight", "deductionWeight"?, "quantity"?, "remarks"? }` |
| PUT | `/api/v1/loans/ornaments/:ornamentId` | Edit a pledged ornament, recalculates its loan's totals | same body as above |
| POST | `/api/v1/loans/ornaments/:ornamentId/purity-test` | Record staff purity re-test (upsert, one per ornament) | `{ "testedPurity", "testedGrossWeight", "testedDeductionWeight"?, "testingRemarks"?, "testedBy", "testedAt" }` |
| POST | `/api/v1/loans/ornaments/:ornamentId/images` | Attach one photo (upload it first via `/api/v1/uploads`) | `{ "imageUrl" }` |
| POST | `/api/v1/loans/:id/approve` | Advance/reject the approval chain | `{ "stage": "Manager" \| "Management", "action": "Approved" \| "Rejected", "employeeId", "remarks"? }` |
| POST | `/api/v1/loans/:id/payments` | Record a payment | `{ "amount", "type": "Interest" \| "Principal" \| "Partial" \| "Full Settlement", "paidOn", "employeeId" }` |
| POST | `/api/v1/loans/:id/bank-pledge` | Record a bank pledge | `{ "bankName", "pledgedAmount", "pledgeDate" }` |
| PUT | `/api/v1/loans/:id/bank-pledge/:pledgeId/release` | Release a bank pledge | — |
| POST | `/api/v1/loans/:id/auction` | Record an auction sale — sets `status: "Auctioned"`, zeroes `outstandingAmount` | `{ "auctionDate", "auctionAmount" }` |

`RecordBankPledge`/`ReleaseBankPledge` also fire a matching packet movement
(see the Packets API below) on the loan's active packet — `Bank Pledged`
on pledge, `Returned` on release — via a narrow `loan.PacketMover`
interface implemented by `packet.Service`. `loan.Service.Create()` also
auto-generates the loan's tracking packet (`loan.PacketCreator`,
implemented by `packet.Service`) right after a loan is created. Both are
fail-soft: an error logs and the loan-level action still succeeds — packet
tracking is an enrichment, not a hard lending-flow dependency.

## Lockers API (`/api/v1/lockers`)
Implemented in `backend/internal/locker/` — real per-branch Locker/Vault
management, replacing `LockerModal.tsx`'s old `localStorage`-backed mock.
No authentication/RBAC yet.

```json
{
  "id": 1,
  "code": "LKR-B2",
  "branchId": 1,
  "branch": { "id": 1, "name": "Koratty", "code": "K021", ... },
  "capacity": 30,
  "isActive": true,
  "occupied": 4,
  "createdAt": "2026-08-10T00:00:00Z",
  "updatedAt": "2026-08-10T00:00:00Z"
}
```

`occupied` is **derived, not stored** — computed on every read by counting
`Packet` rows with `currentLockerId` = this locker and `status = "Locker
Stored"` (`packet.Repository.CountActivePackets`, injected into
`locker.Service` as the narrow `locker.PacketCounter` interface so
`internal/locker` never imports `internal/packet`; the reverse capacity
check goes through `packet.LockerCapacityProvider`, implemented by
`locker.Repository.Capacity`, so neither package imports the other).

`code` must be unique (400 if it collides); `branchId` must reference an
existing branch (400 `ErrBranchInvalid` otherwise); `capacity` must be > 0.

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET | `/api/v1/lockers` | List all lockers with derived occupancy | — |
| GET | `/api/v1/lockers/:id` | Get one locker | — |
| POST | `/api/v1/lockers` | Create a locker | `{ "code", "branchId", "capacity" }` |
| PUT | `/api/v1/lockers/:id` | Update a locker | `{ "code", "branchId", "capacity", "isActive" }` |
| DELETE | `/api/v1/lockers/:id` | Remove a locker (blocked with 400 `ErrInUse` while it still holds packets) | — |

## Packets API (`/api/v1/packets`)
Implemented in `backend/internal/packet/` — Gold Packet Management /
Barcode-QR tracking (compliance doc §9–10). Every loan gets exactly one
active tracking `Packet` (auto-created right after
`POST /api/v1/loans` succeeds), which moves through a fixed set of stages,
each transition stamped as a `PacketMovement` audit row (date/time,
locker, responsible employee, remarks). A packet always represents *all*
of its loan's pledged ornaments — there is no ornament-level split/subset
logic. No camera-based QR scanning yet; `GET /packets/by-code/:code`
powers today's plain-text/keyboard-wedge-scanner lookup input
(`Packets.tsx`) and is ready for a future dedicated scanning app.

```json
{
  "id": 1,
  "code": "PKT-000001",
  "loanId": 3,
  "loan": { "id": 3, "loanNumber": "LN-00003", "branch": {...}, "customer": {...}, "ornaments": [...], ... },
  "status": "Locker Stored",
  "currentLockerId": 1,
  "createdAt": "2026-08-10T00:00:00Z",
  "updatedAt": "2026-08-10T00:00:00Z"
}
```

Stage values (`status`): `Packet Generated`, `Locker Stored`,
`Bank Pledged`, `Returned`, `Ready For Release`, `Released`. Allowed
transitions (enforced in `packet.Service.RecordMovement`; anything else
returns 400 `ErrInvalidPacketTransition`):

```
Packet Generated → Locker Stored
Locker Stored    → Bank Pledged | Ready For Release
Bank Pledged      → Returned
Returned          → Locker Stored | Ready For Release
Ready For Release → Released   (terminal)
```

Checking a packet into a locker (`toStatus: "Locker Stored"`) requires
`lockerId` (400 `ErrLockerRequired` otherwise) and is rejected with 400
`ErrLockerFull` if the target locker is already at capacity, or 400
`ErrLockerInvalid` if the locker doesn't exist/is inactive.

```json
{
  "id": 3,
  "packetId": 1,
  "fromStatus": "Locker Stored",
  "toStatus": "Bank Pledged",
  "lockerId": null,
  "actorEmployeeId": 0,
  "remarks": "Bank pledge: SBI",
  "createdAt": "2026-08-10T00:00:00Z"
}
```

`actorEmployeeId` is `0` for movements triggered automatically by a loan's
bank-pledge/release action (no staff-entered `employeeId` on that call);
staff-driven check-in/check-out/release actions from `PacketDetail.tsx`
pass a real employee id.

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET | `/api/v1/packets` | List/filter packets, newest first | query: `loanId`?, `branchId`? (via joined loan), `status`?, `lockerId`? |
| GET | `/api/v1/packets/:id` | Get one packet | — |
| GET | `/api/v1/packets/by-code/:code` | Look up a packet by its Code (scanner/manual-entry lookup) | — |
| GET | `/api/v1/packets/:id/movements` | Full movement history, oldest first | — |
| POST | `/api/v1/packets/:id/movements` | Record a stage transition | `{ "toStatus", "lockerId"?, "employeeId", "remarks"? }` |

## Uploads API (`/api/v1/uploads`)
Implemented in `backend/internal/upload/`. A small, shared, storage-only
endpoint — no model/service/repository, just multipart file → local disk.
Used by Customer's photo/identity-proof/address-proof/KYC-document fields
and by `NewLoan.tsx`'s ornament photo picker. Files are written to
`UPLOADS_DIR` (default `./uploads`, gitignored) and served back at
`/uploads/<filename>` via a static route registered in `main.go`. This is
explicitly a "for now" design (per the Customer Module stage-1 plan) —
swapping to real object storage (S3/GCS) later only means changing this
one handler, not any caller.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/uploads` | Upload one file, get back its URL | multipart form, field name `file` → `{ "url": "/uploads/<id>-<filename>" }` |

## Server behavior — legacy static file server (`backend/server.mjs`, superseded)
Kept in the repo for reference; no longer the frontend's server. The Go
binary (`backend/main.go`, `internal/webstatic`) now serves `frontend/out` with
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
| `addCustomer` | `POST /api/customers` | **Done** — implemented as `POST /api/v1/customers` (see Customers API above); stage 1 only — no live PAN/Aadhaar verification |
| `saveSchemes` | `PUT /api/schemes` | **Done** — `/api/v1/schemes` |
| `addLoan` | `POST /api/loans` | **Done** — implemented as `POST /api/v1/loans` (see Loans API above); not yet wired to `NewLoan.tsx` |
| `updateLoan` | `PATCH /api/loans/:id` | Partially done — no generic `PATCH`, but `POST /:id/ornaments`, `PUT /ornaments/:ornamentId`, and `POST /:id/approve` cover the update paths the doc calls for |
| `saveLockers` | `PUT /api/lockers` | **Done** — implemented as `POST/GET/PUT/DELETE /api/v1/lockers` (see Lockers API above) |
| _(new)_ Packet Management | `GET/POST /api/packets` | **Done** — implemented as `/api/v1/packets` (see Packets API above); auto-created per loan, no manual create endpoint |
| `addPayment` | `POST /api/loans/:id/payments` | **Done** — see Loans API above |
| `addCashMovement` | `POST /api/cash-movements` | **Done** — see above |
| `setCashLoanStatus` | `PATCH /api/loans/:id/cash-status` | **Done** — implemented as `PATCH /api/v1/cash-movements/:id/status` instead of a loan-scoped path, since the loan domain doesn't exist yet |
| `addExpense` | `POST /api/expenses` | **Done** — see above |
| `addEmployee` | `POST /api/employees` | **Done** — see above |
| `updateAuction` | `PATCH /api/auctions/:loanId` | Not started |
| _(new)_ Branch Management | `POST/GET/PUT/DELETE /api/branches` | **Done** — see Branches API above |

Plus read endpoints for each entity (e.g. `GET /api/customers`,
`GET /api/loans/:id`, `GET /api/packets`, `GET /api/reports/...`) and an
authentication endpoint (e.g. `POST /api/auth/login`) to back the sign-in
page in `frontend/index.html`.

This table is a starting proposal only — finalize routes, request/response
schemas, and auth model when the backend is actually built.
