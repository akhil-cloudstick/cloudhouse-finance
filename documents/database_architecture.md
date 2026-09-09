# Database Architecture

## Current state: real tables, some entities still mock
A real PostgreSQL database (`cloudhouse`) now exists, connected via GORM
from the Go backend in `backend/`. Real tables so far include
**branches**, **api_key_settings**, **schemes**, **gold_rates**,
**employees**, **cash_movements**, **expenses**, **customers**, **loans**
(+ ornaments/approvals/payments/bank pledges), **banks**,
**ornament_types**, **lockers**, and **packets**/**packet_movements** (see
below); every other entity described in this document is still a plain
JavaScript/TypeScript object defined in
[frontend/lib/data.ts](../frontend/lib/data.ts), seeded in memory and
persisted to the browser's `localStorage` (per-browser, not shared between
users/devices) — see the "Migration notes" section for what's still ahead.
`branches`, `api_key_settings`, `schemes`, and `customers` are wired to
the frontend (`frontend/components/Branches.tsx`, `Settings.tsx`,
`Schemes.tsx`, and `Customers.tsx`/`CustomerDetail.tsx`/
`modals/RegisterCustomerModal.tsx` call their live endpoints directly);
`data.ts`'s mock shapes for the other entities (below) are still what the
UI actually reads/writes until that migration batch happens. Uploaded
files (customer photos/KYC documents, ornament photos) are NOT a database
table — they're plain files on local disk under `backend/uploads/`,
served via `internal/upload`; only their URL string is stored in a row.

`employees` and `expenses` carry a real `branch_id` foreign key into
`branches` (replacing their old free-text `branch` column); `cash_movements`
carries a nullable `branch_id` too. `customers` also carries a real,
required `branch_id` FK from the start (see below). Loans/Lockers still
use a free-text `branch` string in their mock shapes — they're a planned
future phase to receive a real `branch_id` FK once those entities get
real backend tables (see "Migration notes").

This document describes the **effective data model** implied by that mock
layer, intended as the starting point for designing the remaining real
database schema.

## branches (real table — implemented)
Defined in `backend/internal/branch/model.go`, migrated via GORM
`AutoMigrate`. The central table every branch-scoped domain links to.

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| name | string, unique | Branch name, e.g. "Koratty" |
| code | string, unique | Optional short code, e.g. "KOR01" |
| address | string | Required |
| phone | string | Optional |
| is_active | bool | Defaults `true`; `DELETE` sets this to `false` instead of removing the row (rejected with 400 if the branch still has linked employees/expenses/cash movements) |
| created_at / updated_at / deleted_at | timestamp | standard GORM timestamps + soft delete |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/branches` endpoints built on this table.

## api_key_settings (real table — implemented)
Defined in `backend/internal/settings/model.go`, migrated via GORM
`AutoMigrate`. Backs the admin-only Settings page — one row per fixed
integration category, upserted as the admin sets/updates it.

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| category | string, unique | One of `notification`, `sms`, `whatsapp`, `kyc_verification`, `aadhaar_verification`, `pan_verification` — a fixed, not admin-extensible, list |
| name | string | Admin's own free-text label for the key, e.g. "Twilio prod key" |
| encrypted_value | text | AES-256-GCM ciphertext (base64), never stored or logged in plaintext — see `internal/platform.Cipher` and `SETTINGS_ENCRYPTION_KEY` in `.env.example` |
| created_at / updated_at | timestamp | standard GORM timestamps |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/settings/api-keys` endpoints built on this table.

## schemes (real table — implemented)
Defined in `backend/internal/scheme/model.go`, migrated via GORM
`AutoMigrate`. Superseded the mock `schemes` shape below.

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| code | string, unique | generated display code, e.g. `SCH-01` |
| name | string | Scheme Name |
| interest_rate | float64 | Interest Rate (%) |
| start_date | timestamp | Scheme validity window start (date picker) |
| end_date | timestamp | Scheme validity window end (date picker) |
| ltv_percent | float64 | Loan-to-Value Percentage |
| interest_method | string | Interest Calculation Method |
| penal_rate | float64 | Penal interest rate |
| conditions | text | Applicable Conditions (free text) |
| is_active | bool | Active/Inactive status; can only be `true` while `now` is within `[start_date, end_date]` |
| created_at / updated_at / deleted_at | timestamp | standard GORM timestamps + soft delete |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/schemes` endpoints built on this table.

## gold_rates (real table — implemented)
Defined in `backend/internal/goldrate/model.go`, migrated via GORM
`AutoMigrate`. Append-only — every "Set Today's Rate" publish inserts a
new row; there is no in-place "current rate" row to update. Supersedes
the mock `rates`/`rateHistory` shapes below (which were two separate
structures; this is one unified history table).

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| date | timestamp | date the rate applies to |
| k24 / k22 / k18 | float64 | rate per gram, by purity; all must be `> 0` |
| set_by | string | user/employee who published the rate |
| created_at | timestamp | standard GORM timestamp |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/gold-rates` endpoints built on this table.

## employees (real table — implemented)
Defined in `backend/internal/employee/model.go`, migrated via GORM
`AutoMigrate`. Supersedes the mock `employees` shape below.

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| code | string, unique | generated display code, e.g. `EMP-01` |
| name | string | Employee name |
| role | string | Role (Administrator, Branch Manager, etc.) |
| branch_id | uint, FK → branches.id | Required; replaces the old free-text `branch` column |
| phone | string | Optional |
| loans_processed | int | Performance counter — starts at 0, admin-editable via `PUT` |
| collections | float64 | Performance counter — starts at 0, admin-editable via `PUT` |
| followups | int | Performance counter — starts at 0, admin-editable via `PUT` |
| pending | int | Performance counter — starts at 0, admin-editable via `PUT` |
| created_at / updated_at / deleted_at | timestamp | standard GORM timestamps + soft delete |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/employees` endpoints built on this table.

## cash_movements (real table — implemented)
Defined in `backend/internal/cash/model.go`, migrated via GORM
`AutoMigrate`. Supersedes the mock `cashMovements` shape below.

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| type | string | `"in"` or `"out"` |
| source | string | `"Savings"` or `"Loan"` — only set when `type = "in"` |
| purpose | string | Only set when `type = "out"` |
| bank | string | Required when `source = "Loan"` |
| amount | float64 | Must be `> 0` |
| status | string | `"Open"`/`"Closed"` — only set for loan-sourced cash-in |
| branch_id | uint, nullable FK → branches.id | Optional — not every cash movement is tied to a till yet |
| occurred_on | timestamp | Movement date |
| created_at | timestamp | standard GORM timestamp |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/cash-movements` endpoints built on this table.

## expenses (real table — implemented)
Defined in `backend/internal/cash/model.go`, migrated via GORM
`AutoMigrate`. Supersedes the mock `expenses` shape below.

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| occurred_on | timestamp | Expense date |
| category | string | Required |
| amount | float64 | Must be `> 0` |
| mode | string | Payment mode, required |
| payee | string | Required |
| branch_id | uint, FK → branches.id | Required; replaces the old free-text `branch` column |
| status | string | Always `"Pending"` on create — no approve/reject workflow yet |
| receipt_image | text | Optional base64 data URL — no object storage wired yet, see architecture.md's File Uploads note |
| created_at | timestamp | standard GORM timestamp |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/expenses` endpoints built on this table.

## customers (real table — implemented)
Defined in `backend/internal/customer/model.go`, migrated via GORM
`AutoMigrate`. Supersedes the mock `customers` shape below. **Stage 1 —
no live verification**: `kyc_status`/`pan_status`/`aadhaar_status` are
hardcoded `"Verified"` at creation (see model-level comment); this
unblocks downstream flows (New Loan's customer picker) for testing, but
is not a real KYC result yet.

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| code | string, unique | Server-generated, `CUST-01` style |
| name | string | Required |
| phone | string | Required |
| dob | timestamp | Optional |
| address | string | Optional |
| branch_id | uint, FK → branches.id | Required |
| photo_url | string | URL from `POST /api/v1/uploads`, optional |
| identity_proof_url | string | URL from `POST /api/v1/uploads`, optional |
| address_proof_url | string | URL from `POST /api/v1/uploads`, optional |
| kyc_document_url | string | URL from `POST /api/v1/uploads`, optional |
| pan | string | Plaintext — needed verbatim for a future Setu PAN-verify call |
| aadhaar_last4 | string(4) | Plaintext, display only |
| aadhaar_encrypted | text | AES-256-GCM ciphertext (`AADHAAR_ENCRYPTION_KEY`) — the full Aadhaar number is **never** stored in plaintext, and this column is **never** returned by any API response (see `CustomerResponse` in api_documentation.md) |
| nominee_name / nominee_relation / nominee_phone | string | Optional |
| kyc_status / pan_status / aadhaar_status | string | Hardcoded `"Verified"` at creation — stage-1 stub, see above |
| created_at / updated_at | timestamp | standard GORM timestamps |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/customers` endpoints built on this table, and
`/api/v1/uploads` for how the `*_url` columns are populated.

## lockers (real table — implemented)
Defined in `backend/internal/locker/model.go`. Supersedes the mock
`lockers` shape below (the old `localStorage`-backed `agf_lockers` list).

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| code | string, unique | e.g. `LKR-B2` |
| branch_id | uint, FK → branches.id | Required |
| capacity | int | Required, > 0 |
| is_active | bool | default `true` |
| created_at / updated_at / deleted_at | timestamp | GORM soft-delete via `deleted_at` |

`occupied` (current packet count) is intentionally **not** a column — it's
derived at read time by counting `packets` rows with `current_locker_id`
= this locker and `status = 'Locker Stored'`. See
`locker.PacketCounter`/`packet.LockerCapacityProvider` in
api_documentation.md's Lockers/Packets sections for how the two tables
cross-reference each other's row-counts without either Go package
importing the other.

## packets / packet_movements (real tables — implemented)
Defined in `backend/internal/packet/model.go`. Supersedes the mock
`packets` shape below (which was never actually populated — `Packets.tsx`
used to synthesize fake rows from the loan list).

**packets**

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| code | string, unique | Server-generated, `PKT-000001` style |
| loan_id | uint, FK → loans.id, indexed | Required — one loan can have more than one packet row over time (e.g. a replacement), but at most one is "active" (non-`Released`) at a time |
| status | string(30) | `Packet Generated` \| `Locker Stored` \| `Bank Pledged` \| `Returned` \| `Ready For Release` \| `Released` |
| current_locker_id | uint, nullable | Set only while `status = 'Locker Stored'` |
| created_at / updated_at | timestamp | standard GORM timestamps |

**packet_movements** — the full audit trail of every stage transition.

| Column | Type | Notes |
|---|---|---|
| id | uint, PK | auto-increment |
| packet_id | uint, FK → packets.id, indexed | Required |
| from_status | string(30) | Empty on the first row (packet creation) |
| to_status | string(30) | Required |
| locker_id | uint, nullable | Set for check-in/check-out transitions |
| actor_employee_id | uint | `0` for movements auto-triggered by a loan's bank-pledge/release action; a real employee id for staff-driven transitions |
| remarks | string(255) | Optional |
| created_at | timestamp | Movement timestamp |

## localStorage keys
Mutations are persisted under keys such as: `agf_rates`, `agf_schemes`,
and similar `agf_*` keys per entity. (`agf_new_customers` was removed —
customers are fully real now, see "customers (real table)" above.)

## Entities

### rates (daily gold rate) — mock shape, superseded
Frontend mock shape only; the real `gold_rates` table (see above) unifies
this and `rateHistory` into one append-only history table.

| Field | Description |
|---|---|
| date | Date the rate applies |
| k24 | Rate per gram, 24 karat |
| k22 | Rate per gram, 22 karat |
| k18 | Rate per gram, 18 karat |
| setBy | User/employee who set the rate |

### rateHistory — mock shape, superseded
Array of `{ date, k24, k22, k18, by }` — historical log of rate changes.
See `gold_rates` above.

### schemes (loan schemes/plans) — mock shape, superseded
Frontend mock shape only; the real table (see "schemes (real table)"
above) replaces `duration` with `start_date`/`end_date` and adds `code`.

| Field | Description |
|---|---|
| id | Scheme identifier |
| name | Scheme name |
| rate | Interest rate |
| duration | Loan duration |
| ltv | Loan-to-value ratio |
| method | Interest calculation method |
| penal | Penal interest rate |
| cond | Conditions/terms text |
| active | Whether scheme is active |

### customers — mock shape, superseded
This mock shape no longer exists in `data.ts` — replaced entirely by the
real `customers` table (see "customers (real table)" above). Kept here
only as a historical reference for the fields the old prototype used
(`addr`→`address`, `kyc`→`kyc_status`, `branch`→`branch_id`, `loans[]` was
never actually a stored column, and `since` was dropped — use
`created_at`).

### loans
| Field | Description |
|---|---|
| id | Loan ID (e.g. `GL-2041`) |
| cust | Customer ID reference |
| scheme | Scheme ID reference |
| opened | Loan open date |
| due | Due date |
| principal | Principal amount |
| outstanding | Outstanding balance |
| weight | Gold weight pledged |
| status | Loan status (active/closed/overdue/etc.) |
| pledge | Pledge details |
| packet | Associated packet ID |
| locker | Associated locker ID |
| bank? | Bank name, if re-pledged |
| bankRef? | Bank reference, if re-pledged |

### ornaments (keyed by loan id)
Array of `{ n (name), purity, gross, net, qty, val }` per loan.

### ledger (keyed by loan id)
Array of `{ d (date), desc, debit, credit, mode, ref }` — transaction history
per loan.

### packets — mock shape, superseded
Superseded by the real `packets`/`packet_movements` tables — see
"packets / packet_movements (real tables — implemented)" above.

| Field | Description |
|---|---|
| id | Packet ID |
| loan | Associated loan ID |
| cust | Associated customer ID |
| items | Ornament items in the packet |
| weight | Total weight |
| locker | Locker ID |
| status | Packet status |
| qr | QR code data/reference |

### lockers — mock shape, superseded
Superseded by the real `lockers` table — see "lockers (real table —
implemented)" above.

| Field | Description |
|---|---|
| id | Locker ID |
| branch | Branch |
| packets | Packets stored |
| cap | Capacity |
| status | Locker status |

### expenses — mock shape, superseded
Frontend mock shape only; the real `expenses` table (see above) adds
`receiptImage` and a server-generated id.

| Field | Description |
|---|---|
| d | Date |
| cat | Category |
| amt | Amount |
| mode | Payment mode |
| payee | Payee |
| branch | Branch |
| status | Status |

### cashMovements — mock shape, superseded
Dynamic `{ id, ... }` records created from the Cash & Expenses page. See
the real `cash_movements` table above.

### requests (extensions/releases)
| Field | Description |
|---|---|
| id | Request ID |
| type | Request type (extension/release/etc.) |
| loan | Loan ID |
| cust | Customer ID |
| detail | Request details |
| date | Request date |
| status | Approval status |

### approvals
| Field | Description |
|---|---|
| loan | Loan ID |
| cust | Customer ID |
| amt | Amount |
| stage | Approval stage |
| requestedBy | Requesting user |
| date | Date |

### auctions
| Field | Description |
|---|---|
| loan | Loan ID |
| cust | Customer ID |
| weight | Gold weight |
| outstanding | Outstanding amount |
| eligible | Auction eligibility |
| stage | Auction stage |
| notice | Notice details |
| auctionDate | Scheduled auction date |
| sale | Sale details/result |

### banks (re-pledging)
| Field | Description |
|---|---|
| name | Bank name |
| branch | Branch |
| ifsc | IFSC code |
| pledged | Pledged amount/weight |
| amt | Amount |

### employees — mock shape, superseded
Frontend mock shape only; the real `employees` table (see above) replaces
the plain `id` with a server-generated `code` and adds `phone`.

| Field | Description |
|---|---|
| id | Employee ID |
| name | Name |
| role | Role |
| branch | Branch |
| loans | Loans handled |
| collections | Collections made |
| followups | Follow-ups pending |
| pending | Pending items |

### calendarEvents
Keyed by day-of-month → array of `{ t (title), c (category: due/over/fup/pay) }`.

## Mutator functions (`window.DB`)
`saveRates`, `saveSchemes`, `addLoan`, `saveLockers`,
`addPayment`, `addCashMovement`, `setCashLoanStatus`, `addExpense`,
`addEmployee`, `updateLoan`, `updateAuction`. (`addCustomer` was removed —
customers are fully real now, via `lib/customersApi.ts`'s `createCustomer`.)

## Migration notes for a real database
When implementing a real backend, this mock model suggests the following
relational tables (rough sketch): `customers` (FK → branches) — **done**,
`loans` (FK → customers, schemes), `schemes`, `ornaments` (FK → loans),
`ledger_entries` (FK → loans), `packets` (FK → loans, lockers),
`lockers` (FK → branches), `expenses`, `cash_movements`,
`requests` (FK → loans, customers), `approvals` (FK → loans), `auctions`
(FK → loans), `banks`/`bank_pledges`, `employees`, `gold_rates`,
`gold_rate_history`, `calendar_events`. Exact keys/types/constraints should
be finalized when the real schema is designed.

`branches`, `employees`, `expenses`, `cash_movements`, and `customers` are
now real tables (see above) — `lockers` is next in line for a `branch_id`
FK once it gets a real backend table; for now its mock shape's `branch`
field is still a free-text string (see the "lockers" entity section
above), though the UI's branch dropdown already sources its options from
the real `/api/v1/branches` list.
