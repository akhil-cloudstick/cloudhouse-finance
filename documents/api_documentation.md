# API Documentation

> **Maintenance rule:** this file must be updated in the same change that
> adds, modifies, or removes an API endpoint. When a new endpoint is
> implemented, add it here (method, path, purpose, auth/role requirement).
> When an endpoint is removed from the backend, delete its entry here too
> — this document must never describe an endpoint that no longer exists in
> the system. Do not defer this to a later "docs pass."

## Response envelope migration (complete, 2026-08-19)

The backend has been migrated, module by module, from bare `gin.H`
responses to a single envelope via `backend/internal/platform/httpx`:
- Success: `{"success": true, "data": <resource-or-list>}`
- Delete/action confirmation: `{"success": true, "message": "<text>"}`
- Error: `{"success": false, "error": "<clean message>"}`, status classified
  to 400/401/403/404/409 (never 500 — an unclassified failure is logged
  server-side and answered with a generic 400 message instead).

All three frontends' enveloped request helpers (`apiFetchEnveloped` on web,
`apiRequestEnveloped` on both mobile apps) prefer `data` and fall back to
`message` when `data` is absent, so a delete/action-confirmation response's
plain string still reaches callers that read it.

**Every module has migrated**, including Branches, Banks, Lockers,
Employees, Ornament Types, Purity Standards, Settings, Gold Rates (incl.
customer-app routes), Reminders, Packets, Loan Schemes, Cash Movements +
Expenses, Reports, Authentication, Customer App Notifications, Uploads,
Customers (incl. customer-app profile/KYC routes), Customer App
Authentication, and Loans (incl. every `/customer/loans`/`/customer/payments`
route — see below). The auth/permission middleware
(`internal/platform/middleware.go`, gates every protected route before any
handler runs) and the static-file/API 404 fallback
(`internal/webstatic/handler.go`) were migrated too, so a 401/403/404 raised
outside any handler carries the same envelope. **The old bare-shape
response no longer exists anywhere in this API** — every section below
reflects the new envelope, and this note is kept only as a historical
record of the migration.

## Frontend restructuring (2026-08-19)

`frontend/` was reorganized from flat `lib/`/`components/` folders into
per-entity modules under `frontend/modules/<entity>/`, per the Cloudhouse
frontend standard. **Every path reference to `frontend/lib/*Api.ts`,
`frontend/lib/*Provider.tsx`, or `frontend/components/<Entity>.tsx` elsewhere
in this document is now stale** — the mechanical mapping is:
- `frontend/lib/<entity>Api.ts` → `frontend/modules/<entity>/services/<entity>Service.ts`
- `frontend/lib/<Entity>Provider.tsx` → `frontend/modules/<entity>/store/<Entity>Provider.tsx`
- `frontend/components/<Entity>.tsx` (a page, not a shared/modal component) →
  `frontend/modules/<entity>/components/<Entity>.tsx`

Shared UI (`Modal.tsx`, `Toast.tsx`, `SearchableSelect.tsx`, the `modals/`
bucket, etc.) and cross-cutting utilities (`lib/api.ts`, `format.ts`,
`icons.tsx`, `print.ts`, `purity.ts`, `auth-context.tsx`, `DataProvider.tsx`)
were **not** moved — they stay in `components/`/`lib/` as the shared/common
layer every module imports from. The pre-Next.js prototype this app was
ported from also moved, from `frontend/legacy/` to `legacy/` at the repo
root (see `legacy/README.md`) — nothing in `frontend/` imports it; it's kept
only as a reference for the "ported from `legacy/app.js`'s `renderX()`" doc
comments scattered through the moved components.

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
below. **JWT authentication + role-based permission (RBAC) checks are now
implemented** (see the new [Authentication](#authentication-api-apiv1auth)
section below) — every `/api/v1/*` route except `/auth/login`,
`/auth/forgot-password`, and `/auth/reset-password` requires a valid
`Authorization: Bearer <token>` header, and every route is additionally
gated by a `(role, resource, action)` permission check. Permissions are
currently seeded **allow-all** for all 9 roles, so in practice any logged-in
employee can still call any endpoint today — role-specific restriction is
expected to be configured later via an admin UI (not yet built) that edits
the `permissions` table directly, not via a code change. The Loans module's
3-stage sanction chain has its own separate, more granular role check (an
employee's `role` must match the stage's required role, except
`Administrator` which may act at any stage — see below) on top of the
coarse-grained RBAC above. `Branches`, `Settings`, `Schemes`, and `Customers`
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

**Customer Module — verification status:** `kycStatus`/`panStatus`/
`aadhaarStatus` all start `"Pending"` at creation — no status is ever
auto-set to `"Verified"`. `panStatus` is set only by the Setu PAN-verify
call and `aadhaarStatus` only by the DigiLocker Aadhaar check; `kycStatus`
is **derived** from those two (`deriveKYCStatus` in
`backend/internal/customer/service.go`) with precedence
`Failed > Name Mismatch > Pending > Verified`, so a customer becomes
`"Verified"` only after **both** API checks pass. Aadhaar numbers are AES-256-GCM encrypted at rest
(never stored in plaintext) and are never returned by any endpoint — only
the last 4 digits (`aadhaarLast4`) are exposed.

## Authentication API (`/api/v1/auth`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`;
`/auth/forgot-password` and `/auth/reset-password` now return their
confirmation as a plain string under `"message"` (`{"success": true,
"message": "..."}`), not `{"message": "..."}`. Invalid credentials / an
account with no login set up return **401 Unauthorized** (previously the
same, unchanged); an invalid/expired reset code stays **400**.

Implemented in `backend/internal/auth/` (login/forgot/reset/me) plus
`backend/internal/authz/` (the permissions table) and
`backend/internal/platform/` (JWT issuing/parsing, the `AuthMiddleware`/
`RequirePermission` Gin middleware, and `SMSSender` for OTP delivery).
There is no separate `users` table — login credentials live directly on
`Employee` (`username`, `phone`, `passwordHash`, plus reset-OTP fields),
since roles/branch already live there. **Login uses Username OR Phone +
Password — never email.** `Email` is still a field on `Employee` for other
contact-info purposes, but plays no role in authentication. Customers use
a separate mobile app and are **not** part of this login system.

`POST /login`, `POST /forgot-password`, and `POST /reset-password` are
public (no `Authorization` header needed — that's the point of them).
**Every other route in the API, including `GET /auth/me`, requires a valid
JWT** in the request header:
```
Authorization: Bearer <token>
```
Missing, malformed, unsigned, or expired tokens get `401` before the
request ever reaches a domain handler. A valid token additionally has to
pass a per-route `(role, resource, action)` permission check (see
"Permissions / RBAC model" below) — a role not allowed for that action
gets `403`.

An employee must have a `username` **or** `phone` (their login identifier)
plus a `password` set before they can log in — an Administrator sets these
by including `username`/`phone`/`password` in a `POST`/`PUT
/api/v1/employees` call (an existing employee with no password configured
yet gets `401 "this account has not been set up for login yet"` from
`POST /auth/login`). Both `username` and `phone` are unique across
employees (partial unique indexes — any number of employees may leave
either blank, but a non-blank value can't collide with another employee's).

Employee JSON (as embedded in `LoginResponse`/`GET /auth/me`) never
includes `passwordHash` or the reset-OTP fields — they're tagged `json:"-"`
on the `Employee` struct — but does include `username`/`email` (both
omitted when blank).

| Method | Path | Purpose | Body | Auth |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | Log in with username-or-phone + password, get back a JWT | `{ "identifier", "password" }` → `{ "token", "employee": {...} }` | Public |
| POST | `/api/v1/auth/forgot-password` | Request a password-reset SMS | `{ "phone" }` → `{ "message": "If that phone number is registered, a reset code has been sent by SMS." }` (always `200`, regardless of whether the phone exists — never reveals account existence) | Public |
| POST | `/api/v1/auth/reset-password` | Complete a password reset using the texted OTP | `{ "phone", "otp", "newPassword" }` (min 8 chars) → `{ "message": "Password has been reset. You can now log in." }` | Public |
| GET | `/api/v1/auth/me` | Get the calling employee's own record (id/role/branch/etc., from the token) | — → `Employee` JSON | Bearer token |

**Status codes:**
- `POST /auth/login` — `200` + `{ "token", "employee" }` on success; `401
  ErrInvalidCredentials` ("invalid username/phone or password") for a
  wrong identifier or password (deliberately the same message for both,
  so a login attempt never reveals whether an account exists); `401
  ErrAccountNotSetUp` if the employee row exists but has no password
  configured.
- `POST /auth/forgot-password` — always `200`; internally, an unknown
  phone number is silently swallowed (still `200`) and any real send/
  lookup error is logged server-side but still returns `200`, so
  responses never leak account existence via status/timing.
- `POST /auth/reset-password` — `200` on success; `400
  ErrInvalidOrExpiredToken` for an unknown phone, a wrong/already-used
  OTP, or an OTP past its 10-minute expiry, or if `newPassword` is under
  8 characters.
- `GET /auth/me` — `200` + `Employee` JSON; `401` if the token is
  missing/invalid (from `AuthMiddleware`, before the handler runs).

**Forgot/reset password flow (SMS OTP):** `ForgotPassword` looks up the
employee by `phone`, generates a random 6-digit numeric OTP, stores only
its SHA-256 hash (plus a 10-minute expiry) on the employee row, and texts
the **raw** code via `platform.SMSSender`. `ResetPassword` looks the
employee up again by `phone`, checks the given `otp` against the stored
hash (constant-time comparison) and that it hasn't expired, bcrypt-hashes
the new password (cost 14), and clears the reset fields so the OTP can't
be reused. `platform.SMSSender`'s sole implementation is `OpenWASender`,
which sends via a self-hosted OpenWA/WhatsApp instance (the earlier
`LogSMSSender` console-log stub has been removed now that OpenWA is wired
up everywhere). The reset-password page also locks its phone field to the
value carried from the "forgot password" step (read-only, not editable) so
a code requested for one number can't be resubmitted against a different
target phone.

**JWT details:** HS256, signed with `JWT_SECRET`. Claims: `employeeId`,
`role`, `branchId`, plus standard `iat`/`exp`. Expiry is controlled by the
`JWT_EXPIRY` env var — **currently configured to 3 days** (`JWT_EXPIRY=3d`
in `.env`; the value accepts either a `<n>d` shorthand or a normal Go
duration like `168h`, and falls back to 7 days if unset/unparseable).

## Customer App Authentication API (`/api/v1/customer/auth`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`;
`/auth/request-otp` returns its confirmation as a plain string under
`"message"`, not `{"message": "..."}`. Status classifications are unchanged
(invalid/expired OTP, too-many-attempts, invalid device token, missing
deviceId all stay 400; unregistered phone stays 404) — deliberately not
reclassified here given this is the login path.

Implemented in `backend/internal/customerauth/` plus `backend/internal/platform/`
(`IssueCustomerToken`/`ParseCustomerToken`, `CustomerAuthMiddleware`) —
sign-in for the customer mobile app (`customer-mobile/`), **completely
separate from the employee auth system above.** A customer JWT carries
`"type": "customer"` and is verified only by `CustomerAuthMiddleware`; an
employee JWT has no such claim and is rejected by it, and vice versa a
customer JWT is rejected by the employee `AuthMiddleware`. The two token
kinds are never interchangeable, and there is no shared "logged in" concept
between the staff web/mobile apps and the customer app.

Two sign-in mechanisms:
- **OTP over WhatsApp** — `request-otp` / `verify-otp`, always available;
  the only path for a customer's very first sign-in on any device. Delivered
  via the same `platform.OpenWASender`/OpenWA integration used for employee
  password-reset codes and reminders, and logged to `communication_logs`
  (`commlog.TriggerOTP`, `relatedEntityType: "customer"`) the same way.
- **Device-bound biometric login** — right after a successful `verify-otp`,
  the app calls `register-device`, which issues a long-lived, revocable
  device token (random 32 bytes, only its SHA-256 hash stored server-side).
  The app stores that raw token in `SecureStore`, releasing it for use only
  after a local `expo-local-authentication` biometric check succeeds. On a
  later cold start, a successful biometric check lets the app exchange the
  device token for a fresh session JWT via `device-login` — the server
  re-validates the token is real and not revoked, so this is a genuine
  server-side check, not just a client-side unlock. A device with no usable
  biometric hardware/enrollment simply never completes `register-device`;
  the customer is still signed in via the session token from `verify-otp`,
  and every later app open on that device falls back to the OTP screen.

| Method | Path | Purpose | Body | Auth |
|---|---|---|---|---|
| POST | `/api/v1/customer/auth/request-otp` | Send a 6-digit sign-in OTP via WhatsApp | `{ "phone" }` → `{ "message" }` | Public |
| POST | `/api/v1/customer/auth/verify-otp` | Exchange phone + OTP for a session JWT | `{ "phone", "code" }` → `{ "token", "customer": CustomerResponse }` | Public |
| POST | `/api/v1/customer/auth/device-login` | Exchange a stored device token (post-biometric) for a fresh session JWT | `{ "deviceToken" }` → `{ "token", "customer": CustomerResponse }` | Public |
| POST | `/api/v1/customer/auth/register-device` | Issue a new device token for this (customer, device) pair | `{ "deviceId" }` → `{ "deviceToken" }` | Bearer customer token |
| POST | `/api/v1/customer/auth/refresh` | Extend the current session | — → `{ "token" }` | Bearer customer token |

**Status codes:**
- `POST request-otp` — `200` on success; `404` with `"This phone number is
  not registered. Please contact your branch."` if no customer has that
  phone (deliberately explicit, unlike employee forgot-password — the
  customer app is a closed system tied to an existing loan-account
  relationship, so there's no account-existence ambiguity to protect here).
- `POST verify-otp` — `200` + `{ token, customer }`; `400
  ErrInvalidOrExpiredOTP` for an unknown phone, wrong code, or an OTP past
  its 5-minute expiry; `400 ErrTooManyAttempts` after 5 wrong tries against
  the same OTP (request a new one).
- `POST register-device` — `200` + `{ deviceToken }`; `400
  ErrDeviceIDRequired` if `deviceId` is blank; `401` if not authenticated.
  Any prior live device token for the same `(customerId, deviceId)` pair is
  revoked first.
- `POST device-login` — `200` + `{ token, customer }`; `400
  ErrInvalidDeviceToken` if the token is unknown or revoked.
- `POST refresh` — `200` + `{ token }`; `401` if the bearer token is
  missing/invalid/expired.

**Storage:** `customer_otp` (phone, SHA-256 code hash, expiry, attempt
count — one row per phone, overwritten on each new request) and
`customer_device_tokens` (customerId, deviceId, SHA-256 token hash,
createdAt/revokedAt/lastUsedAt), both `backend/internal/customerauth/model.go`,
migrated via `go run ./cmd/migrate` same as every other table (no
AutoMigrate on server boot).

**JWT details:** HS256, signed with the same `JWT_SECRET` as employee
tokens (there's only one configured secret for this server) but a distinct
claims shape — `customerId`, `type: "customer"`, plus standard `iat`/`exp`.
Session JWTs are short-lived (24h); the long-lived credential is the device
token, not the JWT itself.

## Customer App Gold Rate API (`/api/v1/customer/gold-rate`)
Thin, read-only customer-scoped mount of the existing `internal/goldrate`
handler (see the "Gold Rates API" section below for the underlying
model/behavior) — no new gold-rate logic, just a different route group
gated by `CustomerAuthMiddleware` instead of the employee permission system.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/v1/customer/gold-rate/latest` | Current published 24K rate | Bearer customer token |
| GET | `/api/v1/customer/gold-rate/history?limit=N` | Most recent `N` rates, newest first, `{ "items": [...], "hasMore": bool }` | Bearer customer token |

## Customer App Loan API (`/api/v1/customer/loans`)
Thin, ownership-checked customer-scoped mount of the existing
`internal/loan` service/repository (see the "Loans API" section below for
the underlying `Loan`/`Ornament`/`LoanRequest` model) — no duplicated
business logic, just a different route group gated by
`CustomerAuthMiddleware`, with `customerId` forced from the JWT rather than
trusted from the client, and **no `branchId` filter** (a customer's loans
may span branches). Implemented in
`backend/internal/loan/customer_handler.go`.

| Method | Path | Purpose | Body | Auth |
|---|---|---|---|---|
| GET | `/api/v1/customer/loans?status=&limit=&offset=` | List the caller's own loans, optionally filtered by `status`, paginated the same `{ "items": [...], "hasMore": bool }` shape as the staff list | — | Bearer customer token |
| GET | `/api/v1/customer/loans/:id` | One loan's full detail (ornaments, outstanding figures, etc. — same enriched `Loan` shape as the staff `GET /loans/:id`) | — | Bearer customer token |
| GET | `/api/v1/customer/loans/:id/requests` | Every Extension/Release request logged against this loan, newest first (not in the original batch plan — added so the Loan Detail screen's Requests card can show an already-pending request's stage on a fresh load, not only right after submitting one this session) | — → `LoanRequest[]` | Bearer customer token |
| POST | `/api/v1/customer/loans/:id/extension-request` | Ask to push the loan's due date out | `{ "months", "detail" }` → `LoanRequest` | Bearer customer token |
| POST | `/api/v1/customer/loans/:id/release-request` | Ask to close the loan and release the pledged gold | `{ "detail" }` → `LoanRequest` | Bearer customer token |
| POST | `/api/v1/customer/loans/:id/pay/create-order` | Opens a Razorpay order for a customer-chosen amount against this loan; validates the amount against the loan's computed outstanding figures for the given `type` (see below) | `{ "amount", "type": "Interest"\|"FullSettlement"\|"Partial" }` → `{ "orderId", "amount", "currency": "INR", "keyId" }` | Bearer customer token |
| POST | `/api/v1/customer/loans/:id/pay/verify` | Verifies the Razorpay checkout signature and, only on success, records the payment against the loan's existing ledger (`Method: "Online"`, `Reference: <razorpay_payment_id>`, `receivedByEmployeeId: null`) — same fee→penal→interest→principal waterfall a staff-recorded payment goes through | `{ "orderId", "paymentId", "signature", "amount", "type" }` → updated `Loan` (200), or `400` with no `LoanPayment` created on a signature mismatch | Bearer customer token |
| GET | `/api/v1/customer/loans/:id/payments` | This loan's payment ledger, newest first — backs the Loan Detail screen's payment history | — → `LoanPayment[]` | Bearer customer token |
| GET | `/api/v1/customer/loans/:id/statement` | Generates and serves (inline, `application/pdf`) a full statement for this loan — a summary header (loan number, customer name, principal, opened/due date, current outstanding) plus a table of every payment ever recorded against it. Added in batch 5 (Documents), reusing the same gofpdf pattern as the payment-receipt PDF (`renderPaymentReceiptPDF`) rather than a new PDF library. A loan with zero payments still returns a valid one-page PDF | — → `application/pdf` | Bearer customer token |

**Ownership check:** every route above first loads the loan and compares
`loan.customerId` against the JWT's `customerId`; a mismatch (or a
genuinely nonexistent id) both return a plain `404`, never `403` — the
response deliberately doesn't distinguish "not yours" from "doesn't exist"
so a customer can't probe for other customers' loan ids.

**`extension-request`/`release-request`** call the exact same
`Service.CreateExtensionRequest`/`CreateReleaseRequest` the staff app uses,
with `requestedBy` forced to `"Customer"` regardless of what the client
sends. Both requests start life on the staged approval chain described
below rather than any one-shot decision.

### Customer App Payments API (`/api/v1/customer/payments`)
Added in batch 3 (Razorpay Setup + Payments), alongside the per-loan
`pay/create-order`/`pay/verify`/`payments` routes above. Same
`CustomerAuthMiddleware` gating and `customerId`-forced-from-JWT convention.

| Method | Path | Purpose | Body | Auth |
|---|---|---|---|---|
| GET | `/api/v1/customer/payments?limit=&offset=` | Every payment across every loan belonging to the caller, newest first, paginated the same `{ "items": [...], "hasMore": bool }` shape as the loan list — backs the Payments tab's global history | — | Bearer customer token |
| GET | `/api/v1/customer/payments/:paymentId/receipt` | Generates and serves (inline, `Content-Type: application/pdf`) a one-page PDF receipt for one payment — loan number, customer name, payment date, amount, type, method, reference, running balance after the payment | — → `application/pdf` | Bearer customer token |

**Ownership check on the receipt route:** the payment's parent loan's
`customerId` is compared against the JWT's `customerId`; a mismatch (or a
nonexistent payment id) returns `404`, matching every other customer route's
"don't reveal it exists" convention.

**Razorpay order validation (`pay/create-order`):** the requested `amount`
must match one of three shapes for the given `type`, computed from the
loan's enriched fields:
- `Interest` — amount must exactly equal `outstandingInterest +
  outstandingPenalInterest`.
- `FullSettlement` — amount must exactly equal `settlementAmount`.
- `Partial` (or any other value) — amount must be `> 0` and `<=
  totalOutstandingBalance`.

A mismatch returns `400`. The `type` sent back into `pay/verify` should be
the same one used at order-creation time; it is passed straight through to
`RecordPayment`'s existing allocation waterfall, which decides where the
money actually goes (fee → penal interest → interest → principal) — the
Razorpay flow adds no new allocation logic of its own.

## Customer App Notifications API (`/api/v1/customer/notifications`, `/api/v1/customer/ws`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — the REST `List`/`Ack` responses wrap as `{"success": true, "data":
...}`; `Ack` returns `200` with a confirmation message instead of `204 No
Content`. **The WebSocket wire format is unaffected** — the JSON pushed down
the live socket connection (`wireMessage`, documented below) is not an HTTP
response and carries no envelope; only the pre-upgrade 401 (unauthenticated)
and the REST endpoints follow the envelope.

Realtime, ack-tracked in-app notifications — backed by a durable
`notifications` table (`internal/notification`), delivered live over a
WebSocket while the app is connected (`internal/realtime`'s connection
registry). **This is not true background push** (no FCM/APNs) — a
WebSocket only delivers while the socket is open; the database is the
source of truth and the socket is a live-delivery accelerator on top of it,
an explicit, agreed tradeoff to avoid a Firebase dependency.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/v1/customer/notifications?limit=&offset=` | Paginated history, newest first, `{ "items": [...], "hasMore": bool }` — the bell list's cold-start backfill | Bearer customer token |
| POST | `/api/v1/customer/notifications/:id/ack` | REST fallback ack, for a notification the app only ever saw via the list above (not a live push) | Bearer customer token |
| POST | `/api/v1/customer/notifications/:id/read` | Marks a notification read — fired when the customer opens it in the app (the notification detail view); this is the actual unread/read state, distinct from `Ack`/`Delivered` | Bearer customer token |
| GET | `/api/v1/customer/ws` | WebSocket upgrade — the live-push channel | Bearer customer token (same `CustomerAuthMiddleware` gate; gin processes the upgrade request as a normal HTTP request right up until the connection is hijacked) |

**Wire messages** — server → client, pushed per notification:
```json
{ "type": "notification", "id": 1, "notifType": "LoanSanctioned", "title": "Loan Sanctioned", "body": "...", "relatedEntityType": "loan", "relatedEntityId": 42, "createdAt": "2026-01-01T12:00:00Z" }
```
Client → server, the *only* inbound message shape — this is the delivery
acknowledgement:
```json
{ "type": "ack", "notificationId": 1 }
```

**Delivery/resend semantics**: `Delivered` flips true only once the client
sends the `ack` above (over the socket, or via the REST fallback) — not
merely "the server attempted a push." Undelivered notifications are
retried every 10 minutes, up to 10 attempts (`notification.Service.
ResendPending`, driven by a `time.Ticker` in `main.go` — the first
scheduled/background job in this codebase). After 10 attempts the retry
loop stops, but the row is never deleted — it stays visible via the list
endpoint. On every new WS connection, any of that customer's undelivered
notifications are pushed immediately (`PushUndeliveredOnConnect`), without
waiting for the next tick.

**Event coverage**: loan submission, every sanction-chain stage (approved/
rejected, not just final), loan sanction (final disbursement), every
payment recorded, loan due-soon and overdue (a new hourly scheduled check,
`loan.Service.CheckDueAndOverdueLoans` — the one genuinely new notification
*trigger*; every other event reuses the existing `notifyCustomer` call
sites), every Extension/Release request stage decision, and every auction
stage transition. All of this is wired through `internal/loan/service.go`'s
existing `notifyCustomer` helper, extended to fire an in-app notification
independently of whether WhatsApp is configured (previously, an
unconfigured WhatsApp client silently skipped the WhatsApp send AND the
commlog write — now the in-app half always fires regardless).
`loan.CustomerNotifier` is the narrow interface `internal/loan` calls
through (same cross-package-dependency convention as `PacketCreator`/
`CashRecorder`), implemented by `notification.Service` and injected from
`main.go`.

**Read state**: `Notification.read`/`readAt` are the actual unread/read
signal shown in the customer app (a gold dot on unread rows, cleared by
tapping into the notification's detail view, which calls `POST .../:id/read`).
This is server-persisted, ownership-checked the same way as `Ack`, and is
the sole source of truth — the customer app no longer derives unread state
from a client-side watermark (that reset to "everything unread" on every
app restart/re-login, since it lived only in on-device storage with nothing
to reconstruct it from).

**Bug fix note**: while wiring this, a pre-existing bug in
`resolveAuctionAfterPayment` was fixed — its "payment received, auction on
hold" WhatsApp message used to fire on **every non-closing payment on any
loan**, not just loans with an active auction case, because the guard
checked `l.Status != StatusClosed` without also checking whether an active
auction record was actually found. It's now correctly gated on both.

### `LoanPayment.receivedByEmployeeId` is now nullable
Previously required (`NOT NULL`) and always populated from the acting
employee's JWT on every staff-recorded payment. As of batch 3 it is a
nullable `uint` (`*uint` in Go) — a customer-initiated Razorpay payment has
no employee actor, so it is recorded as `null` rather than a fabricated
"system" employee id. Every staff-facing payment endpoint is unaffected:
`POST /api/v1/loans/:id/payments` still always sets it from the
authenticated employee. Migrated via `cmd/migrate`, which now runs an
explicit `ALTER TABLE loan_payments ALTER COLUMN received_by_employee_id
DROP NOT NULL` after `AutoMigrate` (GORM's `AutoMigrate` does not reliably
relax an existing `NOT NULL` constraint on Postgres on its own).

## Customer App Profile & KYC API (`/api/v1/customer/profile`)
Added in batch 4. Unlike the loan/payment routes above (a customer owns
*many* loans, so `:id` needs an ownership check), a customer has exactly
**one** `Customer` row and its ID *is* `customerId` from the JWT — so none
of these routes take an `:id` at all. All four wrap the existing staff-side
`internal/customer.Service` methods unmodified (`Get`/`VerifyPAN`/
`StartAadhaarVerify`/`CheckAadhaarVerify` — same Setu PAN-verify and
DigiLocker Aadhaar-verify logic documented in the "Customer Module" section
below), called with `branchID=nil` instead of a staff actor's branch scope.
Implemented in `backend/internal/customer/customer_mobile_handler.go`.

| Method | Path | Purpose | Body | Auth |
|---|---|---|---|---|
| GET | `/api/v1/customer/profile` | The caller's own full profile (`CustomerResponse` shape — no raw Aadhaar/internal fields) | — → `CustomerResponse` | Bearer customer token |
| POST | `/api/v1/customer/profile/verify-pan` | Triggers a live Setu PAN-verify for the caller's on-file PAN and persists the result | — → `{ "customer", "message", "matchedName", "traceId" }` | Bearer customer token |
| POST | `/api/v1/customer/profile/aadhaar/start` | Begins a DigiLocker Aadhaar-verify request; `redirectUrl` is the app's own deep link (e.g. `ambikacustomer://aadhaar-callback`) that DigiLocker redirects back to once the customer finishes logging in | `{ "redirectUrl" }` → `{ "id", "url", "status", "validUpto" }` | Bearer customer token |
| GET | `/api/v1/customer/profile/aadhaar/status` | Polled after the DigiLocker browser flow returns; `{ "status": "unauthenticated" }` while still pending, or `{ "customer", "status": "authenticated", "matchedName", "dob" }` once done | — | Bearer customer token |

This batch is **fully view-only** otherwise — no endpoint lets a customer
edit their own name/PAN/Aadhaar/address/nominee/DOB/photo; editing remains
staff-only via the existing `PUT /api/v1/customers/:id`. The Aadhaar
**eSign** flow (`internal/platform/setu_esign.go`, used for indemnity
bonds) is a separate Setu product, not touched by this KYC verification
flow.

### Extension request approval chain (Loan Officer → Branch Manager → Management)
Extension requests used to be decided in one step
(`PUT /loans/requests/:requestId/decide`). They now go through the same
kind of fixed, audited, role-gated chain Release requests already used —
`LoanRequest.ApprovalStage` + one `RequestApproval` row per decision — just
with an extra checkpoint in front:

```
PendingLoanOfficer → PendingBranchManager → PendingManagement → Approved
                                    ↘ (Rejected at any stage) → Rejected
```

- `POST /api/v1/loans/requests/:requestId/approve` (staff-only, existing
  route — **generalized**, not new) now dispatches on `req.Type`:
  `Extension` → `Service.ApproveExtensionRequest`, `Release` →
  `Service.ApproveReleaseRequest` (unchanged). Body:
  `{ "stage": "LoanOfficer"|"BranchManager"|"Management", "action": "Approved"|"Rejected", "remarks" }`.
  `stage` must match the request's current `approvalStage`, or `400
  ErrWrongStage`. The actor's role must match the stage's required role
  (`Loan Operator`/`Branch Manager`/`Management` — reusing
  `employee.ValidRoles`' exact role strings, not a separate "Loan Officer"
  role), except `"Administrator"`, which may act at any pending stage — the
  same bypass rule the loan sanction chain and Release chain already use.
  A `Rejected` action at any stage terminates the request (`Status ->
  "Rejected"`) without touching the loan. The final `Approved` action (the
  `Management` stage) pushes the loan's `dueDate` out by the originally
  requested months, exactly like the old `DecideRequest` did — blocked with
  `400 ErrLoanTerminalState` if the loan is already Closed/Auctioned/Defaulted.
- `PUT /loans/requests/:requestId/decide` (the old single-step path) now
  **always returns `400 ErrUseStagedExtensionApproval`** for an Extension
  request, pointing callers at the staged endpoint above. Release requests
  already never used this path (`400 ErrNotExtensionRequest`, unchanged).
- **Staff-side approval UI**: `frontend/components/Requests.tsx`'s "Review"
  button now opens `ExtensionReviewModal.tsx` (Extension) or
  `ReleaseReviewModal.tsx` (Release) — both drive their respective chain
  through the same `POST /loans/requests/:requestId/approve` endpoint
  (`frontend/lib/loansApi.ts`'s `approveExtensionRequest`/
  `approveReleaseRequest`). The Extension modal shows the 3-stage
  `StageTracker` and role-gates the Approve/Reject buttons client-side
  (`useAuth()`'s `role`, Administrator bypass) to match the server-side role
  check; Release has no server-side role gate (any actor with `loans:update`
  can approve any stage), so its modal doesn't role-gate either — a
  pre-existing asymmetry between the two chains, not something this fixed.

### Permissions / RBAC model
Authorization is a `(role, resource, action)` → `allowed` table in
Postgres (`permissions` table, `internal/authz.Permission`), not a
hardcoded role list in Go code:
- `Role` — one of the 9 staff roles (below).
- `Resource` — a module key: `banks`, `branches`, `cash`, `customers`,
  `employees`, `goldrates`, `loans`, `lockers`, `ornamenttypes`, `packets`,
  `schemes`, `settings`, `uploads`, `kyc-documents`, `reports`.
- `Action` — CRUD-grain: `create`, `read`, `update`, `delete` (GET→`read`,
  POST→`create`, PUT/PATCH→`update`, DELETE→`delete`).
- `Allowed` — boolean.

On every startup, `SeedDefaults` idempotently inserts one row per
(role × resource × action) combination with `Allowed=true` for all 9
roles/all resources, if the row doesn't already exist (existing rows —
e.g. ones a future admin screen has already edited — are never
overwritten). **Every role can currently do everything** — this is a
deliberate "wide open" starting state; each protected route is wrapped in
`platform.RequirePermission(resource, action)`, which looks up the calling
role's row and returns `403` if it's missing or `Allowed=false`, so
restricting a role later is a matter of flipping rows in the `permissions`
table (via a future admin UI), **not a code change or redeploy**.

`kyc-documents` is seeded as its own resource even though it has no
dedicated routes yet (KYC document URLs currently flow through the
generic Customers/Uploads endpoints) — so KYC access can be tightened
independently of general Customer access once that admin UI exists.

**"branches" is the one resource seeded restricted, not allow-all**: its
`create`/`update`/`delete` actions are granted to `Administrator` only
(`authz.Repository.RestrictResourceToRole`, called once at startup after
the generic `SeedDefaults` pass) — every other role is `Allowed=false` for
those three actions and gets `403` from Branch Management writes. `read`
stays open to every role, since every branch-selector dropdown across the
app (Employee/Customer/Scheme/Loan create forms, etc.) needs the branch
list even for non-admins who can't manage branches themselves.

**`Cashier` has one narrower override**: `(Cashier, loans, create)` is set
to `Allowed=false` via `authz.Repository.SetPermission` (a single-action
override, unlike `RestrictResourceToRole`'s whole-resource lockout) —
Cashier is outside the loan creation/approval flow and gets `403` from
`POST /loans`, while every other action on `loans` (and every other
resource) stays whatever `SeedDefaults` set it to. The frontend hides the
"New Loan"/"New Gold Loan" nav item and buttons for this role and
gate-checks `NewLoan.tsx` itself as a catch-all, but the `403` above is the
real enforcement point.

**`reports` is the other resource seeded restricted, not allow-all**: like
`branches`, it's locked down via `authz.Repository.RestrictResourceToRoles`
right after `SeedDefaults` — only `Administrator`, `Management`,
`Branch Manager`, and `Auditor` get `Allowed=true` on `reports`; every other
role is `403`. Routes under `/api/v1/reports` are additionally double-gated
with `platform.RequireAnyRole("Administrator", "Management",
"Branch Manager", "Auditor")` stacked ahead of `CRUDPermissions(authzRepo,
"reports").Read` (mirroring the existing auction routes' double-gate
pattern), so both checks must pass. The frontend hides the "Reports" nav
item for any other role (`Sidebar.tsx`'s `canViewReports`) rather than
letting them hit the 403.

### Permission catalogue — create/update/delete split (2026-08)
> Note: the "Permissions / RBAC model" section above describes an older
> `(role, resource, action)` design. The permission model actually
> implemented today is `internal/authz`'s `roles` / `permissions` /
> `role_permissions` schema (`can view/create/update/delete <noun>`-style
> named permissions, one row per role × permission, seeded and back-filled
> by `internal/migrate` from `authz.Catalogue`) — see `internal/authz/
> catalogue.go`, `model.go`, `repository.go` and `platform/middleware.go`'s
> `CRUDPermissions`. This subsection documents the latest change to that
> catalogue; treat it, not the stale section above, as current.

Every module's `"can change <noun>"` permission has been split into three
granular permissions — `"can create <noun>"`, `"can update <noun>"`, and
`"can delete <noun>"` — for every module **except** Report Management
(read-only) and Role Management (which already had its own granular
create/update/delete/permission-change permissions). This is a deliberate,
explicit deviation from the house role-permission standard's §2.1 default
of one shared view/change pair per module.

`"can view <noun>"` is **unchanged** for every module — reads still gate on
the same single view permission they always did.

**Removal of `"can change ..."` (2026-08-28).** The blanket change
permission is now gone entirely: it is no longer in `authz.Catalogue`, and
`authz.Repository.PurgeLegacyChangePermissions` (called from
`internal/migrate.Run`, immediately after `BackfillCRUDSplitGrants` and
before `BackfillGrants`) deletes every `permissions` row whose name starts
with `"can change "` along with its `role_permissions` rows. No access is
lost on the boot that runs it, because the grants are copied forward first:

* `"can change <noun>"` → `create`/`update`/`delete <noun>`, by the
  back-fill step described below;
* `"can change role permission"` → `"can update role"`, inside the purge
  itself — that permission had no CRUD trio to split into, so editing a
  role's grants (`PATCH /employees/:id/permissions/:role_id` and
  `.../set-all`) now gates on `"can update role"`.

`authz.Restrictions` correspondingly replaced its single
`{"can change branch" → Administrator}` row with the same
Administrator-only rule spelled out for `can create/update/delete branch`.
The step is idempotent — an already-purged database has nothing left to
match.

| Module (`module_name`) | Unchanged | New (this change) |
|---|---|---|
| Branch Management | `can view branch` | `can create branch`, `can update branch`, `can delete branch` |
| Scheme Management | `can view scheme` | `can create scheme`, `can update scheme`, `can delete scheme` |
| Gold Rate Management | `can view gold rate` | `can create gold rate`, `can update gold rate`, `can delete gold rate` |
| Purity Standard Management | `can view purity standard` | `can create purity standard`, `can update purity standard`, `can delete purity standard` |
| Employee Management | `can view employee` | `can create employee`, `can update employee`, `can delete employee` |
| Cash Management | `can view cash` | `can create cash`, `can update cash`, `can delete cash` |
| Settings Management | `can view setting` | `can create setting`, `can update setting`, `can delete setting` |
| Customer Management | `can view customer` | `can create customer`, `can update customer`, `can delete customer` |
| Loan Management | `can view loan` | `can create loan`, `can update loan`, `can delete loan` |
| Bank Pledge Management | `can view bank pledge` | `can create bank pledge`, `can update bank pledge`, `can delete bank pledge` |
| Upload Management | `can view upload` | `can create upload`, `can update upload`, `can delete upload` |
| Ornament Type Management | `can view ornament type` | `can create ornament type`, `can update ornament type`, `can delete ornament type` |
| Bank Management | `can view bank` | `can create bank`, `can update bank`, `can delete bank` |
| Locker Management | `can view locker` | `can create locker`, `can update locker`, `can delete locker` |
| Packet Management | `can view packet` | `can create packet`, `can update packet`, `can delete packet` |
| Reminder Management | `can view reminder` | `can create reminder`, `can update reminder`, `can delete reminder` |
| Report Management | `can view report` | *(none — read-only, not split)* |

Frontend keys are the standard's usual space-for-underscore derivation,
e.g. `permissions["Employee_Management"]["can_create_employee"]`,
`permissions["Loan_Management"]["can_update_loan"]`.

**Backend wiring** (`platform.CRUDPermissions`): `Read` still gates on
`"can view <noun>"`; `Create`/`Update`/`Delete` now each gate on their own
distinct permission instead of all three sharing `"can change <noun>"`.
Every resource's `routes.go` picks this up automatically since none of them
call `RequirePermission` directly for plain CRUD verbs — loan's route file
keeps its other, already-granular named permissions (e.g. the
auction/bank-pledge sub-routes' own permission pairs) unchanged; those were
never part of this split.

**Migration/backfill** (`internal/migrate.Run`, via
`authz.Repository.BackfillCRUDSplitGrants`): for every existing role, each
new `"can create/update/delete <noun>"` grant is copied from that role's
existing `"can change <noun>"` grant (`TRUE` if the role currently holds
`"can change <noun>"`, `FALSE` otherwise) rather than defaulting to `TRUE`
— idempotent (skips any role+permission pair that already has a
`role_permissions` row) and runs in one transaction, before the generic
`BackfillGrants` step so the latter never overwrites the copied value. It
still runs even though `"can change <noun>"` has left the catalogue: an
existing database keeps those rows until the purge step above deletes them,
and the copy-forward has to happen first.

**Frontend gating (2026-08-28).** Every action control in the admin app is
now hidden — not disabled — when the signed-in role lacks the permission
behind it, using the same `can(module, key)` lookup the nav filter and
route guard already use (`common/auth-context.tsx`). Creates gate on
`can_create_*`, edits/approvals/status moves on `can_update_*`, deletes on
`can_delete_*`; read-only controls (search, filters, pagination, print and
export) are never gated. Where a screen already had a role-based check —
the loan sanction chain, extension-request stages, bank-pledge void, the
auction escalation decision — the permission is required *in addition* to
that role, not instead of it. Notable per-screen mappings: the Requests
page labels its row button "View" instead of "Review" without
`can_update_loan` and opens the review modals read-only; bank re-pledging
uses `Bank_Pledge_Management` (and `Bank_Management` for "Add Bank")
rather than the loan permissions; lockers use `Locker_Management`, packet
movements `can_update_packet`; New Gold Loan (nav item and route) gates on
`can_create_loan`, which replaces the retired `can_change_loan` key.

### Branch scoping (row-level, on top of the RBAC table above)
Independently of the `(role, resource, action)` table above, every
branch-owned domain is also scoped to the calling employee's own branch at
the *row* level: a non-`Administrator` employee's list/get/create/update/
delete calls are transparently confined to their own `branchId` (from the
JWT), while `Administrator` sees and acts on every branch. This is
enforced in `backend/internal/platform/branch_scope.go`:
- `GetBranchScope(c)` → `nil` for `Administrator` (no filter), else a
  pointer to the caller's own `branchId`; threaded into every domain's
  `List`/`Get` as an optional `WHERE branch_id = ?` (or, for domains with
  no own `branch_id` column, a `JOIN` to the owning record's branch).
- `EnforceBranchOnWrite(c, submittedBranchID)` → passes an
  Administrator's submitted `branchId` through unchanged, but silently
  overrides anyone else's to their own `branchId` — a non-admin can never
  persist a record under another branch, even by tampering with the
  request body.
- A non-admin fetching another branch's specific record by id (`GET
  /employees/:id`, a loan's `/loans/:id/auction`, etc.) gets the same
  `404 Not Found` as a genuinely missing id — branch existence is never
  leaked via a `403`.

Branch-owned domains covered: Employees, Customers, Loans (including its
Extension/Release request, Bank Repledge, and Auction sub-workflows, all
scoped via the parent Loan's `branchId`), Lockers, Cash Movements/Expenses,
Packets (scoped via their Loan's `branchId`), Reminders (scoped via their
Customer's `branchId`, including the live-derived due-date/overdue/
interest-anniversary calendar events), and Schemes (see below). Banks,
Gold Rates, Ornament Types, and Settings are global catalogs with no
`branchId` and are **not** row-scoped.

**Auction routes carry an extra role allowlist on top of CRUD permissions.**
`platform.RequireAnyRole(roles ...string)` restricts a route to named roles
independently of the permissions table, and every `/loans/:id/auction*` route
uses it with `Administrator`, `Management`, `Branch Manager`,
`Auction Administrator`. Both middlewares apply — the role must be allowlisted
AND hold the `loans` CRUD permission.

This exists because the permissions table is resource-grained, and `"loans"`
covers payments, ornaments, approvals and bank pledges as well as auctions
(see the comment in `internal/loan/routes.go`). A Cashier or Loan Operator
legitimately needs `loans:update` to take payments — but deciding whether a
customer permanently loses their pledged gold is a different authority. The
guard is therefore attached per-route, not to the whole group: a group-level
one would strip Cashier access to payments.

Where authority differs *within* the auction workflow it is enforced in the
service layer instead, because a route guard is too coarse: an Auction
Administrator may resolve a part-payment decision but must NOT decide a
post-auction shortfall write-off (403 `ErrShortfallAuthorityRequired`), even
though it passes the route guard. `PUT /:id/bank-pledge/:pledgeId/void` is
similarly restricted to `Administrator`/`Management`/`Branch Manager`.

**Schemes are now branch-owned** (previously a global catalog usable by
any branch): `Scheme.branchId` is a required FK, validated the same way as
Employee's `branchId`. Existing rows were backfilled to branch `1` (see
`cmd/migrate`'s `backfillSchemeBranch`).

**The 9 roles** (final list — `Auction Admin` was renamed to `Auction
Administrator` to match this list; keep `employee.ValidRoles`,
`main.go`'s `staffRoles`, and `frontend/components/modals/
EmployeeModal.tsx`'s `ROLES` constant in sync manually):
Administrator, Management, Branch Manager, Loan Operator, Cashier,
Accountant, Collection Staff, Auction Administrator, Auditor.

### Required environment variables
In addition to the DB/frontend/encryption vars already documented
elsewhere, auth requires:

| Var | Purpose |
|---|---|
| `JWT_SECRET` | Signs/verifies login JWTs. No safe default — falls back to a fixed, publicly-known dev-only secret (with a loud warning) if unset; set a real value in production. |
| `JWT_EXPIRY` | Login token lifetime, e.g. `3d` or `168h`. Falls back to `168h` (7 days) if unset/unparseable. |

No SMS-gateway env vars exist — `platform.OpenWASender` (the sole
`SMSSender` implementation) reads its config (OpenWA base URL, API key,
sessionId) from the `internal/settings` WhatsApp category via the Settings
page, encrypted at rest, refetched on every send so an admin editing it
takes effect with no restart.

The `SMTP_*` env vars (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/
`SMTP_FROM`) and `platform.Mailer` still exist in the codebase but are no
longer used by auth (password reset is SMS-only now) — they're dead
config until some other feature needs outgoing email.

## Branches API (`/api/v1/branches`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — every response below is wrapped as `{"success": true, "data": ...}`
or `{"success": false, "error": "..."}`; the JSON shapes below describe the
`data` payload, not the top-level response.

Implemented in `backend/internal/branch/`. Requires a valid JWT
(`Authorization: Bearer <token>`) plus `RequirePermission("branches", ...)`
— see the Authentication section above. Unlike every other resource,
`create`/`update`/`delete` here are restricted to the `Administrator` role
only (`read` stays open to all roles) — see "branches is the one resource
seeded restricted" above. Every other branch-owned domain (Employees,
Customers, Loans, Lockers, Cash Movements/Expenses, Packets, Reminders,
Schemes — see "Branch scoping" above) links to a branch via `branchId`.

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
"deactivate"), and is rejected with **409** if the branch still has any
linked employees, expenses, or cash movements, or if `name` collides with
an existing branch (both are `Conflict` per the envelope's status
classification — see `backend/internal/branch/service.go`).

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/branches` | Create a new branch | `{ "name", "code"?, "address", "phone"? }` |
| GET | `/api/v1/branches` | List all branches (active and inactive) | — |
| GET | `/api/v1/branches/:id` | Get one branch by id | — |
| PUT | `/api/v1/branches/:id` | Update a branch (incl. `isActive`) | full branch fields |
| DELETE | `/api/v1/branches/:id` | Deactivate a branch (soft-disable; 400 if still referenced) | — |

## Settings — Integration API Keys API (`/api/v1/settings/api-keys`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`;
`DELETE` returns `{"success": true, "message": "Setting cleared successfully"}`
instead of `204 No Content`. An unknown category returns **404**.

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
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}` (the
`/schemes/active` paginated `{items, hasMore}` shape sits under `data`);
`DELETE` returns `{"success": true, "message": "Scheme deleted successfully"}`
instead of `204 No Content`.

Implemented in `backend/internal/scheme/`. No authentication/RBAC yet
(tracked as a follow-up per [architecture.md](architecture.md)).

Scheme JSON shape:
```json
{
  "id": 1,
  "code": "SCH-01",
  "name": "Swarna Classic",
  "interestRate": 12,
  "durationMonths": 12,
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
create/update. `durationMonths` is the scheme's fixed tenure (must be
`> 0`, 400 `ErrInvalidDuration` otherwise) — every loan opened under this
scheme runs for that many months from its own `openedDate` (see
`POST /api/v1/loans` below); a scheme has no date window of its own
anymore (previously `startDate`/`endDate` doubled as both an "offer
validity window" and, on the frontend, a laundered stand-in for this same
duration — that indirection is gone). `isActive` is a plain toggle with no
date-window restriction.

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
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}` (the
paginated list's `{items, hasMore}` shape sits under `data`). This is the
first customer-facing migrated module: `/api/v1/customer/gold-rate/latest`
and `/history` reuse `goldrate.Handler.Latest`/`List` verbatim, so the
customer app's `getLatest`/`getHistory` (`customer-mobile/src/api/goldRate.ts`)
already unwrap the same envelope.

Implemented in `backend/internal/goldrate/`. No authentication/RBAC yet.
Every publish ("Set Today's Rate") is a new append-only row — there is no
separate "current rate" record to update; the most recent row (by
`date`/`id`) is the current rate. This collapses the frontend mock's
separate `rates` + `rateHistory` shapes into one history table.

**Only the 24K benchmark is published.** Every other purity is resolved
per-ornament, at pledge/re-test time, as `K24 × (karat/24)` or
`K24 × (fineness%/100)` — see the Loans API's Ornament purity note below
and `internal/loan/purity.go`. `GoldRate` previously also carried
independently staff-entered `k22`/`k18` columns; those were renamed to
`legacy_k22`/`legacy_k18` (preserved read-only for historical reference,
no longer part of the live API — see `goldrate.MigrateLegacyColumns`).

GoldRate JSON shape:
```json
{
  "id": 1,
  "date": "2026-08-07T00:00:00Z",
  "k24": 7285,
  "setBy": "Rajesh Menon",
  "createdAt": "..."
}
```
`date` accepts `YYYY-MM-DD` on create; omit it to default to today.
`k24` must be `> 0`; `setBy` is required.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/gold-rates` | Publish a new rate (creates a history row) | `{ "k24", "setBy", "date"? }` |
| GET | `/api/v1/gold-rates` | List full rate history, newest first | — |
| GET | `/api/v1/gold-rates/latest` | Get the current (most recently published) rate | — |
| GET | `/api/v1/gold-rates/:id` | Get one rate entry by id | — |

## Purity Standards API (`/api/v1/purity-standards`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`.

Implemented in `backend/internal/puritystandard/`. A small suggestion-only
reference-data resource — like `banks`/`ornamenttypes`, a lookup list with
a find-or-create endpoint — powering the karat/fineness% typeahead
(`PurityPicker.tsx`) shown wherever an ornament's purity is entered.
**Nothing else FKs into this table**: `Ornament.Purity`/
`OrnamentPurityTest.TestedPurity` store a plain unit-suffixed string
(`"22K"` / `"91.6%"`) computed at entry time, not a `PurityStandardID` —
editing/removing a row here can never reinterpret a historical ornament's
already-computed `GoldValue`. Seeded at migration time with every whole
karat from 24K down to 10K.

PurityStandard JSON shape:
```json
{ "id": 3, "karat": 22, "finenessPercent": 91.7, "label": "22K (91.7%)", "isActive": true, "createdAt": "...", "updatedAt": "..." }
```
`karat` must be `10-24`; `finenessPercent` must be `> 0` and `<= 100`. At
least one of the two is required on create.

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET | `/api/v1/purity-standards?q=` | Search/list active purity standards | — |
| POST | `/api/v1/purity-standards` | Find-or-create by karat or finenessPercent | `{ "karat"? , "finenessPercent"?, "label"? }` |

## Employees API (`/api/v1/employees`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}` (the
paginated list's `{items, hasMore}` shape now sits under `data`); `DELETE`
returns `{"success": true, "message": "Employee deleted successfully"}`
instead of `204 No Content`. Phone/username/email conflicts return **409**;
an unclassified server error returns a generic 400 message (never 500) with
the real error logged server-side.

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
  "username": "rajesh.menon",
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
  `Collection Staff`, `Auction Administrator`, `Auditor`. This list mirrors
  the `ROLES` constant in `frontend/components/modals/EmployeeModal.tsx`
  and `main.go`'s `staffRoles` (used to seed the `permissions` table, see
  the Authentication section above) — keep all three in sync manually,
  there is no shared codegen. Submitting a role outside this list returns
  `400` with `ErrInvalidRole` ("role must be one of the predefined roles").
- `username`/`password` are optional on both create and update, and
  enable login for this employee (see the Authentication section above —
  login accepts `username` OR `phone`, never `email`) — `username` must be
  unique among employees that have one set (`^[A-Za-z0-9._-]{3,60}$`,
  `400 ErrUsernameInvalid` otherwise, `409 ErrUsernameTaken` if already in
  use); `password`, if given, must be at least 8 characters
  (`400 ErrPasswordTooShort`) and is bcrypt-hashed server-side, never
  returned by any endpoint (`passwordHash` is `json:"-"`). `email` is
  still accepted/stored (optional, unique) for other contact-info
  purposes but is no longer usable for login.
- `phone`, if provided, must match `^\d{10}$` (exactly 10 digits) — the
  same convention used by the Branches API's phone field (`400
  ErrPhoneInvalid` otherwise) — and must be unique among employees that
  have one set (`409 ErrPhoneTaken` otherwise), since it doubles as a
  login identifier. It stays optional; validation only runs when a value
  is supplied.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/employees` | Create a new employee (optionally with login credentials right away) | `{ "name", "role", "branchId", "phone"?, "username"?, "password"? }` |
| GET | `/api/v1/employees` | List all employees | — |
| GET | `/api/v1/employees/:id` | Get one employee by id | — |
| PUT | `/api/v1/employees/:id` | Update an employee (incl. performance counters — the frontend now round-trips the current counter values so they aren't reset to 0 on every edit) — omit `password` to leave it unchanged | full employee fields + `"username"?, "email"?, "password"?` |
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
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`. An
expense already approved/rejected returns **409 Conflict** on a second
Approve/Reject (previously 400). The `/uploads` receipt-image endpoint this
page also calls is **not yet migrated** — see the Uploads API section.

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

**System-generated `source` values.** Beyond the two a user can pick, the loan
workflows set `source` themselves via `loan.CashRecorder`: `"Bank"`
(bank-pledge cash-in), `"Collection"` (customer repayment), and `"Auction"`
(net proceeds realised from auctioning pledged gold). `SumBreakdownByDate`
buckets each of these separately — `auctions` was added as its own bucket rather
than letting it fall into `topUps`, since auction proceeds are neither a
customer payment nor cash staff added, and misfiling them would overstate
manual top-ups. Cash-out purposes are bucketed by prefix the same way, with
`"Auction surplus refunded…"` kept out of `withdrawals` so money owed back to a
customer is not reported as the branch taking cash for itself.

> **Known technical debt — money precision.** Every monetary field across
> `loan`/`cash`/`expense`/`packet` is a Go `float64`, which cannot represent most
> decimal fractions exactly (`0.1 + 0.2` → `0.30000000000000004`). Left
> unchecked these artifacts accumulate through the payment-allocation waterfall
> and leave fractions of a paisa clinging to balances that should read as
> settled, so a fully-repaid loan can sit permanently a hair short of closed.
>
> Current mitigation: `platform.RoundMoney` (2dp, half-away-from-zero) is applied
> at every write of a computed money value in the auction/re-pledge flows, new
> money columns are `NUMERIC(16,2)`, and zero-balance tests use a `0.01` epsilon
> rather than exact equality. The real fix — fixed-point decimals
> (`shopspring/decimal` over `NUMERIC(16,2)`) across all four packages — is a
> repo-wide refactor deliberately kept out of that change's blast radius, and
> remains outstanding.

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
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}` (the
paginated `{items, hasMore}` shape sits under `data`); `DELETE` returns
`{"success": true, "message": "Customer deleted successfully"}` instead of
`204 No Content`. PAN/Aadhaar verification's "not configured" errors
(`ErrSetuNotConfigured`/`ErrDigilockerNotConfigured`) now return **503
Service Unavailable** (previously the same). This same `Handler`/`Service`
backs the customer app's `/customer/profile/*` routes
(`customer_mobile_handler.go`) — those are migrated together with this
section, and `customer-mobile/src/api/profile.ts` has been updated to match.

Implemented in `backend/internal/customer/`. No authentication/RBAC yet —
admin-only by convention. The consolidated Customer Module: personal/KYC
details, PAN/Aadhaar, identity/address/KYC-document uploads, and nominee
info. **Verification status**: `kycStatus`/`panStatus`/`aadhaarStatus`
start `"Pending"` at creation (see the model-level comment in
`backend/internal/customer/model.go`) and are only advanced by the real
Setu PAN-verify and DigiLocker Aadhaar endpoints; `kycStatus` is derived
from the other two and reaches `"Verified"` only when both have passed.
Loan/ornament/payment/auction history for a
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
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`.

Implemented in `backend/internal/bank/` — a small reference-data resource
for the external banks staff can pick from when re-pledging a loan's gold
(`RepledgeModalContent`'s "Bank" field, opened either from a loan's own
detail page or from the "+ New Re-Pledge" button on the Bank Re-Pledge
page), plus a dedicated "+ Add Bank" button on that same page
(`BankModalContent`) for registering a bank's full details up front — a
bank must be registered here (with branch/IFSC/account number) before it
can be re-pledged against; the repledge picker cannot create one inline.
Mirrors Ornament Types' find-or-create pattern below. No
authentication/RBAC yet.

```json
{
  "id": 1,
  "name": "State Bank of India",
  "branch": "MG Road",
  "ifsc": "SBIN0001234",
  "accountNo": "3021145678901",
  "phone": "9876543210",
  "createdAt": "2026-08-10T00:00:00Z",
  "updatedAt": "2026-08-10T00:00:00Z"
}
```

`POST` trims the given `name` and rejects an empty value (400); `phone`,
if given, must be exactly 10 digits (400 `ErrPhoneInvalid` otherwise).
Lookup for an existing row is case-insensitive: if a row with the same
name (any case) already exists, that existing row is returned as-is with
`200 OK` (its `branch`/`ifsc`/`accountNo`/`phone` are NOT overwritten by
the new request's values); otherwise a new row is created (using the
request's `branch`/`ifsc`/`accountNo`/`phone`, all optional) and returned
with `201 Created`. The find-or-create semantics are shared by the "Add
Bank" form; the repledge picker itself only searches (`GET`) — it has no
create path, since `RepledgeModal.tsx`'s bank `SearchableSelect` runs
without `allowCreate`.

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET | `/api/v1/banks` | List/search banks, ordered by name asc | query: `q`? (case-insensitive partial match on `name`) |
| POST | `/api/v1/banks` | Find-or-create a bank by name | `{ "name", "branch"?, "ifsc"?, "accountNo"?, "phone"? }` |

## Ornament Types API (`/api/v1/ornament-types`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`.

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
**Migrated to the response envelope** (see "Response envelope migration"
above) — every endpoint in this section, including the customer-app routes
under `/customer/loans`, `/customer/payments`, and `/customer/loans/:id/
statement`, wraps success as `{"success": true, "data": ...}` (paginated
`{items, hasMore}` shapes sit under `data`). `DELETE /loans/drafts/:draftId`
returns `{"success": true, "message": "Draft deleted successfully"}` instead
of `204 No Content`. The receipt/statement PDF endpoints
(`/customer/payments/:paymentId/receipt`, `/customer/loans/:id/statement`)
are unaffected — they stream raw PDF bytes, never JSON, so there is no
envelope on the success path; their error responses still follow it.

Two status-code reclassifications from this migration (previously 400,
now more precise): `ErrPledgeNotActive`, `ErrAuctionDecisionAlreadyDecided`,
`ErrSurplusAlreadyDisposed`, and `ErrIndemnityBondAlreadySigned` are **409
Conflict** (state conflicts); `ErrShortfallAuthorityRequired` is **403
Forbidden** (a real distinguishing rule already present before this
migration, now formalized via `httpx.NewForbidden`). Everything else keeps
its exact prior status code — see `internal/loan/service.go`'s sentinel
error declarations for the full mapping.

The Go file split behind this section also changed: `internal/loan/model.go`
(957 lines, every entity in one file) is now `model_loan.go`, `model_ornament.go`,
`model_approval.go`, `model_payment.go`, `model_bank_pledge.go`,
`model_request.go`, `model_draft.go`, `model_auction.go` — one per entity/
group, mirroring the handler-side file split (`payment.go`, `purity.go`,
`indemnitybond.go`, etc.) this package already had. Pure move, no behavior
change; `internal/loan/handler.go` and `customer_handler.go` still hold
every handler.

Implemented in `backend/internal/loan/` — the Gold Loan Creation &
Ornaments Management domain. No authentication/RBAC yet — admin-only by
convention. The 3-stage approval chain below checks that the acting
employee's `role` matches the stage's required role (except
`"Administrator"`, which may act at any stage) — `LoanApproval` rows
record every actor/role/stage/timestamp/decision. This API is real end-to-end in the backend and is
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
`GoldValue = NetWeight × the per-gram rate resolved from the ornament's
declared purity string against the latest published K24` (400
`ErrNoGoldRate` if no rate exists yet). `purity` is a plain unit-suffixed
string — `"22K"` (karat mode, resolved as `K24 × karat/24`) or `"91.6%"`
(fineness mode, resolved as `K24 × fineness%/100`), range-checked to
`10-24` karat / `0-100` fineness% (400 `ErrInvalidPurity` otherwise) — see
`internal/loan/purity.go`'s `ParsePurity`/`rateForPurity` and the Purity
Standards API above for the suggestion list backing its entry UI. The
resolved per-gram rate is rounded to the nearest whole rupee before being
multiplied by weight. A loan's `totalNetWeight`/`totalGoldValue` are the sum across its
ornaments; `eligibleLoanAmount = totalGoldValue × scheme.ltvPercent / 100`.
`principalAmount` is operator-chosen and must be `<= eligibleLoanAmount`
(400 `ErrPrincipalTooHigh` otherwise); `outstandingAmount` starts equal to
`principalAmount`. `dueDate` is still submitted by the caller (the frontend
computes it as `openedDate + scheme.durationMonths` in `NewLoan.tsx` rather
than showing a manual date picker — see the Loan Schemes API above for
where `durationMonths` now lives as a real field) and must be after
`openedDate` (400 `ErrInvalidDueDate` otherwise); the backend does not
itself derive `dueDate` from the scheme.

**Approval chain (fixed, 3 stages for every loan):** a loan is *made* by a
Loan Operator, *verified* by the Loan Operator, *approved* by the Branch
Manager, then *finally sanctioned* by Management. `status` starts
`"Pending Approval"` / `approvalStage` starts `"LoanOperator"`.
`POST /:id/approve` with `{ stage: "LoanOperator", action: "Verified" }`
advances to `approvalStage: "BranchManager"`, then `"FinalSanction"`;
approving at `"FinalSanction"` sets `approvalStage: "Approved"` and
`status: "Active"` (disbursing the principal). `action: "Rejected"` at any
stage sets `approvalStage: "Rejected"` and `status: "Closed"` (the doc's
status list has no distinct "Rejected" bucket, so "Closed" is reused). The
acting employee's `role` is **not** a request field — it's read server-side
from the caller's own JWT (`platform.ActorFromContext`, never trusted from
the body) and must match the required role for the loan's current stage
(`Loan Operator` / `Branch Manager` / `Management`, respectively) —
mismatches return 400 `ErrWrongStage` — **except** `Administrator`, which
is exempt and may act at whichever stage is currently pending. The `stage`
sent must also match the loan's current `approvalStage`; calling again
after a terminal state returns 400 `ErrAlreadyDecided`.

`"Verified"` is the affirmative action at the `"LoanOperator"` stage and is
rejected with 400 `ErrWrongStage` at any other stage; `"Approved"` is also
still accepted there and behaves identically, so older clients keep
working. The stage is a *verification*, not a sanction: no amount check
gates it, because the Branch Manager and Management sanction every loan
regardless of size.

*Retired stage:* the chain previously had a 4th checkpoint,
`"AuthorizedManagement"`, between `"BranchManager"` and `"FinalSanction"`,
which made Management sign off twice (and, above the Loan Operator's old
hard cap, the Branch Manager too). `go run ./cmd/migrate` moves any loan
still parked on it to `"FinalSanction"`
(`loan.MigrateRetiredSanctionStage`), and the API also accepts/normalizes
the old value so such a loan is never stuck at a stage no role can clear.

**All approval limits are advisory only.** The hardcoded `sanctionLimits`
table (`internal/loan/service.go`, covering `"Branch Manager"`/
`"Management"`) and the admin-editable, DB-backed
`internal/loan.ApprovalLimit` row for `"Loan Operator"` (see the Approval
Limits endpoints below) are consulted purely to populate a non-blocking
`approvalWarning` string on the loan's JSON when the principal exceeds the
current stage's typical limit. Neither ever prevents an approve, verify, or
reject action. (The Loan Operator row used to be a **hard** cap that
returned 400 `ErrExceedsApprovalLimit` and forced a two-step
verify-then-escalate hand-off; both that error and
`ErrAwaitingOperatorVerification` are gone, since the operator stage no
longer grants any sanction of its own.)
`GET /:id/approvals` returns the full per-decision audit history
(`stage`/`action`/`actorEmployeeId`/`actorRole`/`remarks`/`createdAt`) for
the stage tracker UI.

**Payments/Bank Pledge are lightweight audit logs**, not full workflows.
`POST /:id/payments` records a `LoanPayment` row; non-`"Interest"` types
(`"Principal"`/`"Partial"`/`"Full Settlement"`) reduce `outstandingAmount`
and auto-close the loan (`status: "Closed"`) once it reaches `0`.
**Which loans may be re-pledged.** `POST /:id/bank-pledge` refuses (400
`ErrLoanNotPledgeable`) any loan whose gold is no longer in the branch's
custody to hand over: `Closed` (released back to the customer),
`Closure Requested` (release committed — pledging would deadlock it, since
`/complete-release` refuses while a pledge is active), `Auctioned` and
`Auctioned - Balance Due` (sold), and `Pending Approval` (never disbursed).
**Only an open pledge blocks a new one (2026-08-28).** `"Bank Pledged"` is
refused with 400 `ErrBankPledgeStillActive`; `"Released"` is ELIGIBLE — it
means the gold came back FROM the bank, so the loan may be pledged again, and
can cycle pledge → release → pledge for as long as it stays otherwise
eligible. This reverses an earlier "one pledge per loan, for its lifetime"
rule (and removes `ErrBankPledgeAlreadyUsed`): that rule existed only because
a second pledge would overwrite `bankPledgeStatus` and orphan the first record
with no release path, which the `HasActive` record check below now prevents
directly.

The rule is one place — `loan.bankPledgeRefusal`, over
`loan.CanAcceptBankPledge` / `bankPledgeIneligibleStatuses` — shared with the
`excludeBankPledged` listing filter, so the re-pledge picker never offers a
loan the save would reject. It is a pure function of the loan's two stored
fields and is covered by a status-matrix table test
(`internal/loan/bank_pledge_test.go`).

**Neither this endpoint nor `/complete-release` trusts `bankPledgeStatus`
alone (2026-08-28).** That column is a stored copy of what the
`bank_pledge_records` rows say, and the two can disagree: before the guard
above existed a loan could hold two `Active` pledge records, and releasing
either one overwrote the loan-level string while leaving the other open — so
`/complete-release`, which read only the string, could close a loan with a
live pledge against it. Both endpoints now also call
`BankPledgeRepository.HasActive(loanID)` and refuse with 400
`ErrBankPledgeStillActive` if any record is still `Active`, whatever the
string says.

`POST /:id/bank-pledge` records a `BankPledgeRecord` — `bankName`,
`pledgedAmount`, `pledgeDate` required; `bankId` (the registered `bank.Bank`
row the caller picked — stored alongside `bankName`, which stays a
denormalized display snapshot so history still reads correctly if the bank
is later renamed), `bankInterestRate` (the bank's annual rate on the
pledge), `referenceNumber` (the bank's own document/reference number), and
`bankPledgeDueDate` (when the bank's own loan/pledge term is expected to
end — distinct from `releaseDate`, only set once actually released) are all
optional. The record also snapshots `pledgedGrossWeight`/`pledgedNetWeight`
from the loan's ornament totals at pledge time (server-computed, not part
of the request body), so it stays self-contained even if the loan's
ornaments are edited afterwards. The call sets
`bankPledgeStatus: "Bank Pledged"`; `PUT /:id/bank-pledge/:pledgeId/release`
stamps its `releaseDate` and sets `bankPledgeStatus: "Released"`.

**Cash treatment is a per-transaction choice** (`cashTreatment`, one of
`"CashIn"` | `"RecordOnly"`). Not every re-pledge brings the bank's advance
into the branch till — some are purely book-keeping — so the caller decides:
- `"CashIn"` books a cash-in `CashMovement` (`source: "Bank"`, amount =
  `pledgedAmount`, stored as `cashMovementId`) **and nothing else** — no
  expense is written at pledge time. Releasing such a pledge books the amount
  back OUT as a fresh cash-out movement plus an auto-approved release
  `Expense` (`category: "Bank Pledge Release"`, `mode: "Bank"` so it does not
  double-count against Expected Cash in Hand), stored as `releaseExpenseId`.
  The original cash-in is never deleted, so both legs remain visible as
  history.

  > Changed 2026-08-28: pledging previously also wrote a mirrored
  > `"Bank Pledge"` expense, stored as `expenseId`. The bank's advance against
  > pledged gold is borrowing, not spending, so a single pledge appeared as
  > both Cash In and Expenses on the same day and inflated the expense
  > register, the expense-cashflow report and the dashboard expense donut. The
  > expense now belongs to the release leg only. `expenseId` is retired: it is
  > always `null` on new pledges, and `internal/migrate` deletes the
  > historical mirror rows (matching on category **and** the
  > `"Auto-recorded from bank pledge workflow"` remark, so manually entered
  > expenses are never touched) and nulls the links that pointed at them.
- `"RecordOnly"` creates NO cash movement and NO expense, and release is a
  symmetric no-op. Without that symmetry, releasing a record-only pledge would
  credit the till for money that never arrived.

**An omitted `cashTreatment` defaults to `"RecordOnly"`** — the safe path, so
cash only moves on an explicit opt-in. Any other non-empty value is rejected
with 400 `ErrInvalidCashTreatment` rather than being coerced, so a typo cannot
silently suppress a real cash entry. Rows created before this field existed
default to `"CashIn"` at the column level, because unconditional cash-in was
the only behavior that ever existed — that is genuinely what those pledges did,
and their releases still need the matching cash-out.

**`cashTreatment` is immutable.** There is no edit path: rewriting it would
retroactively falsify booked cash history. A mis-chosen treatment is corrected
via `PUT /:id/bank-pledge/:pledgeId/void` — `{ "reason" }`, restricted to
Administrator / Management / Branch Manager. Voiding marks the record
`status: "Voided"` (keeping every original figure for audit — voided records are
never deleted), books a compensating cash-out only if the original actually
moved cash, resets `bankPledgeStatus` to `"Not Pledged"`, and logs the actor and
reason. Staff then create a fresh pledge with the correct treatment.

**Re-pledge history & audit trail.** Every pledge carries an append-only
`events` array (`BankPledgeEvent`: `action` one of `"Pledged"` | `"Released"` |
`"Voided"`, plus `actorEmployeeId`/`actorRole`, `amount`, `remarks`,
`createdAt`), and `status` tracks `"Active"` | `"Released"` | `"Voided"`. Two
read endpoints expose the full set, which previously had no representation at
all — only currently-pledged loans were reachable, so a released re-pledge
vanished from the UI:
- `GET /:id/bank-pledge/history` — every record for one loan, newest first.
- `GET /bank-pledges/history` — records across all loans, branch-scoped.

**Money storage — `numeric(16,2)`, rounded at every write.** Every rupee
column across `loans`, `loan_payments`, `bank_pledge_records`,
`bank_pledge_events`, `loan_requests`, `auction_records`, `cash_movements`,
`expenses` and `opening_cash_balances` is Postgres `numeric(16,2)`, and each
balance is passed through `platform.RoundMoney` as it is written. Weights
(grams) and rates (% p.a.) stay `double precision` — they legitimately want
more than 2 decimals.

This matters because Go reads those columns back into `float64`. Storing
exact decimals means two equal rupee amounts parse to the *identical*
double, so a fully-serviced balance subtracts to exactly `0` instead of a
residue like `1.4e-14`. Before this, unrounded running totals drifted far
enough that `outstandingInterest > 0` reported arrears on loans whose
interest was paid off — which flagged them `isDefaulted` and queued their
gold for auction. Comparisons against zero still use the codebase's
`0.01` epsilon (`moneyEpsilon` in `accrual.go`) as a safety net.

Applying this to an existing database is a plain `go run ./cmd/migrate` —
GORM alters the column types in place and Postgres rounds existing values to
2 decimals as it casts, which also cleans up historical noise.

**Migrations run ONLY via `go run ./cmd/migrate`.** The API server performs no
schema work at startup: no `AutoMigrate`, no backfills, no permission
seeding. Restarting the server — including an unattended restart after a
crash — can therefore never reshape or rewrite live data as a side effect,
which is what previously let a schema change apply itself simply because
someone restarted the process. `cmd/migrate` is the single source of the
schema and must list every model.

On boot the server calls `requireMigratedSchema` (main.go), a cheap
table-presence check over a representative sample. If migrations have not
been run it exits immediately with the missing table names and the command
to run, instead of failing later as opaque per-request SQL errors. Deploys
must therefore run `go run ./cmd/migrate` before starting the API.

**Interest accrual model — whole calendar months, never pro-rated by day**
(`projectAccrual` in `accrual.go`). Interest is charged in complete monthly
steps measured from the accrual anchor (`lastAccrualDate`, seeded from
`openedDate`): a loan part-way through a cycle owes **nothing** for that
cycle, and the month's interest lands in full the instant the month
completes. Months are real calendar months with month-end clamping (a loan
opened 31 Jan accrues 28 Feb, not 3 Mar), not 30-day blocks. `"Quarterly
simple"` steps in 3-month periods; every other method steps monthly.

Each accrual advances `lastAccrualDate` to the **last completed period
boundary**, not to `now` — the leftover part-month carries into the next
call. This matters because `GET /loans/:id` and `POST /:id/payments` both
persist accrual: anchoring on `now` would discard the remainder on every
read, so a frequently-viewed loan would never complete a month.

Per-method base:
- `"Monthly simple interest"` (default) — outstanding principal.
- `"Flat monthly"` — original `principalAmount`, ignoring repayments.
- `"Quarterly simple"` — outstanding principal, quarterly rate.
- `"Compound monthly"` — outstanding principal **plus interest still
  unpaid**, so unpaid interest itself earns interest; settling the interest
  drops the next month back to principal alone.

Penal interest accrues on top, counted in whole overdue months from
`dueDate` (not from the anchor) with already-charged months subtracted, so a
due date falling mid-cycle neither double-charges nor loses a month.

**Loan status lifecycle flags** — `isDueSoon`/`isOverdue`/`isDefaulted`/
`daysOverdue` are computed fresh on every loan read (`enrichStatusFlags` in
`accrual.go`), purely from `dueDate` vs the current date — they are
display/filter flags, not persisted `status` values, and do NOT affect
interest/penal-interest accrual (which already runs independently off
`dueDate`, see `projectAccrual`). `isDueSoon` = due within 7 days and not
yet overdue; `isOverdue` = past due date; `isDefaulted` = overdue by more
than 90 days. `isDefaulted` is what unlocks the "Mark Auction Eligible"
action below — becoming Defaulted never auto-starts an auction case.

**Auction workflow — full 7 stages**, replacing the old one-shot
`POST /:id/auction`. A defaulted loan (`isDefaulted`) gets a real
`AuctionRecord` the moment staff mark it eligible; the case then advances
one stage at a time:
- `POST /:id/auction/eligible` — requires `isDefaulted`; creates the
  `AuctionRecord` at `stage: "AuctionEligible"`, sets
  `loan.status: "Auction Eligible"`. 400 `ErrLoanNotDefaulted` /
  `ErrAuctionAlreadyStarted` otherwise.
- `POST /:id/auction/notice` — `{ "remarks"? }`; no `method` is chosen by
  staff anymore — every call fires all three notice channels at once
  (`"SMS"`, `"WhatsApp"`, `"Registered Post"`), appending one `AuctionNotice`
  per channel (the customer notice history) and advancing to
  `"NoticeIssued"`. The WhatsApp leg is actually delivered live via the
  configured OpenWA sender (Settings > WhatsApp) — a delivery failure is
  logged but never blocks the notice from being recorded; SMS/Registered
  Post have no gateway wired up yet and are logged only.
- `POST /:id/auction/schedule` — `{ "auctionDate", "referenceNumber"? }`;
  requires stage `"NoticeIssued"`; advances to `"AuctionScheduled"`.
- `POST /:id/auction/sale` — `{ "saleAmount", "auctionExpenses"? }`;
  requires stage `"AuctionScheduled"`; advances to `"Auctioned"`. **The sale
  amount now moves real money** (previously it was captured and discarded —
  the balance was forced to zero and no cash entry was created at all, so
  money the branch received never appeared in the books):
  - Net proceeds (`saleAmount - auctionExpenses`) are booked as a cash-in
    `CashMovement` (`source: "Auction"`).
  - Those proceeds are applied against the debt through the ordinary payment
    waterfall (fee → penal → interest → principal) and logged as a
    `LoanPayment` of type `"Auction Sale"`. That type is deliberately excluded
    from `isCashPaymentType`, since the cash-in is booked directly here —
    treating it as cash-bearing again would double-count the till.
  - `surplusShortfall = netProceeds - loan.totalOutstandingBalance` is kept as
    the informational snapshot it always was.
  - **Covered the debt** → `loan.status: "Closed"`, and any excess is recorded
    as `surplusPayableAmount` awaiting an explicit disposition.
  - **Did NOT cover it** → `loan.status: "Auctioned - Balance Due"` with the
    real remaining balance intact, and a `"Shortfall"` decision request is
    raised automatically. The loan is NOT closed; the old behavior closed such
    loans anyway, silently erasing money the customer still owed.
  - The whole operation runs in one transaction, so a failure part-way cannot
    leave gold sold with no record of the proceeds.
- `POST /:id/auction/settle` — `{ "disposition": "RefundedToCustomer" |
  "RecordedAsIncome", "remarks"? }`. This is now specifically the **surplus
  disposition** step, reachable only when the sale cleared the debt in full;
  `"settlementStatus"` is still accepted as an alias for the field so older
  clients are not hard-broken. Requires stage `"Auctioned"` and an undisposed
  `surplusPayableAmount > 0.01`.
  - `"RefundedToCustomer"` books a cash-out for the surplus and stores
    `surplusPaidOutMovementId`; sets `finalSettlementStatus:
    "SettledToCustomer"`.
  - `"RecordedAsIncome"` books NO cash-out — the full net proceeds already
    entered the till at sale time, so a second movement would count the same
    rupees twice — and requires `remarks` (400
    `ErrSettlementRemarksRequired`). Sets `"SettledToLoanCo"`.
  - A disposition can only be recorded once (409 `ErrSurplusAlreadyDisposed`),
    so a surplus can never be paid out twice. 400
    `ErrAuctionBalanceDueCannotSettle` if the loan is `"Auctioned - Balance
    Due"` — that case goes through the shortfall decision instead.
- `GET /:id/auction` — returns the loan's ACTIVE `AuctionRecord` (404
  `ErrAuctionNotFound` if none is live) including its `notices`, `events` and
  `decisionRequests` arrays.
- `GET /:id/auction/history` — every case ever opened against the loan.
- `GET /auctions/concluded` — concluded cases (`"Settled"`/`"Withdrawn"`)
  across all loans, branch-scoped. Backs the Auctions page's History tab.

Every stage-advance call mismatched against the case's current stage
returns 400 `ErrAuctionWrongStage`.

**Auction routes are role-restricted.** All `/:id/auction*` routes carry an
additional `platform.RequireAnyRole("Administrator", "Management", "Branch
Manager", "Auction Administrator")` guard ON TOP of the existing `loans` CRUD
permission. The permissions table is resource-grained and `"loans"` also covers
payments and ornaments, so a Cashier or Loan Operator legitimately holds
`loans:update` in order to take payments — but deciding whether a customer
permanently loses their pledged gold is not the same authority. The guard is
scoped to these routes specifically; a group-level one would strip Cashier
access to payments. Blocked roles get 403.

**Multiple auction attempts per loan.** `AuctionRecord.loanId` is no longer
uniquely indexed. Only one case may be ACTIVE at a time (any stage other than
`"Settled"`/`"Withdrawn"`), enforced by a PARTIAL unique index created in
`cmd/migrate` — application-level checks alone are racy, since two concurrent
requests can both read "no active case" and both insert. The old
"one case per loan, forever" rule left a loan permanently unauctionable once a
case had been withdrawn: if the customer later defaulted again, no new case
could be opened. A unique-violation is translated back to 400
`ErrAuctionAlreadyStarted` so the API response stays clean.

Migration note: `loan.RelaxAuctionLoanUniqueIndex` must run BEFORE
`AutoMigrate` (GORM never drops an index it created, so the old constraint
would otherwise survive and keep rejecting the second insert regardless of the
struct tag), and `loan.CreateAuctionPartialIndexes` AFTER it (the predicates
reference columns AutoMigrate creates). Both are wired into `main.go` and
`cmd/migrate`, and both are idempotent. **No data is dropped** — only an index.

**Repayment during an auction changes its outcome.** `RecordPayment` now checks
for a live auction case (with a `SELECT ... FOR UPDATE` row lock, so a
concurrent auction action cannot clobber the write):
- **Loan cleared in full** → the case is auto-concluded as `stage: "Settled"`,
  `finalSettlementStatus: "SettledByRepayment"`. The customer rescued their
  gold; nobody should have to notice that manually.
- **Part-payment that clears every arrear** (interest *and* penal interest at
  zero, principal still owed) → the case is auto-withdrawn as
  `stage: "Withdrawn"`, any pending `"PartialRepayment"` escalation is
  resolved as `"RemovedFromAuction"`, and the loan returns to `"Active"`
  (out of Overdue — the same rule `refreshServicingStatus` applies to loans
  that never entered the pipeline). Added 2026-08-28: the customer has caught
  up on everything that fell due, which is exactly what the auction was
  pursuing, so there is nothing left for a manager to weigh — principal not
  yet due is not grounds to sell someone's gold.
- **Part-payment that leaves any arrears standing** → a `"PartialRepayment"`
  decision request is raised and the auction **FREEZES**. `notice`, `schedule`
  and `sale` all return 409 `ErrAuctionDecisionPending` while it is open. This
  is the central safety guarantee of the auction rework: gold cannot be sold
  out from under a customer whose payment is still under review, and a token
  payment cannot pull a scheduled auction without a manager.

**Auction decision requests** (`AuctionDecisionRequest`) are escalations the
system raises, never staff, so a decision cannot be quietly skipped. One table
serves both kinds via a `kind` field, with per-kind validation of which
outcomes are legal (a shortfall can never be closed as "keep in auction"). At
most one `"Pending"` request per (case, kind), enforced by a second partial
unique index; a further part-payment updates the existing one in place.
- `GET /auctions/decisions/pending` — the open queue, branch-scoped.
- `POST /:id/auction/decision` — `{ "requestId", "decision", "remarks"? }`.
  - `kind: "PartialRepayment"` → `"KeepInAuction"` (un-freezes, continues from
    the current stage) or `"RemovedFromAuction"` (case → `"Withdrawn"`, loan
    reverts to its normally-derived status). Either Auction Administrator or
    Branch Manager may decide — whoever acts first, so gold is never stuck
    awaiting two signatures.
  - `kind: "Shortfall"` → `"PursueBalance"` (loan → `"Overdue"`, which resumes
    normal collection AND interest accrual through the existing path) or
    `"WriteOff"` (balance cleared via a non-cash `"Auction Write-Off"`
    `LoanPayment` — which unlike `"Waiver"` CAN reach principal, since after
    the gold is sold what is being forgiven is principal — loan → `"Closed"`,
    case → `"Settled"` with `finalSettlementStatus: "WrittenOff"`).
    **Only Branch Manager / Management / Administrator may decide this**; the
    Auction Administrator raises it but gets 403
    `ErrShortfallAuthorityRequired`. Enforced in the service layer, not just
    the UI, because Auction Administrator does pass the route guard. `remarks`
    are mandatory (400 `ErrDecisionRemarksRequired`).

**`"Auctioned - Balance Due"` deliberately does not accrue interest.**
`projectAccrual` only accrues for `Active`/`DueSoon`/`Overdue`, so a shortfall
balance sits frozen at its post-sale figure while the decision is outstanding —
the manager judges a stable number rather than one moving underneath them.
Choosing `"PursueBalance"` moves the loan to `"Overdue"`, which resumes accrual
through the ordinary path with no separate accrual rule.

**Auction audit trail.** Each case carries an append-only `events` array
(`AuctionEvent`: `action`, `actorEmployeeId` (nil for system-generated),
`actorRole`, `remarks`, `createdAt`). Notices already covered what the customer
was told; who marked a case eligible, scheduled it, recorded the sale, or
settled it previously left no trace at all.

**Customer notifications at every step.** Previously only notice-issuing
messaged the customer. `MarkAuctionEligible`, `ScheduleAuction`,
`RecordAuctionSale`, every decision outcome, both surplus dispositions, and the
auto-settle-by-repayment path all now send a WhatsApp message via
`notifyCustomer` (log-and-continue — a delivery failure never fails the
financial operation it describes).

**Extension & release requests** (`LoanRequest`, the "Extensions & Release"
page — `frontend/components/Requests.tsx`). Staff log these in person on the
customer's behalf — a customer's ask to push a loan's due date out
(`type: "Extension"`) or close the loan and take the gold back
(`type: "Release"`) — via `POST /:id/extension-request` (`{ "months",
"detail"? }`) or `POST /:id/release-request` (`{ "detail"? }`). Creating a
request never itself changes the loan; both create a `status: "Pending"`
row.

*Extension* is decided in one step: `PUT /requests/:requestId/decide` with
`{ "action": "Approved" | "Rejected", "remarks"? }` — the deciding
employee is read from the caller's JWT, not the body. Staff review the
loan's live `outstanding`/`outstandingInterest`/
`outstandingPenalInterest` (see the Loan JSON shape below) and the
requested `months` before deciding. Approving adds `months` to the loan's
`dueDate` (recalculating status/totals) and stamps `newDueDate` on the
request; it's blocked with 400 `ErrLoanTerminalState` if the loan is
already `Closed`/`Auctioned`/`Defaulted` — every other state (`Overdue`,
high penal interest, etc.) is left to staff judgment. `decide` returns 400
`ErrNotExtensionRequest` if called on a Release request.

*Release* goes through more scrutiny — the same fixed Manager→Management
approval chain used for loan sanctioning, gated by a verification
checklist:
1. `PUT /requests/:requestId/verify` with any subset of `{
   "paymentVerified", "packetVerified", "bankPledgeVerified",
   "customerConfirmed" }` (booleans) plus optional `"verificationNotes"`
   and `"charges"` (a single staff-entered override amount) — callable
   repeatedly as staff confirm each item in person. `charges` feeds into
   the settlement snapshot below.
2. `POST /requests/:requestId/approve` with `{ "stage": "Manager" |
   "Management", "action": "Approved" | "Rejected", "remarks"? }` —
   identical shape to `POST /:id/approve` (acting employee from the JWT,
   not the body). Refuses the
   first stage with 400 `ErrChecklistIncomplete` until all four checklist
   items are true. `Rejected` at either stage only rejects the request.
   The final `Approved` (Management stage) snapshots `settlementAmount =
   loan.totalOutstandingBalance + charges` onto the request and sets the
   loan's `status: "Closure Requested"` (reusing a status value that
   previously existed but was never set).
3. `POST /:id/complete-release` (empty body — the acting employee comes
   from the caller's JWT) — the actual "hand the gold back" step, separate
   from approving the request. Requires an
   Approved Release request for the loan (404 `ErrReleaseNotApproved`
   otherwise); requires `loan.totalOutstandingBalance <= 0` — **every
   repayment recorded via the existing `POST /:id/payments` reduces this
   automatically**, so approving a release does not itself let the gold
   out, staff must record the remaining settlement payment first (400
   `ErrOutstandingBalanceRemains` otherwise); and requires the bank pledge
   already released (400 `ErrBankPledgeStillActive` otherwise). On success
   it moves the loan's packet through to `Released` and sets the loan's
   `status: "Closed"`.

`approve` returns 400 `ErrNotReleaseRequest` if called on an Extension
request. A request already decided (`decide`) or already at a terminal
`ApprovalStage` (`approve`) returns 400 `ErrRequestAlreadyDecided`.

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
  "approvalStage": "LoanOperator",
  "bankPledgeStatus": "Not Pledged",
  "isDueSoon": false,
  "isOverdue": false,
  "isDefaulted": false,
  "daysOverdue": 0,
  "approvalWarning": "",
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
| POST | `/api/v1/loans` | Create a loan with its ornaments. `draftId` (optional) is the saved draft this was submitted from — discarded server-side once the loan exists, fail-soft (a draft that won't delete never fails the submission) | `{ "branchId", "customerId", "schemeId", "openedDate", "dueDate", "principalAmount", "ornaments": [{ "name", "purity", "grossWeight", "deductionWeight"?, "quantity"?, "remarks"? }], "lockerId"?, "draftId"? }` |
| POST | `/api/v1/loans/drafts` | Save the New Gold Loan form as an unsubmitted draft ("Save Draft" on `NewLoan.tsx`). Only `branchId` is required — a draft is deliberately unvalidated (see below) | `{ "branchId", "customerId"?, "schemeId"?, "lockerId"?, "principalOverride"?, "ornaments": [{ "name"?, "purity"?, "grossWeight"?, "quantity"?, "imageUrl"?, "imageName"? }] }` |
| GET | `/api/v1/loans/drafts` | List the **caller's own** drafts, most recently saved first (branch-scoped as well). Ornaments come back in their saved on-screen order; `customer`/`scheme`/`branch` are preloaded so the form can repopulate its pickers' labels | — |
| GET | `/api/v1/loans/drafts/:draftId` | Get one of the caller's own drafts | — |
| PUT | `/api/v1/loans/drafts/:draftId` | Overwrite a draft in place (pressing "Save Draft" again), replacing its ornament rows wholesale | same body as POST `/loans/drafts` |
| DELETE | `/api/v1/loans/drafts/:draftId` | Discard a draft — hard delete, `204 No Content` | — |
| GET | `/api/v1/loans` | List/filter loans. Returns a bare array unless `limit` is given, in which case the response is the `{ "items": [...], "hasMore": bool }` envelope (same convention as `GET /customers`) — this backs the paginated `SearchableSelect` loan pickers, 10 rows per page, next page appended on scroll | query: `status`, `branchId`, `customerId`, `q` (matches `loanNumber`), `excludeBankPledged` (`true` keeps only loans whose `bankPledgeStatus` is not `"Bank Pledged"` and whose status is not closed/closure-requested/auctioned/pending-approval — the bank re-pledge picker's eligibility rule, matching `loan.bankPledgeRefusal`; `"Released"` loans ARE offered, since their gold is back from the bank), `limit`, `offset` |
| GET | `/api/v1/loans/:id` | Get one loan with ornaments/approvals/payments/bank-pledge history | — |
| GET | `/api/v1/loans/:id/statement` | Customer-facing account statement as a **PDF** (`Content-Type: application/pdf`, `Content-Disposition: attachment; filename="statement-<loanNumber>.pdf"`). Not the JSON envelope. Gated by `can view loan` — it shows nothing the loan detail screen does not. Branch- and tenant-scoped: another branch's or business's loan is a plain 404 | — |
| GET | `/api/v1/loans/by-number/:loanNumber` | Same as above, looked up by the human-readable loan number instead of the numeric id (a single atomic query — used by `LoanDetail.tsx`, mirrors `packet`'s `by-code` lookup) | — |
| POST | `/api/v1/loans/:id/ornaments` | Pledge an additional ornament, recalculates loan totals | `{ "name", "purity", "grossWeight", "deductionWeight"?, "quantity"?, "remarks"? }` |
| PUT | `/api/v1/loans/ornaments/:ornamentId` | Edit a pledged ornament, recalculates its loan's totals | same body as above |
| POST | `/api/v1/loans/ornaments/:ornamentId/purity-test` | Record staff purity re-test (upsert, one per ornament) | `{ "testedPurity", "testedGrossWeight", "testedDeductionWeight"?, "testingRemarks"?, "testedBy", "testedAt" }` |
| POST | `/api/v1/loans/ornaments/:ornamentId/images` | Attach one photo (upload it first via `/api/v1/uploads`) | `{ "imageUrl" }` |
| GET | `/api/v1/loans/interest-collected` | Sum interest+penal-interest collected in a date range (Dashboard's "Interest Collected" KPI) — defaults to the current calendar month | query: `from`?, `to`? (`YYYY-MM-DD`) |
| POST | `/api/v1/loans/:id/approve` | Advance/reject the 3-stage sanction chain — Cashier cannot create loans but may still act here if their role matches a stage (unlikely by design); acting employeeId/role come from the JWT, not the body | `{ "stage": "LoanOperator" \| "BranchManager" \| "FinalSanction", "action": "Verified" (LoanOperator stage) \| "Approved" \| "Rejected", "remarks"? }` |
| GET | `/api/v1/loans/:id/approvals` | Full per-decision sanction-chain audit history | — |
| POST | `/api/v1/loans/:id/indemnity-bond/esign/start` | Render the loan's indemnity bond server-side (headless Chromium — see `internal/loan/indemnitybond.go`), upload it to Setu, and start an Aadhaar eSign signature request naming the loan's customer as signer. Returns the signing URL the CUSTOMER must open themselves (own device/browser) to complete Aadhaar+OTP signing — same "open URL, then poll status" shape as customer's DigiLocker Aadhaar-verify flow below. Requires `SETU_ESIGN_*` env vars and a Chrome/Chromium binary on the server host (see `backend/README.md`) | `{ "lang": "en" \| "hi" \| "gu", "redirectUrl" }` |
| GET | `/api/v1/loans/:id/indemnity-bond/esign/status` | Poll the outstanding eSign request started above. While the customer hasn't finished signing, returns the current status only; once `sign_complete`, downloads the signed PDF from Setu and re-hosts it via `/api/v1/uploads`' storage, returning the updated loan (`indemnityBondSignedUrl`) | — |
| GET | `/api/v1/loans/approval-limits/loan-operator` | Get the current (advisory-only) Loan Operator approval limit | — |
| PUT | `/api/v1/loans/approval-limits/loan-operator` | Set the Loan Operator approval limit (Employees page's "Roles" panel) | `{ "maxAmount" }` |
| POST | `/api/v1/loans/:id/payments` | Record a payment (receiving employeeId comes from the JWT, not the body). `type` selects where the amount lands and accepts exactly five values — `"Partial"` (fee → penal → interest → principal, the default and what `PaymentModal.tsx`'s "Apply Payment To" picker calls **Both**), `"Interest"` (fee → penal → interest, never principal), `"Penal Interest"` (fee → penal only), `"Principal"` (fee → principal, skipping interest) and `"Full Settlement"` (must cover everything owed; clears every bucket and closes the loan). Anything else is a 400: `"Adjustment"`, `"Waiver"`, `"Auction Sale"` and `"Auction Write-Off"` exist in `allocatePayment` but are raised by the ledger-correction/auction flows themselves and are refused on this endpoint (see the handler's `staffSelectablePaymentTypes`). An amount overshooting the buckets its type may touch is rejected with `ErrExceedsOutstanding`. `processingFee` is an optional new charge — added to `Loan.OutstandingProcessingFee` *before* `amount` is allocated, so this same payment's `amount` clears it first (highest priority in the waterfall); it is **not** extra cash on top of `amount` — `amount` is the total cash received either way | `{ "amount", "type", "processingFee"?, "paidOn" }` |
| POST | `/api/v1/loans/:id/bank-pledge` | Record a bank pledge. `cashTreatment` omitted ⇒ `"RecordOnly"` (no cash effect); only an explicit `"CashIn"` books money | `{ "bankName", "pledgedAmount", "pledgeDate", "bankId"?, "bankInterestRate"?, "referenceNumber"?, "bankPledgeDueDate"?, "cashTreatment"?: "CashIn" \| "RecordOnly" }` |
| PUT | `/api/v1/loans/:id/bank-pledge/:pledgeId/release` | Release a bank pledge. Cash effect mirrors the pledge's `cashTreatment` — a `RecordOnly` pledge releases with no cash movement | — |
| PUT | `/api/v1/loans/:id/bank-pledge/:pledgeId/void` | Cancel a pledge recorded in error — the only way to correct the immutable `cashTreatment`. Administrator / Management / Branch Manager only | `{ "reason" }` |
| GET | `/api/v1/loans/:id/bank-pledge/history` | Every re-pledge for one loan, released and voided included, each with its audit trail | — |
| GET | `/api/v1/loans/bank-pledges/history` | Re-pledge records across all loans, branch-scoped | — |
| GET | `/api/v1/loans/:id/auction` | Get the loan's ACTIVE auction case (notices, events, decision requests included) | — |
| GET | `/api/v1/loans/:id/auction/history` | Every auction case ever opened against the loan | — |
| GET | `/api/v1/loans/auctions/concluded` | Concluded cases (`Settled`/`Withdrawn`) across all loans, branch-scoped | — |
| GET | `/api/v1/loans/auctions/decisions/pending` | Open decision escalations awaiting a human ruling | — |
| POST | `/api/v1/loans/:id/auction/eligible` | Start an auction case — requires `isDefaulted` and no other case currently active | — |
| POST | `/api/v1/loans/:id/auction/notice` | Log a customer notice on all 3 channels (SMS, WhatsApp — sent live, Registered Post), advances to `NoticeIssued` | `{ "remarks"? }` |
| POST | `/api/v1/loans/:id/auction/schedule` | Record the auction date/reference, advances to `AuctionScheduled` | `{ "auctionDate", "referenceNumber"? }` |
| POST | `/api/v1/loans/:id/auction/sale` | Record the sale: books net proceeds as cash-in, applies them via the payment waterfall, advances to `Auctioned`. Closes the loan if covered; else `Auctioned - Balance Due` + raises a Shortfall decision | `{ "saleAmount", "auctionExpenses"? }` |
| POST | `/api/v1/loans/:id/auction/settle` | Dispose of the surplus and close the case. Full-recovery cases only; one-shot | `{ "disposition": "RefundedToCustomer" \| "RecordedAsIncome", "remarks"? }` |
| POST | `/api/v1/loans/:id/auction/decision` | Resolve an escalation. PartialRepayment ⇒ `KeepInAuction`/`RemovedFromAuction` (Auction Admin or Branch Manager); Shortfall ⇒ `PursueBalance`/`WriteOff` (Branch Manager / Management / Administrator only) | `{ "requestId", "decision", "remarks"? }` |
| POST | `/api/v1/loans/:id/extension-request` | Log a request to push the loan's due date out | `{ "months", "detail"?, "requestedBy"? }` |
| POST | `/api/v1/loans/:id/release-request` | Log a request to close the loan / release the gold | `{ "detail"?, "requestedBy"? }` |
| GET | `/api/v1/loans/requests` | List/filter extension &amp; release requests | query: `status`, `loanId` |
| PUT | `/api/v1/loans/requests/:requestId/decide` | Decide a pending **Extension** request — approving pushes `dueDate` out (deciding employeeId comes from the JWT, not the body) | `{ "action": "Approved" \| "Rejected", "remarks"? }` |
| PUT | `/api/v1/loans/requests/:requestId/verify` | Update a **Release** request's verification checklist/charges | `{ "paymentVerified"?, "packetVerified"?, "bankPledgeVerified"?, "customerConfirmed"?, "verificationNotes"?, "charges"? }` |
| POST | `/api/v1/loans/requests/:requestId/approve` | Advance/reject a **Release** request's Manager→Management chain (unchanged 2-step chain — separate from the loan sanction chain); acting employeeId comes from the JWT, not the body | `{ "stage": "Manager" \| "Management", "action": "Approved" \| "Rejected", "remarks"? }` |
| POST | `/api/v1/loans/:id/complete-release` | Hand the gold back — only once settlement is fully paid &amp; bank pledge released (acting employeeId comes from the JWT, not the body) | *(empty)* |
| GET | `/api/v1/customers/:id/profile360` | Customer 360°: every loan (ornaments/payments/bank pledges) + auction history + running totals for one customer, in one call. Lives on `loanHandler` (see `internal/loan/service.go`'s `GetCustomer360`) to avoid a customer↔loan import cycle, mounted under `/customers` in `main.go`. Optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` restricts it to loans whose `openedDate` falls in that inclusive window (both bounds optional, `to` must not precede `from`); the loan list, ornaments/payments/bank-pledge/auction sections and all running totals are recomputed over the narrowed set | — |
| GET | `/api/v1/customers/:id/loans` | Customer 360 view's Loan History sub-table, paginated server-side (`loanHandler.ListLoansForCustomer`, reuses `Repository.FindAll(LoanFilter{CustomerID: ...})` — no bespoke query needed) | query: `limit`, `offset`, `from`, `to` |
| GET | `/api/v1/customers/:id/ornaments` | Customer 360 view's Pledged Ornaments (all loans) sub-table — every ornament across every loan the customer has, newest loan first; each row carries its parent loan's `loanNumber` so the table can link back to the loan without a second lookup | query: `limit`, `offset`, `from`, `to` |
| GET | `/api/v1/customers/:id/payments` | Customer 360 view's Payment History (all loans) sub-table — every payment across every loan the customer has, newest first, each row carrying its parent loan's `loanNumber` | query: `limit`, `offset`, `from`, `to` |
| GET | `/api/v1/customers/:id/bank-pledges` | Customer 360 view's Bank Pledges (all loans) sub-table — every re-pledge record across every loan the customer has, newest first, each row carrying its parent loan's `loanNumber` | query: `limit`, `offset`, `from`, `to` |
| GET | `/api/v1/customers/:id/auction-history` | Customer 360 view's Auction History sub-table — every auction case ever opened (concluded or not) across every loan the customer has, newest first, each row carrying its parent loan's `loanNumber` | query: `limit`, `offset`, `from`, `to` |

All 5 sub-table endpoints above are mounted the same way `profile360` is
(handler on `loanHandler`, gated by the `customers` resource's Read
permission, URL kept customer-shaped) and share its `from`/`to` semantics
exactly: both are optional inclusive `YYYY-MM-DD` bounds on each row's
**parent loan's** `openedDate` (not any date field of the row itself), so a
given window narrows every sub-table — and `profile360`'s running totals —
consistently. `to` before `from` is a 400. **Pagination:** `limit`/`offset`
follow this codebase's usual convention — passing `limit` (> 0) requests
`limit+1` rows and slices off the extra one to compute `hasMore` without a
second `COUNT` query, responding with `{ "items": [...], "hasMore": bool }`
under the envelope; there is no bare-array fallback on these 5 routes since
nothing pre-existing calls them without `limit`. Replaces `CustomerDetail.tsx`'s
former client-side 10-per-page slicing over `profile360`'s single payload —
each table now fetches its own page from its own endpoint.

`RecordBankPledge`/`ReleaseBankPledge` also fire a matching packet movement
(see the Packets API below) on the loan's active packet — `Bank Pledged`
on pledge, `Returned` on release — via a narrow `loan.PacketMover`
interface implemented by `packet.Service`. `loan.Service.Create()` also
auto-generates the loan's tracking packet (`loan.PacketCreator`,
implemented by `packet.Service`) right after a loan is created. Both are
fail-soft: an error logs and the loan-level action still succeeds — packet
tracking is an enrichment, not a hard lending-flow dependency.

**Loan drafts** (`/loans/drafts`, `loan.LoanDraft` + `loan.LoanDraftOrnament`)
back the "Save Draft" button on the New Gold Loan page, which until now only
raised a "Draft saved (demo)" toast and discarded the form. A draft is
explicitly **not** a loan: no loan number is assigned, nothing enters the
sanction chain, no packet is created and no gold rate is applied. That is why
only `branchId` is required and nothing else is validated — the whole point
is to store the form exactly as far as staff got, including a row with no
weight yet or a customer not chosen. Every real rule (KYC-verified customer,
a rate published today, principal within LTV, at least one ornament) is
applied only when the draft is submitted through `POST /loans`.

Consequences worth knowing:
- **Ownership.** A draft belongs to the employee who saved it (taken from the
  JWT, never the body) and listing is additionally branch-scoped. Another
  employee's draft returns `404` rather than `403`, so the API never reveals
  that someone else has one.
- **`principalOverride` is stored, the eligible amount is not.** A draft
  reopened next week recomputes eligibility from that day's gold rate; only a
  deliberate manual override is persisted.
- **Ornament rows are replaced wholesale** on `PUT`, and carry `position` so
  the on-screen row order survives. Photos are kept as `imageUrl` (already
  uploaded via `POST /uploads` when staff picked the file, before any loan
  existed).
- **Hard deleted, not soft.** Drafts carry no money and are not an audit
  trail.

## Lockers API (`/api/v1/lockers`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`;
`DELETE` returns `{"success": true, "message": "Locker deleted successfully"}`.
A locker still holding packets, or a duplicate `code`, returns **409**.

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
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`. An
invalid stage transition or a full locker now returns **409 Conflict**
(previously 400) — both are state conflicts, not malformed requests.

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

## Reminders / Reminder Calendar API (`/api/v1/reminders`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success responses wrap as `{"success": true, "data": ...}`;
`DELETE` returns `{"success": true, "message": "Reminder deleted successfully"}`
instead of `204 No Content`.

Implemented in `backend/internal/reminder/`. Backs `frontend/components/
Calendar.tsx` and Dashboard's "Upcoming Reminders" card. Two distinct
things live under this one resource:

1. **Manual `Reminder` rows** — staff-logged Customer Follow-Ups,
   Promise-to-Pay dates, or free-form Custom reminders, always tied to a
   customer and optionally to a specific loan. Plain CRUD + a one-click
   `Complete` action.
2. **`GET /reminders/calendar`** — a read-only aggregation that merges
   those manual rows with events computed live from `internal/loan`
   (never persisted here): each open loan's (`Active`/`Due Soon`/
   `Overdue`) Due Date, an `Overdue` event once that date has passed, and
   a monthly "interest payment" reminder on the loan's opened-date
   day-of-month (`InterestDue`) — a practical convention since interest
   accrues continuously rather than on a real billing schedule (see
   `internal/loan/accrual.go`). This single endpoint is the source of
   truth both the Calendar page and the Dashboard read from.

```json
// Reminder
{
  "id": 1,
  "customerId": 4,
  "customer": { "id": 4, "name": "Anil Varma", "code": "CUST-04", "phone": "9876543210" },
  "loanId": 12,
  "type": "Follow-Up",
  "dueDate": "2026-08-15T00:00:00Z",
  "note": "Call about overdue interest",
  "status": "Pending",
  "createdByEmployeeId": 3,
  "createdAt": "2026-08-10T00:00:00Z",
  "updatedAt": "2026-08-10T00:00:00Z"
}
```

```json
// CalendarEvent (GET /reminders/calendar response item)
{
  "date": "2026-08-15",
  "type": "Overdue",
  "title": "Loan overdue — GL-1004",
  "detail": "Anil Varma",
  "loanId": 12,
  "loanNumber": "GL-1004",
  "customerId": 4,
  "customerName": "Anil Varma",
  "reminderId": null,
  "status": null
}
```

`type` is one of `InterestDue` | `LoanDue` | `Overdue` | `FollowUp` |
`PromiseToPay` | `Custom`. `reminderId`/`status` are only set for events
backed by a persisted `Reminder` (`FollowUp`/`PromiseToPay`/`Custom`) — the
first three types are always computed fresh from `loan.Loan` and have no
row of their own to edit/delete.

`GET /reminders/calendar` always sorts the merged list Overdue-first, then
ascending by date, before either shape below is built (moved server-side
from a client-side sort that used to run in `Dashboard.tsx`). Its response
shape depends on whether **both** `page` and `pageSize` are sent:

- **Neither, or only one** (the original shape — `Calendar.tsx`'s full-month
  view): a bare JSON array of `CalendarEvent`, as shown above.
- **Both** (`Dashboard.tsx`'s "Upcoming Reminders" card, page size 5): the
  paginated envelope
  ```json
  { "events": [ /* CalendarEvent, this page only */ ], "totalCount": 23 }
  ```
  — `totalCount` is the full merged-and-sorted event count for `[from, to]`,
  not just the page returned.

| Method | Path | Purpose | Body / Query |
|---|---|---|---|
| POST | `/api/v1/reminders` | Log a manual reminder | `{ "customerId", "loanId"?, "type", "dueDate", "note"?, "employeeId" }` |
| GET | `/api/v1/reminders` | List manual reminders | query: `customerId`?, `loanId`?, `status`?, `from`?, `to`? (all optional) |
| GET | `/api/v1/reminders/calendar` | Unified calendar feed, sorted Overdue-first-then-by-date; paginated when `page`+`pageSize` are both given | query: `from`, `to` ("YYYY-MM-DD"; defaults to the current calendar month), `page`?, `pageSize`? |
| GET | `/api/v1/reminders/:id` | Get one manual reminder | — |
| PUT | `/api/v1/reminders/:id` | Update a manual reminder | `{ "type", "dueDate", "note"?, "status"? }` |
| PUT | `/api/v1/reminders/:id/complete` | Mark a manual reminder Done | — |
| DELETE | `/api/v1/reminders/:id` | Delete a manual reminder | — |

## Dashboard API (`/api/v1/dashboard`)
Implemented in `backend/internal/dashboard/`. A read-only aggregator with no
persisted model of its own — every row it returns already belongs to
`internal/loan`'s own tables; this package only merges, orders and paginates
them for `frontend/components/Dashboard.tsx`'s "Needs Attention" card.
Gated by the same "can view loan" permission the underlying loans/requests
are already gated by everywhere else.

`GET /dashboard/needs-attention` merges, in this fixed order, every loan
with `status = "Pending Approval"`, every `LoanRequest` with
`status = "Pending"` (Extension or Release), and every loan with
`status` in `"Auction Eligible"` / `"Defaulted"` — each fetched from the
same `loan.Repository`/`loan.LoanRequestRepository` methods
`loan.Service.List`/`ListRequests` already use, branch-scoped the same way.
Page size is fixed at 15 (not caller-adjustable).

```json
// GET /dashboard/needs-attention?page=1 response ({"success":true,"data":...})
{
  "items": [
    { "kind": "approval", "loanId": 12, "loanNumber": "GL-1004", "customerName": "Anil Varma", "principal": 50000, "approvalStage": "BranchManager" },
    { "kind": "request", "requestId": 7, "loanId": 9, "loanNumber": "GL-1001", "customerName": "Divya Nair", "requestType": "Extension", "detail": "3 more months requested" },
    { "kind": "auction", "loanId": 3, "loanNumber": "GL-1000", "customerName": "Ravi Kumar", "outstanding": 82000, "status": "Defaulted" }
  ],
  "totalCount": 3,
  "approvalsCount": 1,
  "requestsCount": 1,
  "auctionsCount": 1
}
```

`kind` is one of `approval` | `request` | `auction`; only the fields
relevant to that kind are populated (others are omitted). `totalCount`/
`approvalsCount`/`requestsCount`/`auctionsCount` are always counted across
the FULL merged set, not just the returned page.

| Method | Path | Purpose | Body / Query |
|---|---|---|---|
| GET | `/api/v1/dashboard/needs-attention` | Paginated "Needs Attention" feed (approvals, then requests, then auctions), page size 15 | query: `page`? (1-based, defaults to 1) |

## Reports API (`/api/v1/reports`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — every list endpoint's `{rows, totals, totalCount}` (`reports.Result`,
documented below) now sits under an outer `{"success": true, "data": {...}}`.
The `/reports/export/:key` endpoint is unaffected — it streams a binary
`.xlsx`/`.pdf` file, never JSON, so there is no envelope to apply; its error
path (invalid key/format) still returns `{"success": false, "error": "..."}`.

Implemented in `backend/internal/reports/`. Management-only (see the RBAC
section above) — 16 server-side aggregation endpoints covering loans,
gold/packets, bank pledge, auctions, cash, KYC, gold rates, employee
performance, and WhatsApp communication history, each with a matching
`.xlsx`/`.pdf` export. Unlike most other packages, `reports` queries the
database directly by table name (`db.Raw`/`db.Table`) rather than importing
every domain package's GORM model — it's a pure read-side aggregator over
tables that already belong to `loan`/`packet`/`cash`/etc.

**Common query params** (every list endpoint below accepts these; export
endpoints accept the same filters but ignore pagination):
| Param | Type | Notes |
|---|---|---|
| `from` | `YYYY-MM-DD` | Start of date range (optional) |
| `to` | `YYYY-MM-DD` | End of date range (optional) |
| `branch_id` | uint | Optional single-branch scope; falls back to `platform.GetBranchScope(c)` (the caller's own branch) when omitted, so a non-`Administrator`'s branch scope is enforced even if the frontend forgets to pass it |
| `page` | int | 1-based, default `1` (list endpoints only) |
| `page_size` | int | Default `10` (list endpoints only) |

**Common response envelope** (`reports.Result`):
```json
{ "rows": [ /* report-specific row objects */ ], "totals": { /* report-specific summary */ }, "totalCount": 42 }
```
`totalCount` is the full filtered row count *before* pagination, matching
the frontend's fixed page size of 10.

| Method | Path | Extra params | Rows | Totals |
|---|---|---|---|---|
| GET | `/api/v1/reports/disbursement` | — | loanId, loanNumber, openedDate, amount, branchName, customerName, schemeName | count, totalAmount |
| GET | `/api/v1/reports/loans/status` | `status` | loanId, loanNumber, customerName, branchName, status, outstanding, dueDate | active, closed, dueSoon, overdue, defaulted, other, count |
| GET | `/api/v1/reports/interest-collection` | — | loanId, loanNumber, paidOn, interestApplied, penalApplied, branchName | totalInterest, totalPenal, total |
| GET | `/api/v1/reports/outstanding-principal` | — | branchName, loanCount, outstanding | totalOutstanding, totalLoans |
| GET | `/api/v1/reports/payment-collection` | — | paymentId, loanNumber, paidOn, amount, type, branchName, employeeName | totalAmount, count |
| GET | `/api/v1/reports/gold-weight` | — | ornamentId, loanNumber, customerName, name, purity, grossWeight, netWeight, goldValue | totalGrossWeight, totalNetWeight, totalGoldValue |
| GET | `/api/v1/reports/packets` | — | packetId, code, loanNumber, status, lockerCode, movementCount | count, inLocker, bankPledged, released |
| GET | `/api/v1/reports/bank-pledge` | — | recordId, loanNumber, bankName, pledgedAmount, pledgeDate, releaseDate, status | outstandingLiability, count |
| GET | `/api/v1/reports/loan-extensions` | — | requestId, loanNumber, requestedAt, months, newDueDate, status | count |
| GET | `/api/v1/reports/gold-release` | — | requestId, loanNumber, customerName, requestedAt, settlementAmount, status | count, totalSettlement |
| GET | `/api/v1/reports/auctions` | — | recordId, loanNumber, stage, auctionDate, saleAmount, settlementStatus | count, totalSaleAmount |
| GET | `/api/v1/reports/expense-cashflow` | — | date, branchName, collections, disbursements, cashExpenses | totalCollections, totalDisbursements, totalExpenses, netCashflow |
| GET | `/api/v1/reports/kyc` | — | customerId, code, name, phone, kycStatus, panStatus, aadhaarStatus | count, verified, pending |
| GET | `/api/v1/reports/gold-rate-history` | — | date, k24, setBy | count |
| GET | `/api/v1/reports/employee-performance` | — | employeeId, name, role, branchName, loansProcessed, collectionsAmount, remindersSent, approvals | totalLoansProcessed, totalCollections |
| GET | `/api/v1/reports/communication-history` | `trigger_type` | id, recipientName, recipientPhone, channel, triggerType, status, sentAt | count, sent, failed |

**Export**: `GET /api/v1/reports/export/:key?format=xlsx|pdf` (plus the same
`from`/`to`/`branch_id` filters — no pagination, the file always contains
every matching row). `:key` is a URL-safe report key, listed below (note
`loans-status` here vs `loans/status` above — the export key and the list
path segment intentionally differ since gin can't mix a wildcard route
with static sibling segments at the same level):
`disbursement`, `loans-status`, `interest-collection`,
`outstanding-principal`, `payment-collection`, `gold-weight`, `packets`,
`bank-pledge`, `loan-extensions`, `gold-release`, `auctions`,
`expense-cashflow`, `kyc`, `gold-rate-history`, `employee-performance`,
`communication-history`. Response is a binary file
(`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for
`xlsx`, `application/pdf` for `pdf`) with a `Content-Disposition: attachment`
header; the export table's columns are derived by reflecting over the same
row struct the JSON endpoint returns (via each row DTO's `json` tags), so
there's no separate per-report spreadsheet mapping to maintain.

### `communication_logs` table (new, backs the Communication History report)
Implemented in `backend/internal/commlog/` (`CommunicationLog` model,
GORM-migrated via `cmd/migrate`). Populated at every WhatsApp send site
(`loan.Service.notifyCustomer` — ~12 call sites incl. auction notices,
`reminder.Service.SendWhatsApp`, `auth.Service`'s OTP send) so the report
has real data without a dedicated logging endpoint of its own.

| Column | Type | Notes |
|---|---|---|
| `id` | uint (PK) | |
| `recipient_name` | string | |
| `recipient_phone` | string | |
| `chat_id` | string | Normalized WhatsApp chat id |
| `channel` | string | Always `"WhatsApp"` currently — SMS is explicitly out of scope (OpenWA is the only wired-up channel) |
| `trigger_type` | string | `loan_sanction`, `payment`, `closure`, `auction_notice`, `reminder`, `otp`, … |
| `message_body` | text | |
| `related_entity_type` | string | e.g. `loan`, `reminder`, `auction_record`, `employee` |
| `related_entity_id` | uint | |
| `status` | string | `sent` \| `failed` |
| `error_message` | string | Populated when `status = failed` |
| `triggered_by_employee_id` | uint, nullable | Null for self-triggered sends (e.g. OTP) |
| `created_at` | timestamp | Send time — this is what the report surfaces as `sentAt` |

## Uploads API (`/api/v1/uploads`)
**Migrated to the response envelope** (see "Response envelope migration"
above) — success now returns `{"success": true, "data": {"url": "..."}}`
instead of a bare `{"url": "..."}`. Every caller (web's `apiUpload`, the
staff mobile app's `FileSystem.uploadAsync`-based `uploadFile`) has been
updated to unwrap the new shape.

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
