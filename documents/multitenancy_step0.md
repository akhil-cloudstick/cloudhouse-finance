# Multi-tenancy — Step 0: audits and decisions

> Prerequisite for every other step of the multi-tenant work. **No schema
> changes until this document is complete and agreed.** This file is the
> record of what was audited and what was decided.

Status: 0a complete · 0b complete · 0c complete. Login mechanism decided.
Two open questions remain (see the end) — neither blocks Step 1.

**Step 1 is implemented** (schema only, no behaviour change): tenant/tier
tables, `platform.TenantScoped` on all 37 models, all 16 constraints below
moved to per-business, and per-business code sequences. Verified against a
clone of the live database. See `documents/change_log.md`.

Still outstanding from 0a: the five code generators listed under *The
generated-code problem* still count rows. The sequence allocator that replaces
them exists and is seeded, but wiring it up needs a tenant in request context,
which arrives with Step 2.

---

## 0a. Unique-constraint audit

A shared database turns "unique across the system" into "only one of my
customers may ever use this value". Below is **every** unique index in the
live database — taken from `pg_index`, not from the Go struct tags, because
the database is what actually rejects an insert — with a decision for each.

Primary keys are omitted: they are surrogate `id` columns and are unaffected.

### Must become unique *within a business*

These currently mean "only one business may ever have this value". Each one
blocks onboarding the second customer.

| Table | Today | Becomes | Why |
|---|---|---|---|
| `loans` | `loan_number` | `(tenant_id, loan_number)` | Every business numbers loans from 1. The second business's first loan is rejected outright. |
| `customers` | `code` | `(tenant_id, code)` | Same — both start at `CUST-01`. |
| `employees` | `code` | `(tenant_id, code)` | Same — both start at `EMP-01`. |
| `packets` | `code` | `(tenant_id, code)` | Same — both start at `PKT-000001`. |
| `schemes` | `code` | `(tenant_id, code)` | Same — both start at `SCH-01`. |
| `branches` | `code` | `(tenant_id, code)` | Staff-entered. "BR-01" or "HO" is an obvious first choice for everyone. |
| `branches` | `name` | `(tenant_id, name)` | Two businesses may each have a "Head Office" — and `SeedAdmin` creates exactly that name. |
| `lockers` | `code` | `(tenant_id, code)` | Staff-entered, e.g. "L-01". |
| `banks` | `name` | `(tenant_id, name)` | Only one business could have "SBI". Absurd as a global rule. |
| `ornament_types` | `name` | `(tenant_id, name)` | Only one business could have "Bangle". |
| `roles` | `name` | `(tenant_id, name)` | Only one business could have a "Cashier" role. |
| `approval_limits` | `role` | `(tenant_id, role)` | Sanction limits are per-role, and roles are per-business. |

### Login identifiers — per business (decided)

| Table | Today | Becomes | Note |
|---|---|---|---|
| `employees` | `username` (partial, non-empty) | `(tenant_id, username)` | Two businesses may each have a "ravi". |
| `employees` | `phone` (partial, non-empty) | `(tenant_id, phone)` | A person may work for two of your customers. |
| `employees` | `email` (partial, non-empty) | `(tenant_id, email)` | Same. |
| `customer_otp` | `phone` | `(tenant_id, phone)` | A borrower may borrow from two businesses; each gets its own OTP. |

**Consequence — the login screen must change.** "ravi" no longer identifies an
account, so authentication has to establish the business *first*. See Open
question 1.

### Stay globally unique

| Table | Index | Why unchanged |
|---|---|---|
| `customer_device_tokens` | `token_hash` | A random token; a collision must be rejected whoever it belongs to. Never used to *find* a business, only to authenticate an already-issued token. |
| `permissions` | `name` | The permission catalogue is seeded from hardcoded Go (`authz.Catalogue`) and stays global. Only the per-business *grants* (`role_permissions`) and *role rows* become tenant-owned. |
| `api_key_settings` | `category` | KYC/PAN/WhatsApp/SMS credentials stay shared, on your instruction. See Open question 3. |

### Already safe — scoped by a foreign key

No change needed; the parent row already belongs to exactly one business.

| Table | Index | Scoped via |
|---|---|---|
| `opening_cash_balances` | `(branch_id, balance_date)` | `branch_id` |
| `role_permissions` | `(role_id, permission_id)` | `role_id` |
| `ornament_purity_tests` | `ornament_id` | ornament → loan |
| `auction_records` | `loan_id` (partial: active only) | loan |
| `auction_decision_requests` | `(auction_record_id, kind)` (partial: pending only) | auction → loan |

`purity_standards` has **no** unique index at all today, only its primary key,
so nothing blocks it — though the table still becomes per-business.

### The generated-code problem (found during this audit)

Five human-readable codes are generated as **"count every row that has ever
existed, add 1"**:

| Code | Where |
|---|---|
| `LN-%05d` | `internal/loan/service.go:493` |
| `CUST-%02d` | `internal/customer/service.go:118` |
| `EMP-%02d` | `internal/employee/service.go:218` |
| `PKT-%06d` | `internal/packet/service.go:86` |
| `SCH-%02d` | `internal/scheme/service.go:95` |

Three separate problems, all fixed by the same change:

1. **They collide.** Every business's first loan is `LN-00001`.
2. **They leak commercial information.** With a global count, Business B's next
   customer code reveals roughly how many customers Business A has. Your
   customers can infer each other's size from their own screens. This is the
   one that would be hardest to explain afterwards.
3. **They are already racy**, before any multi-tenancy: two simultaneous
   creates read the same count and generate the same code, and only the unique
   index stops the second — as a 500, not a retry.

**Decision:** each business gets its own sequence, allocated atomically rather
than by counting rows — a per-business counter row updated in the same
transaction as the insert. Row-counting must not survive this change in any of
the five places.

---

## 0b. Authorization matrix

Written before implementation deliberately: cheap now, expensive to
reverse-engineer later. The automated cross-business tests are generated from
it.

**V** Vendor · **A** Administrator · **M** Management · **BM** Branch Manager ·
**LO** Loan Operator · **C** Cashier · **Ac** Accountant · **CS** Collection
Staff · **AA** Auction Admin · **Au** Auditor · **B** Borrower

`own` = own branch only · `all` = all branches in their business

| Action | V | A | M | BM | LO | C | Ac | CS | AA | Au | B |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Platform** | | | | | | | | | | | |
| Create/suspend a business | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Set a business's plan/quota | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read any business's customer/loan data | ❌ | — | — | — | — | — | — | — | — | — | — |
| **Commercial** | | | | | | | | | | | |
| Choose plan / pay | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Change branding | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Branches** | | | | | | | | | | | |
| Create/update/delete branch | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Data visible | ❌ | all | all | own | own | own | own | own | own | all | ❌ |
| Switch active branch | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Staff & roles** | | | | | | | | | | | |
| Create/update staff | ❌ | ✅ | ❌ | own | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Assign the Administrator role | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| See that the Administrator role exists | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create/edit other roles & grants | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Lending** | | | | | | | | | | | |
| Create loan | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve/sanction loan | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Record payment | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Repay own loan | ❌ | — | — | — | — | — | — | — | — | — | ✅ |
| Approve extension/release request | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bank re-pledge / release | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Run auction workflow | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Custody & money** | | | | | | | | | | | |
| Move packets / lockers | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cash movements / expenses | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Approve an expense | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Set gold rate | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Data** | | | | | | | | | | | |
| View customer KYC documents | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | own |
| Export reports | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| View integration credentials | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Two rules hold everywhere and are **not** expressible in the grid:

- **No role in any business, Administrator included, can read another
  business's data.** The grid describes what a role may do *within its own
  business*. Cross-business is not a permission that exists.
- **Vendor is the inverse:** it crosses businesses, but only over accounts,
  plans and billing — never customers, loans, payments, KYC or documents.
  Enforced server-side, not merely hidden in the interface.

The grid is derived from today's `authz.Catalogue` and `Restrictions`. The
Branch Manager and Accountant rows are inferred rather than stated, and are
the ones most worth review before they become enforced.

---

## 0c. Attack-surface inventory

Every route by which data can leave the system. Anything not on this list is
assumed unprotected. Each line needs an owner and an automated test.

| # | Surface | Where | Business established from | Risk if missed |
|---|---|---|---|---|
| 1 | Staff HTTP API | `internal/*/routes.go` under `protected` | Authenticated employee | Cross-business reads and writes |
| 2 | Borrower HTTP API | `/api/v1/customer/*` | Authenticated customer | A borrower reads another business's loans |
| 3 | Auth endpoints | `/api/v1/auth/*` (public) | — | Login and reset must not reveal whether a username exists in another business |
| 4 | File downloads | `router.Static("/uploads")` | **Nothing — no check at all today** | KYC documents readable by guessing a URL |
| 5 | Report exports | `internal/reports/export.go` (xlsx/pdf) | Request | Classic blind spot: correct on screen, leaking in the file |
| 6 | Printed receipts | `common/utils/print.ts` | Client-side | Wrong business's branding or data on a legal document |
| 7 | Reports API (16) | `internal/reports/*.go`, `db.Table` + joins | Request | Alias handling — the most likely thing to break |
| 8 | Dashboard | `internal/dashboard` | Request | Aggregates spanning businesses |
| 9 | SMS / WhatsApp | `internal/platform/{sms,whatsapp}.go` | Caller | Messaging the wrong business's borrowers |
| 10 | Notification resend | `ResendPending` **goroutine**, every 10 min | **No request context** | Runs unscoped today |
| 11 | Due/overdue sweep | `CheckDueAndOverdueLoans` **goroutine**, hourly | **No request context** | Sends reminders to real borrowers across businesses |
| 12 | Live updates | `internal/realtime` | Connection | Pushes another business's events |
| 13 | Payment webhooks | Razorpay callback | **The stored subscription, never the payload** | A forged business id in a webhook body |
| 14 | Borrower OTP | `internal/customerauth` | Phone | See Open question 2 |
| 15 | Frontend storage | `localStorage` / `sessionStorage` | Browser | Stale business data after switching accounts on a shared machine |
| 16 | Migrations / CLI | `cmd/*`, `internal/migrate` | Deliberately unscoped | Correct — but must be the *only* unscoped path |

Items **4, 10, 11 and 13** have no business context at all today and cannot be
fixed by the query-level filter alone.

---

## Decided

**Login is per-business, reached through a per-business link.** Both staff and
borrowers arrive at a URL carrying their business's code — `/login/cloudhouse`,
`/app/cloudhouse` — so the business is established before any credential is
entered, and neither screen needs a picker or an extra field.

Consequences to build for, since the code now lives in the URL:

- **A bare `/login` must not dead-end.** Anyone who bookmarks or types the
  plain URL, or whose link is truncated, needs a way through: show a business
  code field on the bare path only, as a fallback. Without it, "the link
  stopped working" becomes your most common support call.
- **The code is part of the identity, so it must be stable.** A business
  renaming itself cannot silently change its code and break every saved
  bookmark. Treat the code as immutable after creation, or keep old codes
  redirecting.
- **The URL is not a security boundary.** It selects which business to
  authenticate against; it grants nothing. A valid code with wrong credentials
  fails exactly as it does today.
- **Login must not leak across businesses.** Given a valid business code, a
  wrong username and a right-username-wrong-password must be indistinguishable
  in both response and timing — otherwise the login page becomes a way to
  enumerate one business's staff from outside.
- **Password reset carries the business too**, since the reset link and the
  SMS OTP lookup both key on a phone that is now only unique within a
  business.

## Open questions

1. **Shared KYC/SMS/WhatsApp credentials** stay as-is by your instruction, with
   per-business usage caps and suspension cut-off added. Worth re-confirming
   before launch — it carries the regulatory exposure, since gold-loan identity
   checks should be attributable to the business that performed them.

2. **Branch Manager and Accountant rows** in the matrix are inferred from
   today's catalogue rather than stated by you.
