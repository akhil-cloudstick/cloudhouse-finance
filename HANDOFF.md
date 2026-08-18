# Ambika Gold Finance — Customer Mobile App Handoff

Paste this file's contents into a new Claude session to resume work with full context.

## Goal

Build an Android-only customer-facing mobile app (separate from the existing staff `mobile/` app) so borrowers can self-serve: check loan/gold/outstanding details, pay interest/settle online, request extensions/gold release, view live gold rates, and (eventually) get reminders/notifications/documents/KYC self-service — without going through branch staff for everything.

Full feature brief was decomposed into **batches**, each planned and implemented in its own pass (plan → approve → build → verify) rather than one giant build. The plan file with full wireframes for every batch lives at:
`.claude/plans/customer-mobile-application-features-cryptic-meadow.md` (may not survive between sessions — this handoff is the durable record).

## Repo layout addition

```
gold-app/
  customer-mobile/        ← NEW Expo (React Native, expo-router) app, Android-only
    app/
      _layout.tsx          ← fonts, cold-start bootstrap (device-token+biometric -> session -> OTP)
      (auth)/login.tsx      ← phone -> OTP two-step login, device registration
      (tabs)/
        _layout.tsx         ← Tabs (expo-router/js-tabs) + custom AppTabBar, 5 tabs
        index.tsx           ← Dashboard: gold rate widget+modal, notif bell, logout button
        loans.tsx           ← My Loans list: filter chips (server-side), FlatList paginated
        payments.tsx        ← Payments tab: pay-a-loan picker, payment history + receipts
        documents.tsx        ← ComingSoon stub (not yet built)
        more.tsx             ← ComingSoon stub (not yet built)
      loan/
        _layout.tsx          ← bare Stack (top-level, NOT nested under tabs)
        [id].tsx             ← Loan Detail: gold/outstanding/requests/pay, all sections
    src/
      theme/{colors,typography}.ts, ThemeProvider.tsx   ← ported from mobile/, identical values
      components/            ← Card, ThemedText, GoldButton, GoldTextInput, ScreenContainer,
                                BottomSheetModal+sheetHost, Icon, FloatingHeader, AppTabBar,
                                ComingSoon, ChipSelect, PaySheet (shared pay UI)
      api/                    ← client.ts (apiRequest/ApiError), config.ts, auth.ts, goldRate.ts,
                                loans.ts, payments.ts — one file per backend resource, typed
      auth/                   ← tokenStorage.ts, deviceToken.ts (both SecureStore), AuthContext.tsx
      types/                  ← customer.ts
```

Linked to an existing EAS project: slug `ambikacustomer`, owner `cloudhouse-team`, id `1fb4bd03-4939-4a9e-9142-c26294cdedbb`.

## Backend additions (`backend/`)

All new customer-facing surface lives under `/api/v1/customer/*`, protected by a **new**, fully separate `CustomerAuthMiddleware` (parallel to the staff `AuthMiddleware`) validating a distinct `type: "customer"` JWT — customer tokens can never call staff routes and vice versa.

- **`internal/customerauth/`** (new package) — OTP request/verify (delivered via WhatsApp/OpenWA only, reusing `internal/platform/whatsapp.go` — no SMS), device registration + biometric device-login, session refresh. New tables: `customer_otp`, `customer_device_tokens`.
- **`internal/platform/jwt.go`** — added `CustomerClaims`, `IssueCustomerToken`, `ParseCustomerToken`, fully separate from the employee JWT scheme.
- **`internal/loan/`** — extended (not duplicated) for customer use:
  - Extension requests now go through the **same 3-stage approval chain machinery already proven for Release requests** (`ApprovalStage` + `RequestApproval`): Loan Officer → Branch Manager → Management. New stage constants added to `model.go`; `Service.ApproveExtensionRequest` mirrors the existing `ApproveReleaseRequest`; `POST /loans/requests/:requestId/approve` is now generalized to dispatch by request type (Extension vs Release) instead of assuming Release only. The old single-step `DecideRequest` now errors for Extension-type requests.
  - `internal/loan/customer_handler.go` (new) — all customer-scoped, ownership-checked (404, not 403, on mismatch) routes: list/get loans, list requests, create extension/release request, Razorpay order/verify, per-loan and global payment history, payment receipt PDF.
  - `internal/platform/razorpay.go` (new) — `RazorpayClient`, order creation (Basic Auth), HMAC-SHA256 signature verification — mirrors the existing `setu.go` external-client pattern.
  - `LoanPayment.ReceivedByEmployeeID` changed from `uint` to `*uint` (nullable) — a customer-initiated online payment has no staff actor. **Confirmed via a live migration run that GORM's `AutoMigrate` does NOT relax an existing `NOT NULL` constraint on its own** — an explicit `ALTER TABLE loan_payments ALTER COLUMN received_by_employee_id DROP NOT NULL` step was added to `cmd/migrate/main.go` and verified to take effect.
  - Online payments call the **same** `Service.RecordPayment`/`allocatePayment` waterfall (processing fee → penal interest → interest → principal) that staff-recorded cash payments use — no new allocation logic, just `Method: "Online"`, `Reference: <razorpay_payment_id>`.
- **`documents/api_documentation.md`** kept in sync after every batch — has sections for Customer App Authentication, Gold Rate, Loan, and Payments APIs.

## Batches completed

### Batch 1 — Bottom nav, Login, Dashboard, Gold Rates
- App shell: 5-tab bottom nav (Home real, My Loans/Payments/Documents/More stubbed with `ComingSoon` until their batch).
- Login: phone → OTP (WhatsApp/OpenWA delivery only) → **mandatory** biometric device registration (never blocks sign-in if the device lacks biometric hardware — falls back to OTP every time, by design, not a dead end).
- Cold start: device token + biometric → device-login (server-validated, not just local unlock) → else session token → refresh → else OTP screen.
- Dashboard: gold rate widget opening a rise-up `BottomSheetModal` with current + history (not a separate screen/tab), notification bell → `ComingSoon` modal (also not a route).

### Batch 2 — My Loans + Loan Detail
- My Loans list: filter chips (All/Active/Due Soon/Overdue/Closed) — **each chip tap is its own server-side API call** (`GET /customer/loans?status=X`), never client-side filtering of one fetched list. Paginated `FlatList`, pull-to-refresh.
- Loan Detail (`app/loan/[id].tsx`, a real pushed stack route with a working back chevron — not nested under the tabs group, since `FloatingHeader`'s back-chevron logic needs an actual `Stack`): Loan Details, Pledged Gold, Outstanding, a conditional Requests timeline card (3-stage for Extension, 2-stage for Release, ✓/✗/⏳/○ per stage), and Extension/Release request bottom-sheet forms.
- A "Pay" button was added to the layout in this batch as a stub (`ComingSoon` sheet) specifically so the button pattern for the whole screen was final before Batch 3 wired it up for real.
- **Known simplification**: a rejected request's timeline can't pinpoint exactly which stage rejected it (no per-approval detail exposed yet) — approximates by marking everything up to the last-known pending stage as rejected.
- **Staff-side UI for approving these Extension/Release chain stages does not exist anywhere yet** (backend supports it via `POST /loans/requests/:requestId/approve`; no staff mobile/web screen calls it) — flagged as a real gap, testable only via direct API calls until a future batch/admin UI addresses it.

### Batch 3 — Razorpay Setup + Payments
- Real Pay flow replacing the Batch 2 stub: customer **types the amount manually** (no quick-select chips) — payment `type` sent to the backend is inferred purely from the typed amount (exact match to outstanding interest → `Interest`; exact match to settlement figure → `FullSettlement`; anything else → `Partial`), but the existing waterfall logic is what actually decides fee/interest/principal allocation — no new allocation logic was needed.
- New shared `src/components/PaySheet.tsx` used by both Loan Detail and the Payments tab.
- Payments tab: pay-a-loan picker (a minimal inline bottom-sheet picker was built — no `SearchableSelect`-style component existed yet in this app) + paginated payment history with a working PDF receipt download/print per row (pulled forward from the deferred Documents batch, scoped tightly to payment receipts only — full loan *statements* remain deferred).
- Dashboard logout button added (small addition bundled into this batch) — confirms via `Alert.alert`, calls `AuthContext.signOut()` (already correctly cleared both session and device tokens — no fix needed there).
- **`react-native-razorpay` requires a dev-client build — it will NOT run in Expo Go**, same constraint as `expo-local-authentication` from Batch 1. Testing this batch's payment flow requires `expo run:android` or an EAS dev build, not the plain Expo Go app.
- `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are plain env vars in `backend/.env` (not the encrypted `internal/settings` table) — user is adding these themselves with Razorpay test-mode keys.
- **Later fix — dual-path checkout so Expo Go works too**: `src/components/PaySheet.tsx` now checks `NativeModules.RNRazorpayCheckout` at runtime and picks one of two paths automatically, no user-facing toggle: **Solution B** (native `RazorpayCheckout.open()`, unchanged) when the module is linked (a dev-client build), or **Solution A** — a new `src/components/RazorpayWebCheckout.tsx` that loads Razorpay's own hosted Web Checkout script (`checkout.razorpay.com/v1/checkout.js`) inside a `react-native-webview` `WebView` (new dependency — ships in Expo Go by default, no native linking needed) and bridges its `handler`/`modal.ondismiss`/`payment.failed` callbacks back via `postMessage` — when it isn't. Both paths converge on the same `verifyAndFinish` call, so the backend/allocation side is untouched either way.

### Batch 4 — Profile & KYC
- `GET /api/v1/customer/profile` — the authenticated customer's own full profile (`CustomerResponse` shape). No `:id` on any route in this batch: a customer has exactly one `Customer` row, and its ID *is* `customerId` from the JWT, so there's no ownership-check surface at all (simpler than the loan pattern, not a weaker copy of it).
- **Customer-triggered PAN/Aadhaar verification** — `POST /customer/profile/verify-pan` and `POST/GET /customer/profile/aadhaar/{start,status}` reuse the exact staff-side `internal/customer.Service.VerifyPAN`/`StartAadhaarVerify`/`CheckAadhaarVerify` methods (same Setu/DigiLocker calls staff use), just called with `branchID=nil` and `customerID` from the JWT. New file `backend/internal/customer/customer_mobile_handler.go`.
- Mobile: new `app/profile/` top-level stack route (mirrors `app/loan/[id].tsx`'s pattern) — fully **view-only** identity/nominee sections, plus a KYC Verification card with tappable "Verify" actions for PAN (inline, no navigation) and Aadhaar (opens DigiLocker via `expo-web-browser`'s `openAuthSessionAsync`, then polls `aadhaar/status` in a `BottomSheetModal` "Verifying…" sheet). No editing of any field in this batch.
- `FloatingHeader`'s avatar is no longer a static placeholder — tapping it opens a dropdown (`customer.name` + "Profile" + "Log out"), mirroring the staff app's header menu. The Batch 3 Dashboard-only standalone logout icon (`onLogoutPress` prop) was removed/consolidated into this dropdown so logout isn't duplicated.
- `AuthContext.tsx` gained `refreshProfile()` (calls the new `GET /customer/profile`) — wired into `app/_layout.tsx`'s cold-start bootstrap on the **session-token-refresh** path, which previously left `customer` null (only `markAuthenticated()` ran there); the device-login/biometric path already had a customer object but calls it too, non-blocking, for freshness.
- New dependency: `expo-web-browser` (works in plain Expo Go, unlike Razorpay/biometric — no dev-client build needed just for this batch's flows).
- **Note**: this is unrelated to the Aadhaar **eSign** flow (`setu_esign.go`, used for indemnity bonds) — that's still blocked on Setu's side, untouched by this batch.

### Batch 5 — Documents + More
- `GET /api/v1/customer/loans/:id/statement` — a per-loan statement PDF (summary header + every payment ever recorded against the loan), reusing the exact gofpdf pattern from Batch 3's payment-receipt PDF (`renderPaymentReceiptPDF` → new sibling `renderLoanStatementPDF`, same file `backend/internal/loan/customer_handler.go`). Handles the zero-payments case with a plain "No payments recorded yet" line instead of an empty table.
- Mobile: `app/(tabs)/documents.tsx` replaces its `ComingSoon` stub — a loan picker (reusing the Payments tab's exact picker UI) + "Download Statement" (same download-then-print/share pattern as the Batch 3 receipt download), plus a read-only "My Documents" list surfacing the customer's own staff-uploaded `identityProofUrl`/`addressProofUrl`/`kycDocumentUrl` (already present on the profile fetched since Batch 4 — no new backend needed for this half). KYC document downloads skip `Print.printAsync` (uploads aren't guaranteed to be PDFs) and go straight to `Sharing.shareAsync`.
- Mobile: **the More tab is the Profile view, not a new screen.** After reviewing what was actually left to build (Documents was this batch, real Notifications needs infra not a screen, staff approval is a web-admin gap not a customer page), there was nothing distinct left to put in "More" — so `app/(tabs)/more.tsx` renders the same content as the Batch 4 `/profile` route plus a Log out button. The shared body was extracted into `customer-mobile/src/components/ProfileContent.tsx` (identity/nominee/KYC cards + PAN/Aadhaar verify logic, accepts an optional `footer` node); both `app/profile/index.tsx` (pushed route, own back-chevron header) and `app/(tabs)/more.tsx` (tab-root header + Log out footer) are now thin wrappers around it. No invented filler content (no Support/Contact, no App Version row) — deliberately cut per "don't invent scope with nothing real behind it."

### Final batch — Staff-side Extension/Release approval UI (`frontend/`)
- Fixed a real bug, not just a gap: `frontend/components/Requests.tsx`'s Extension branch was still calling the retired single-step `decideRequest` (`PUT /loans/requests/:requestId/decide`), which the backend now **always rejects with `400 ErrUseStagedExtensionApproval`** for Extension requests. Staff could not approve/reject an Extension request from the web admin at all until this batch.
- New `frontend/components/modals/ExtensionReviewModal.tsx` — mirrors `ReleaseReviewModal.tsx`'s pattern (no checklist, since that's Release-only), drives the 3-stage Loan Officer → Branch Manager → Management chain via the existing generalized `POST /loans/requests/:requestId/approve`. Uses `StageTracker` for the visual chain and role-gates Approve/Reject client-side (`useAuth()`'s `role`, Administrator bypass) to match the server's real role check.
- New `frontend/lib/loansApi.ts` export `approveExtensionRequest`/`ExtensionApprovalInput` — same endpoint as the existing `approveReleaseRequest`, just the sibling that was missing.
- `Requests.tsx`'s Review/View button now opens the right modal by request type; dead `decide()`/`deciding` state removed (Release rows never used them).
- **Noted, not fixed**: `ApproveReleaseRequest` has no server-side role gate at all (any actor with `loans:update` can approve any Release stage) — an asymmetry with Extension's real role check, pre-existing and left untouched.
- **Push notifications remain explicitly deferred** — the customer decided to finish the staff-side approval UI first; no push/FCM work has started. When picked up, note that real background push on Android fundamentally requires FCM (no local/self-hosted substitute) — the only Firebase-free alternative discussed was an in-app notification center (poll-on-foreground, no delivery while closed), not yet decided between.

### Realtime Notifications — WebSocket, ack-and-resend (no Firebase)
- The customer decided to build notifications over a **plain WebSocket instead of FCM**, explicitly accepting the tradeoff: this delivers live while the app is connected, but is **not true background push** — Android kills background sockets, so nothing arrives while the app is fully closed. The database (`notifications` table) is the source of truth; the socket is a live-delivery accelerator on top of it.
- **Delivery semantics**: a notification's `Delivered` flag flips true only when the **client acks receipt** over the socket (or via a REST fallback) — not when the server merely attempts a push. Undelivered notifications retry every 10 minutes, capped at 10 attempts, then stop retrying but stay visible in the in-app list forever (never deleted).
- **New backend**: `backend/internal/notification/` (model/repository/service/handler — durable store + REST list/ack + the `GET /customer/ws` upgrade) and `backend/internal/realtime/` (generic per-customer WebSocket connection registry, `gorilla/websocket`). Two new `time.Ticker` goroutines in `main.go` — the resend ticker (10 min) and a due/overdue scan (hourly) — are the **first scheduled/background jobs in this codebase**.
- **Event coverage — "everything"**: loan submission, every sanction-chain stage (not just final), loan sanction, every payment recorded, loan due-soon/overdue (new — the only genuinely new *trigger*, everything else reuses existing hooks), every Extension/Release request stage decision, and every auction stage transition. All wired through the existing `internal/loan/service.go`'s `notifyCustomer` helper via a new narrow `loan.CustomerNotifier` interface (same cross-package convention as `PacketCreator`/`CashRecorder`) — `notifyCustomer` was also fixed so the in-app half fires independently of whether WhatsApp is configured (previously an unconfigured WhatsApp client silently skipped everything, commlog included).
- **Bug fixed along the way**: `resolveAuctionAfterPayment`'s "payment received, auction on hold" WhatsApp message used to fire on every non-closing payment on *any* loan (not just loans with an active auction), because the guard never actually checked whether an auction record was found. Now correctly gated.
- Two new nullable `Loan` columns, `DueSoonNotifiedAt`/`OverdueNotifiedAt`, dedupe the due/overdue check per due-date value — reset to nil whenever `DueDate` changes (i.e. on extension approval), so a re-extended loan gets reminded again against its new date.
- **New mobile**: `customer-mobile/src/realtime/socket.ts` (RN global `WebSocket`, no new native dependency, exponential-backoff reconnect, auto-acks every received notification), `src/notifications/NotificationsContext.tsx` (mounted at app root alongside `AuthProvider`, opens on sign-in/closes on sign-out, backfills via REST on cold start), `src/components/NotificationList.tsx` (replaces every screen's `ComingSoon` bell-modal stub with the real live list).
- Full wire contract (message shapes, endpoints) documented in `documents/api_documentation.md`'s "Customer App Notifications API" section.

## What's NOT done yet

- **Document upload** — identity/address/KYC proof files remain staff-only to upload; the customer app can only view/download what staff already uploaded (Batch 5's Documents tab, same precedent as Batch 4's Profile).
- **Editing any profile field** (name/PAN/Aadhaar/address/nominee/DOB/photo) from the customer app — the Profile view (now shared by `/profile` and the More tab) is fully view-only; editing remains staff-only.
- **Mark-as-read / seen-state UI** — deliberately not built this batch; "delivered" (bytes reached the device) is a distinct, server-tracked concept from "seen/read," which has no UI at all yet.
- **True background push (FCM)** — not pursued; if ever revisited, would need a Firebase project + EAS push credentials, entirely separate from the WebSocket system built here.

## Gotchas hit so far

- **Filter/list conventions**: every filter on a list screen must be its own server-side API call — this was an explicit decision this session, not just a style preference; don't reintroduce client-side filtering of one fetched page.
- **Payment type string mismatch**: the Go constant for full settlement is `"Full Settlement"` (with a space); the customer API's wire format uses `"FullSettlement"`. A `normalizeRazorpayPaymentType` translation happens at the API boundary in `internal/loan/payment.go` rather than touching the shared Go constant (which staff-side code also depends on) — don't "fix" this into matching without checking both sides.
- **`indemnitybond.go` does NOT use gofpdf** (it uses chromedp + HTML rendering for multi-language legal text) — the payment receipt PDF generator instead mirrors `internal/reports/export.go`'s gofpdf pattern. If you go looking for "the PDF pattern" in this repo, there are actually two different ones for two different purposes.
- **`expo-file-system`'s SDK-57 API removed `FileSystem.downloadAsync`/`cacheDirectory`** in favor of `File.downloadFileAsync(url, destination, {headers})` + `Paths.cache` — used throughout the receipt-download code in `customer-mobile`. If upgrading Expo later, re-check this API hasn't moved again.
- **Loan Detail must be a top-level stack route** (`app/loan/[id].tsx` + `app/loan/_layout.tsx`), not nested under `(tabs)` — `FloatingHeader`'s back-chevron logic checks `navigation.getState().type === "stack"`, and tab screens pass `navigation={undefined}`. Any future pushed detail screen (payment detail, document viewer, etc.) should follow this same top-level-stack pattern, not live inside a tab.
- **Two separate Go binaries are NOT needed** to serve both apps — a single backend instance on one port serves both `/api/v1/*` (staff) and `/api/v1/customer/*` (customer) routes; don't stand up a second backend process or a second tunnel for the customer app's API traffic. (Dev-environment tunnel/networking specifics are intentionally omitted from this handoff — ask the user for current setup if needed.)

## How to run/test locally right now

```bash
# Backend (serves both staff and customer routes on one port)
cd backend
go run .

# Customer app (Expo, Android)
cd customer-mobile
npx expo start
# NOTE: react-native-razorpay and expo-local-authentication are native modules —
# a plain Expo Go install will NOT support biometric login or the Pay flow.
# Use a dev-client build (`npx expo run:android` or an EAS dev build) to test those.
```

Point `customer-mobile/.env.local`'s `EXPO_PUBLIC_API_BASE_URL` at wherever the backend is reachable from the test device (dev-environment-specific — not documented here).

## Key files worth reading first in a new session

- `.claude/plans/customer-mobile-application-features-cryptic-meadow.md` — if it still exists in this session, it has full ASCII wireframes for every screen across all 3 batches so far; this handoff is the fallback if it doesn't survive.
- `customer-mobile/src/theme/colors.ts` / `typography.ts` — the exact visual language every new screen must match (ported verbatim from the staff `mobile/` app).
- `backend/internal/loan/customer_handler.go` — every customer-facing loan/payment endpoint in one file; the pattern (ownership check → 404 on mismatch → thin wrap of existing `Service` methods) to follow for any new customer route.
- `backend/internal/loan/service.go`'s `RecordPayment`/`allocatePayment` — the payment waterfall every payment path (staff cash, customer online) ultimately goes through; don't duplicate this logic anywhere.
