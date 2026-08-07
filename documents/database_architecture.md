# Database Architecture

## Current state: four real tables, the rest still mock
A real PostgreSQL database (`ambikagold`) now exists, connected via GORM
from the Go backend in `backend/`. Four tables are real so far —
**schemes**, **gold_rates**, **employees**, **cash_movements**, and
**expenses** (see below); every other entity described in this document
is still a plain JavaScript/TypeScript object defined in
[frontend/lib/data.ts](../frontend/lib/data.ts), seeded in memory and
persisted to the browser's `localStorage` (per-browser, not shared between
users/devices) — see the "Migration notes" section for what's still ahead.
None of the four real tables are wired to the frontend yet; `data.ts`'s
mock shapes for these entities (below) are still what the UI actually
reads/writes until that migration batch happens.

This document describes the **effective data model** implied by that mock
layer, intended as the starting point for designing the remaining real
database schema.

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
| branch | string | Branch assigned |
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
| branch | string | Required |
| status | string | Always `"Pending"` on create — no approve/reject workflow yet |
| receipt_image | text | Optional base64 data URL — no object storage wired yet, see architecture.md's File Uploads note |
| created_at | timestamp | standard GORM timestamp |

See [api_documentation.md](api_documentation.md) for the live
`/api/v1/expenses` endpoints built on this table.

## localStorage keys
Mutations are persisted under keys such as: `agf_rates`, `agf_schemes`,
`agf_new_customers`, and similar `agf_*` keys per entity.

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

### customers
| Field | Description |
|---|---|
| id | Customer ID |
| name | Full name |
| phone | Phone number |
| dob | Date of birth |
| addr | Address |
| pan | PAN number (KYC) |
| aadhaar | Aadhaar number (KYC) |
| kyc | KYC status/documents |
| photo | Photo reference |
| branch | Branch assigned |
| loans[] | List of associated loan IDs |
| since | Customer-since date |

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

### packets
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

### lockers
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
`saveRates`, `addCustomer`, `saveSchemes`, `addLoan`, `saveLockers`,
`addPayment`, `addCashMovement`, `setCashLoanStatus`, `addExpense`,
`addEmployee`, `updateLoan`, `updateAuction`.

## Migration notes for a real database
When implementing a real backend, this mock model suggests the following
relational tables (rough sketch): `customers`, `loans` (FK → customers,
schemes), `schemes`, `ornaments` (FK → loans), `ledger_entries` (FK → loans),
`packets` (FK → loans, lockers), `lockers`, `expenses`, `cash_movements`,
`requests` (FK → loans, customers), `approvals` (FK → loans), `auctions`
(FK → loans), `banks`/`bank_pledges`, `employees`, `gold_rates`,
`gold_rate_history`, `calendar_events`. Exact keys/types/constraints should
be finalized when the real schema is designed.
