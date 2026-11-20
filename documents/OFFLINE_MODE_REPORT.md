# Offline mode (Windows exe): what works and what does not

Written from the code as it stands, plus a scan of every write function in the frontend services (117 of them:
20 can be queued, 97 cannot). Nothing here has been run in the packaged exe, so treat it as intended behaviour.

## How offline mode works, in one paragraph

A save goes into the outbox of the PC's SQLite database (`offline.db`) and the local copy is updated in the same transaction. A sender sends the
oldest line first, right after a save and every minute. The server saying "saved" or "already have it" deletes the
line; no answer keeps it. A refusal (a rule the server enforces) moves that entry to the admin review list (Settings > Offline Review) with the server's reason; if the screen is still waiting, it is dropped and the message is shown there instead.
Reads are answered from the PC when the server does not answer: loans, customers and the loan
ledger from the local copy, everything else from the last answer the PC saw.

## 1. Works offline (writes that are queued)

| Area | Function | What the screen shows meanwhile |
|---|---|---|
| Loans | create loan (`createLoan`) | Loan appears in the list as "Pending" |
| Loans | verify / approve / disburse (`approveLoan`) | Stage moves on at once |
| Loans | record payment (`recordPayment`) | Payment shows on the loan and ledger; balances are approximate until synced |
| Loans | edit loan: principal, scheme, photo (`updateLoan`) | Shown at once |
| Loans | edit ornaments (`addOrnament`, `updateOrnament`, `deleteOrnament`, `addOrnamentImage`) | Loan shows the old ornaments until synced. Not possible for a loan the server has not seen yet |
| Loans | delete loan (`hardDeleteLoan`) | Removed from the list. A loan never synced just cancels its waiting entries. A synced loan is deleted on the server when the PC reconnects |
| Loans | extension request, release request, bank re-pledge | Request appears in lists only after sync |
| Customers | create customer (`createCustomer`), with photos | Appears at once; no customer code until synced |
| Schemes | create scheme (`createScheme`) | Listed at once, usable by a new loan |
| Cash | add cash (`createCashMovement`), expense (`createExpense`) | Counted in cash in hand, bank balances and the cash ledger |
| Cash | new category (`createCashSource`, `createExpenseCategory`, `createCategory`) | Listed in its own form's dropdown |
| Sign-in | sign in again as a user who signed in on this PC before | Needs one online sign-in first |

## 2. Does NOT work offline (writes, "Couldn't reach the server")

These are sent straight to the server and fail with no queue.

- **Money and cash:** self transfer, edit a cash entry (`updateMovementEntry`, `saveEntryEdit`), change a loan cash source
  status, approve or reject an expense, gold sale.
- **Loan workflow:** loan top-up and its approval, void or release a bank pledge, complete release, release payment and
  checklist, approve or decide extension and release requests, all auction steps (eligible, notice, schedule, sale,
  settle, decision), purity test, loan drafts (save, update, delete), e-sign start and status, bond preview PDF.
- **Customers:** edit, delete, hard delete, PAN and Aadhaar verification.
- **Personal loans:** create, approve, payment, renewal, renewal preview.
- **Investments:** create plan or investment, edit plan, pay payout, mature, add cash, withdraw, pay interest.
- **Setup and admin:** edit or delete a scheme, publish gold rate, banks (create, edit, delete, merge), branches,
  employees, lockers, ornament types, purity standards, roles, permissions, approval workflow settings, business
  profile, API keys, WhatsApp, packet movement, reminders (create, edit, complete, delete), billing, QR login, demo reset.
- **Sign-in:** first sign-in on a PC, forgot or reset password, sign in as a user not seen on this PC before.
- **Documents:** every print, PDF, statement, export, receipt and e-sign. Documents for a loan the server has not
  numbered yet are blocked on purpose.

## 3. Reads (tables and pages)

| Page or table | Offline behaviour |
|---|---|
| Loans list, loan detail, loan ledger | From the local copy. The ledger is rebuilt on the PC (disbursal, interest to date, payments); server dated interest rows, top-ups and auctions are missing |
| Customers list, customer detail, customer loans, ornaments, payments, bank pledges | From the local copy. Auction history is always empty offline |
| Customer search and pickers | From the local copy |
| Schemes, gold rates, reminders, banks, branches, approval chain, business profile, ornament types, purity, roles, categories, lockers, packets (with details and movements), role permission tables, extension and release requests | Last answer the PC saw, fetched after sign-in and every 10 minutes. A filter the server would apply (other than status, type, search, page) is not repeated, so a filtered list can show more than the server would |
| Cash summary, cash ledger, bank balances | Last answer plus the entries waiting to be sent. The cash Mode ledger page and party ledgers do not include waiting entries |
| Dashboard figures, reports, risk and aging, audit log, auction pages, personal loans, investments, calendar events | Only if the page was opened online before. Otherwise empty or "Couldn't reach the server" |
| Anything not opened online first and not in the warm-up list | Not available |
| Documents, PDFs, exports, statements, e-sign | Never available offline |

## 4. Limits that apply to what does work

- **Sensitive data on disk.** Loans, customers and the cached lists are rows in `offline.db`, readable by anyone who can open the Windows user's
  profile folder. Only the device key, saved sign-ins and queued photos are protected (Windows DPAPI).
- **Refusals.** A queued entry the server refuses (for example cash that is no longer enough) goes to Settings > Offline
  Review with the server's reason, and its record shows "needs review". An admin retries or discards it. Later entries on the
  same record wait behind it; entries on other records are sent as normal. The existing files from the first build are
  imported into the database on first start and kept beside it as `*.imported`.
- **Gold rate.** A loan cannot be created offline if today's rate was not published before going offline.
- **Sign-in.** The saved sign-in lasts as long as its token (7 days). A password changed or a user switched off on the
  server still works on that PC until its next online sign-in.
- **Pending loans.** Shown as "Pending" until synced; documents blocked.
- **New category.** A loan or expense cannot be recorded against a category created offline until it has synced.
- **Roles and permissions.** Viewable offline, never changeable offline.

## 5. Database objects added for offline mode

| Object | Purpose | State |
|---|---|---|
| `loans.uuid`, `customers.uuid`, `schemes.uuid` | The id a PC gives a record before the server numbers it | In use (migrations 0055, 0057) |
| `sync_receipts` | Remembers each entry sent, so a resend is answered with the first reply | In use |
| `devices` | Registered PCs and their signing keys | In use (migration 0056) |
| `sync_flags`, `sync_aliases` | Were for manager flags and merged-customer ids | Created by 0055, not used by any code now |

Routes added: `GET /sync/pull` (branch-scoped changes since a cursor), `POST /devices` (register a PC). Queued requests
are signed with the PC's key and carry `X-Client-Uuid` and `X-Occurred-At`.

## 6. Where to take it next

Largest gaps by likely daily use: publish gold rate, reminders, top-ups, bank pledge release, personal loans,
customer edit, packet movements, auction steps. Each can follow the pattern in `common/offline/` and the queued
functions above; none needs backend changes beyond the existing uuid addressing.
