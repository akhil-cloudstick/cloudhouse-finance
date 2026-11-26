# CTFI bug audit — what still needs fixing vs. what needs checking

Audited 2026-10-31 on branch `adithyan-productV2`. Two QA sheets: **WEB** (Bug_001–130) and **MOBILE** (M001–M036).

## How reliable this is
- Method: static code reading per bug, plus git history. **Nothing was run in a browser or on a device.**
- Two passes. Pass 1 audited every bug. Pass 2 (after you said many may already be fixed) re-checked every item I had marked Open, with checkers told to try to prove it was already fixed. Pass 2 moved several items to Fixed/Partial (listed in Part 4 and noted inline). Everything still marked Open survived that challenge, with the code line cited.
- Hand-verified by me in code: web 120, 036 (see 1.2), and the reminder function behind 124/125/126 and M032–M034.
- Still static analysis: a bug can look open in code yet be masked at runtime (e.g. 036 only shows if a pending loan's due date is near or past). Part 2 lists what to click to settle those.
- "Sheet Closed" in the web sheet (Status 2) was not trusted blindly. A few Closed items are listed under Verify.

## Tally
| | Web (130) | Mobile (36) |
|---|---|---|
| Fixed in code | ~45 | 6 |
| Partial | ~19 | 8 |
| Open | ~42 | 18 |
| Verify by hand | ~20 | 4 |

Paths: `BE` = `backend/modules/<Module>/controllers`, `FE` = `frontend/modules`, `MO` = `mobile/admin/src/modules`.

---

# PART 1 — MUST FIX (ordered by priority)

## P0 — Security / data integrity

### 1.1 Branch authorization on loan routes (web 120) — security
Confirmed. An Accountant of branch A can read or write branch B's loan by id or loan number.
- `GetLoanByNumber` (`BE/Loan/controllers/loan.go:1518`) calls `getByLoanNumber` with no branch check. The loan detail page uses this route, so it is a **read** hole.
- No `checkLoanBranch` call (helper at `loan.go:528`) in: `RecordLoanPayment` (`payment.go:687`), `ApproveLoan` (`approval.go:265`), `TopUpLoan` (`topup.go:467`), `UpdateLoan` (`loan.go:1527`), `CreateExtensionRequest`, `CreateReleaseRequest` (the request-creation handlers; later steps already check), ornament add/update/delete/image/purity routes, `ListApprovals`, `ListTopUps`, `ApproveTopUp`, pledge-slip and indemnity-bond routes (the last few unconfirmed).
- Fix: call `checkLoanBranch(ctx, id, auth.GetBranchScope(c))` first in each handler. Resolve ornament and top-up ids to their loan first. For by-number, load the loan then compare branch. Or use one router-level guard on `/loans/:id/*`.
- Add a Go test: a non-cross-branch role hits each route against another branch's loan and expects 404.
- Already fine: list endpoints, reports (`NarrowBranch`), release/extension/auction/pledge/ledger-edit routes.
- Related, not on the sheet: `UpdatePermissions` (`common/controllers/authz.go` ~580) lets any role holding `can update role` grant any permission, including `can view all branches`. Raise it with the owner and decide.

### 1.2 Accounting correctness
- **Web 036 / M025 — pending-approval loans. PARTIALLY fixed.**
  - The **Active** list is correct (stored status only). The gap is **Due Soon / Overdue**: `enrichStatusFlags` (`BE/Loan/controllers/accrual.go:820-836`) skips Closed/Rejected/Auctioned but not Pending Approval; `notDefaultableStatuses` (`loan.go:36`) and `servicing_filter.go:50-64` don't exclude it; `DashboardPage.tsx:158-159` excludes only Active/Auction statuses. A pending loan is created with `DueDate = input` (`loan.go:377`, validated only as after `OpenedDate`), so it appears in those lists only when its due date is near or past (e.g. backdated loans). Quick check in Part 2.
  - `SaveLoanPayment` (`payment.go:365+`) has **no Pending Approval guard**, so payments can be collected on an unapproved loan from web and mobile.
  - Fix: exclude `StatusPendingApproval` in both places and add a server-side 400 on payment.
- **Web 049 — status on due date.** `accrual.go:825-828` and `loan.go:1000` use `asOf.After(DueDate)` with a timestamp, so on the due date the loan shows "0d overdue". Compare calendar dates (start of day) in `enrichStatusFlags`, `normalStatusFor`, `refreshServicingStatus`, and check the SQL in `servicing_filter.go`.
- **Web 050 — bank-pledged gold must not be auctionable.** `SaveAuctionEligibility` (`auction.go:275-318`), notice, schedule and sale never check `BankPledgeStatus`. Block them when "Bank Pledged". Add a "Defaulted – awaiting gold release" category in `servicing_filter.go` and `LoansPage` `CATS`.
- **Web 072 + 073 — Auctioned loans.** Release/extension are still offered (`LoanDetailPage.tsx:365,1141,1146`, `SelectLoanForRequestModalContent.tsx:24`) and `SaveReleaseRequest` (`release.go:110`) / `extension.go:61` don't reject them. Add Auctioned (and balance-due) to the exclusions in the UI and the backend. Add "Auctioned" to `LoansPage.tsx:27` `CATS`.
- **Web 081 — unapproved loan packets in lockers.** `loan.go:439` creates the packet and assigns a locker at creation. `RecordPacketMovement` (`Packet/controllers/packet.go:543`) doesn't block Pending Approval. Defer locker placement to approval, or reject check-in while pending.
- **Web 045 + 047 — closing date.** `Loan` has no closed date. Add `ClosedAt`, set it on close, expose it, show it for Closed loans (047). Use it, or the release request date, as `ReturnedDate` in `release_agreement.go:267` (currently `time.Now()`, so the agreement carries the print date).
- **Web 053 — multiple branches per bank.** `FindBankOrCreate` (`common/controllers/bank.go:126-133`) and `updateBank:286` enforce unique name only. Make uniqueness `(name, branch)`.
- **Web 118 — locker capacity.** `updateLocker` (`Locker/controllers/locker.go:265-290`) allows capacity below stored packets. Reject using `CountActivePackets` (`Packet/controllers/packet.go:234`).
- **Web 070 — packet not set to Bank Pledged (re-pledge only).** First pledge works. After a release the packet is `Returned` (`packet.go:401-404`) and `allowedTransitions` (`packet.go:30-32`) only allows Returned → Locker Stored/Released, so re-pledge fails silently (error only logged, `bank_pledge.go:203-205`). Allow Returned/Packet Generated → Bank Pledged or surface the error.
- **Web 078 — auction remarks.** Remarks go only to the auction event. Pass them to `RecordAuctionSurplusCashOut` (`Cash/controllers/movement.go:950`) and decide if "kept as income" needs a ledger row.
- **Web 088 — partial surplus.** `settleAuction` (`auction.go:621-690`) is all-or-nothing. Add `refund_amount` to the request and the `AuctionRecord`, split into refund plus income, update `SettleAuctionModalContent.tsx:106` and the edit paths.
- **Web 067 — Renewed filter.** Renewed personal loans are stored as Closed with `RenewedToLoanID` (`PersonalLoan/controllers/personal_loan.go:893`), so the filter never matches. Map "Renewed" to `renewed_to_loan_id IS NOT NULL` in `findPersonalLoans:1022`. Also check the "Defaulted" option there.
- **Web 102 — Missed status (web only; mobile already shows "Missed", `PersonalLoansScreen.tsx:525`).** Web `PersonalLoanDetailPage.tsx:440` still shows the stored status. Cheapest: change the display label only. Renaming the stored value touches `ledger_edit.go` and `penal.go`.
- **Web 091 — customer delete warning.** Modal (`CustomerDetailPage.tsx:380-440`) and `customer_hard_delete.go:31` only know gold loans. Add personal loans and investments.
- **Web 063 — delete category.** `Cash/routers/category.go` has no DELETE. Add endpoint (block or archive if in use), service functions, UI.
- **Web 083 — personal loan delete.** Only payment delete exists (`PersonalLoan/routers/personal_loan.go:25`). Add endpoint with ledger/cash reversal, UI action, and a date filter.

## P1 — Visible functional bugs

### 1.3 Reminders — one backend change fixes web 117, 124, 125, 126 and mobile M020, M032, M033, M034 (+M018)
All in `backend/modules/Reminder/controllers/reminder.go`.
- `monthlyOccurrences` (line 481) has no upper bound: interest reminders keep appearing after `DueDate` (124 / M032). Clamp to the due date.
- The same function steps with `AddDate(0,1,0)` from a day-30 cursor, so February is skipped and the day drifts afterwards (126 / M034). Compute each month from `(year, month+i)` with `day = min(anchor, lastDayOfMonth)`.
- `getCalendarEvents` (~line 392) calls `findReminders` with no status filter, so Done reminders stay (117 / 125 / M033, and the blue dots of M018). Exclude Done/Cancelled. The dashboard "Upcoming Reminders" uses the same endpoint.
- Lines 341-380 emit one overdue event per missed installment (M020, web-side equivalent too). Emit one per personal loan.
- UI-only leftovers: quick month/year picker on web (127, `CalendarPage.tsx:~213`) and mobile (M035, `RemindersScreen.tsx:107-119`); upcoming reminder rows clickable (128, `DashboardPage.tsx:455-462`). (M008 mobile calendar: cells are square and scale with width, so height varies only by row count; confirm with QA before changing.)

### 1.4 Search (web 004, mobile M005, M007)
- Substring `ILIKE '%q%'` in: `common/controllers/customer.go:183-184`, `BE/Loan/controllers/loan.go:1253-1259`, `common/controllers/scheme.go:97-98`. The scheme search also casts `interest_rate`, `ltv_percent`, `duration_months` to text, which is why "8" returns unrelated schemes.
- Fix: for digit-only terms use prefix match on code, phone, loan number. Drop the numeric columns from scheme search.
- Mobile: "All" scope in `SearchModal.tsx:21,36-52` queries loans only. Fan out to customers, loans, schemes. Add the clear (X) button (M023) in `SearchInput.tsx` and `SearchModal.tsx`.

### 1.5 Web 130 / 104 — page auto-scrolls every 20s (high confidence)
Chain: `LoanDetailPage.tsx:348-352` polls `load(true)` every 20s → `setLoan(newObject)` (`:252`) → ledger refetch effect (`:298-330`) → `useLedgerFocus("loan-ledger", …, [ledger])` (`:182`) → `scrollIntoView` (`use-ledger-focus.ts:~177`).
Fix: apply the focus once per arrival, skip ledger refetch on background polls, or only `setLoan` when the payload changed.

### 1.6 Export PDFs — web 108, 109, 112, 113, 114, 115 (one fix)
`ExportReport` (`Reports/controllers/export.go:82-136`) reflects over row structs, so headers are raw json tags and values are internal ids. Replace with per-report column definitions mirroring `REPORT_CONFIGS` (display labels and codes like `LN-…`). Drop id columns. **Needs a decision:** payment id and employee id display formats don't exist in the repo. Side bug: `dropColumn(..., "branchName")` (`export.go:~437`) never matches snake_case headers. Rename "#" to "Installment #" (`ReportsPage.tsx:455`).

### 1.7 Web: rest of the Open list
| Bug | What to do | Where |
|---|---|---|
| 001 | Add PAN regex and Aadhaar-exactly-12 checks in `save()`; block digits in Nominee Name/Relation; "Father's Name" → "Guardian Name" at end of Additional Info; same in Edit modal; add server-side validation | `common/components/modals/RegisterCustomerModalContent.tsx:109-130,216-237`, `EditCustomerModalContent.tsx`, `common/controllers/customer.go` |
| 002 | Monthly-interest preview on New Loan (principal × rate / 100 / 12) | `FE/loans/pages/NewLoanPage.tsx` |
| 013 | Remarks removed from the rate modal in d5f2ef6c; decide whether to restore and show them | `RateModalContent.tsx`, `gold_rate.go` |
| 040 | Add "Closure Requested" to `CATS`; hide Record Payment when nothing is owed | `LoansPage.tsx:27`, `LoanDetailPage.tsx:365,1109` |
| 042 | Letter button only shows for Auctioned/Settled; must show at notice-issued. (Stepper already starts at Defaulted: fixed) | `AuctionsPage.tsx:261-262` |
| 046 | One Release Agreement menu item plus language picker (reuse `EsignLanguageModalContent`) | `LoanDetailPage.tsx:1303-1308`, `RequestsPage.tsx` |
| 056 | Card-specific `extraFilter` for ~20 reports plus backend params | `ReportsPage.tsx`, `ReportView.tsx:141-152` |
| 060 | Show/edit Additional Information on loan details; escape the unescaped interpolation at `LoanDetailPage.tsx:759` | `LoanDetailPage.tsx`, `EditLoanModalContent.tsx` |
| 062 | "Net proceeds" column and surplus disposition in auction history | `AuctionsPage.tsx:544-566` |
| 066, 094 | `FilterPanel` plus backend params for Expense register, Gold sales, Bank Repledge, Employees, Banks | `CashPage.tsx:70-137`, `BankPledgePage.tsx`, `EmployeesPage.tsx`, `BanksPage.tsx` |
| 069 | Live "Balance after payment" | `PersonalLoans/.../CollectPaymentModalContent.tsx:76` |
| 074 | English release template contains Malayalam (lines 43-44) | `backend/templates/kml_release_agreement_english.html` |
| 082, 103 | Per-field errors in remaining modals; collect all errors instead of returning on the first | `EditEntryModalContent`, `ExtensionReviewModalContent`, `IssueNoticeModalContent`, `AddEntryModalContent`; ~129 `fail(` sites |
| 085 | Only the two dashboard KPI tiles remain (Needs-Attention "Open" already lands on Pending): link with status=Pending and type | `DashboardPage.tsx:316-317`, `RequestsPage.tsx:58-59` |
| 087 | Date selector for cash summary; use a local date, not `toISOString()` (wrong day in IST before ~05:30) | `CashPage.tsx:79,260` |
| 089 | Remaining only: date filter, plan search, digits-only account number (153), whole-investment delete. Done already: search, close, ledger delete, investor picker | `InvestmentsPage.tsx`, `InvestmentPlansModalContent.tsx`, `CreateInvestorModalContent.tsx:153` |
| 093 | Date filter on Requests, Personal Loans, Investments | pages plus backend list handlers |
| 097 / M014 | Status filter on schemes | `SchemesPage.tsx:38-45`, `scheme.go:85-106,495-515` |
| 098 | Persist page number (`usePersistedState`) | `LoansPage.tsx:76`, `CustomersPage.tsx:55`, other lists |
| 101 | "Go to page" in the shared pager | `PageBar.tsx`, `Pager.tsx` |
| 105 | `table-layout: fixed` on main tables | `app.css:4353` |
| 110 | Report default to Active/Due soon/Overdue/Defaulted/Closed; export must honour status | `reports.go:207`, `export.go:34` |
| 111 | Add `tbl-center` | `ReportView.tsx:239`, `RequestsPage.tsx:179`, `BankPledgePage.tsx:240,290`, `BankTable.tsx:127` |
| 123 | Focus the modal on open, lock body scroll | `ModalProvider.tsx:95-113` |
| 008 | Expense-approval Review button goes to generic ledger (decide if it should deep-link) | `DashboardPage.tsx:353` |

## P2 — Mobile-only open items
| Bug | What to do | Where |
|---|---|---|
| M003 | Only the missing-required-field hint remains (per-ornament photos exist) | `CreateLoanSheet.tsx:169` |
| M006 | Add payment summary and balance-after block ("Both" prefill already fixed, verify on device) | `CollectPaymentSheet.tsx` |
| M009 | Move saved drafts to bottom | `CreateLoanSheet.tsx:327-345` |
| M010 | Wire tap for `personalLoanId` in reminders list and bell modal | `RemindersScreen.tsx:161`, `RemindersModal.tsx:67-75` |
| M012 | "an Auditor" article helper, pass the employee's role to the roles screen | `EmployeesScreen.tsx:226-234`, `RolesPermissionsScreen.tsx:209` |
| M013 | Convert single-select chips to `GroupedFilter` (Investments, Loan Risk, Requests) | `InvestmentsScreen.tsx:139`, `LoanRiskScreen.tsx:141`, `RequestsScreen.tsx:204` |
| M015, M036 | Stable report sheet height, spacing under filter row | `ReportsScreen.tsx:573-580,652` |
| M017 | Handle `Auctioned` status so the auction row doesn't offer "Mark Auction Eligible" | `AuctionsScreen.tsx:65,101-104,117` |
| M021 | Close detail then return to Reminders | `PersonalLoansScreen.tsx:107-170` |
| M026 | Hide Gold Release and Extend for Pending Approval | `LoanDetailScreen.tsx:532-548` |
| M027 | Rejected/Auctioned in packet filter (mobile and backend "Rejected" branch); migrate legacy packets | `PacketsScreen.tsx:51`, `packet.go:143-162` |
| M029 | New Bank Management page with net balance (backend already returns `balance`) | `banks` tab, `bank-types.ts` |
| M030 | Defaulted is derived, so report totals never count it; compute it and add filter options | `reports_loans.go:73-74`, `ReportsScreen.tsx:100` |

---

# PART 2 — MUST CHECK BY HAND (no code change until confirmed)

| Bug | Click path / what to confirm |
|---|---|
| 036 | Create a pending-approval loan with a due date within 7 days (or past); check it does not show under Due Soon/Overdue (list and dashboard tiles) |
| 007 / M031 | Compare each dashboard tile with its list count. Cash tile = cash + bank. Collections vs Cash In (₹1.3L gap): compare today's `loan_payments` against ledger credits, check non-cash modes, personal-loan/investment collections, edited payments, timezone `dayStart` (`Dashboard/controllers/summary.go:155-171`) |
| 016 | Calendar: select a day, expand a group, look for blank space |
| 018 | Approve a loan whose eligible amount has decimals |
| 026 | Sheet says Closed. No per-status counts (e.g. "Active (10)") were found. Ask QA what was meant |
| 027 | Customer → Extension/Release picker lists only approved loans? |
| 028 | Release review: discount reduces total; partial receipt shows language |
| 035 | Watch an overdue loan's interest for 1 minute (+1 paisa/20s); closed loan interest stays flat |
| 038 | Approve late, print statement, bond, slip, compare dates |
| 039 | Record payment on fractional interest, no `256644.44999999998`; fee added not deducted |
| 041 | Ledger order after a top-up |
| 048, 059, 079, 080, 086, 096 | Sheet-Closed, not re-verified. Spot check ledger balance, auction/repledge totals, date-filter balance, amount cut-off, breadcrumb, column alignment |
| 051 | Open LN 59 release agreement (probably not status Closed, or branch scope, or render error) |
| 052 | Expense chart with many categories |
| 055 | Filter: pick From then To date, panel stays open |
| 061, 071, 075, 077 | Edit scheme refreshes name/tenure/due date. Delete-repledge preview text short. Personal loan validation wording. 24K rate updates 22K/18K |
| 065, 092, 122 / M011, M028 | Tick one permission, only it (plus declared dependents) changes. Save works. Message position OK. Cascade may be intended |
| 099 | LN148 in Due Soon and Active lists |
| 100 | Ledger payment-mode chip opens correct record |
| 107 | Calendar grid stable when selecting days with 0/1/4+ events |
| 116 | Form G quick range: get QA's original note first |
| 121 | Reminder with a 300-character note |
| M001 | Keyboard behaviour on Android/iOS long forms |
| M002 | Open real KYC docs, check the `/uploads` auth if still failing |
| M016, M019, M024 | Bill in ledger, additional docs open, ledger Edit needs `can_edit_ledger_entry` |
| M022 | New loan appears in Activity after approval (pending intentionally hidden) |
| M018 | Blue dots only for custom reminders after 1.3 |

---

# PART 3 — Needs a product decision before coding
- Web 003 date format: code outputs `dd-mm-yyyy` (dashes); sheet asks `dd/mm/yyyy` "or else".
- Web 013: restore remarks on gold-rate publish?
- Web 102: rename stored status to Missed, or relabel only?
- Web 109–115: display format for payment id and employee id.
- Web 120 follow-up: block role editors from granting permissions they don't hold?
- M030: is the intent "show Defaulted" or "show only Active/Closed/Overdue"? (conflicts with web 110.)
- M-Extra: "Applicable conditions – create scheme" has no clear defect. Ask QA. The "auction administrator can do" note is covered by M012.

---

# PART 4 — Already fixed (code evidence found; no action)
Web: 003*, 005, 006, 007, 009, 010, 011, 012, 014, 015, 017, 019, 020, 021, 022, 023, 024, 025, 029, 030, 031, 032, 033, 034, 037, 043, 054, 057, 058, 064, 068, 076, 084, 090, 095, 106, 119, 129. (*see Part 3.) Partly fixed (only the remainder is in Part 1): 036 (Active list ok), 042 (stepper ok), 070 (first pledge ok), 085 (Open buttons ok), 089 (most ok), 102 (mobile ok).
Mobile: M002, M004, M011, M016, M019, M024, M028 (code fixed; device check in Part 2). Partly fixed: M003 (photos ok), M006 ("Both" prefill ok), M027 (backend Auctioned ok), M008 (see 1.3 note).

---

# Suggested execution order
1. 1.1 branch authorization plus tests (security).
2. 1.3 reminders (one Go file, closes 8 bugs across web and mobile).
3. 1.2 accounting guards (036/M025, 049, 050, 072/073, 081, 045/047).
4. 1.4 search, 1.5 auto-scroll, 1.6 export.
5. Web medium list (1.7), then mobile (P2).
6. Run Part 2 manual checks with QA; resolve Part 3 decisions in parallel.

# Verification
- Backend: `go build ./...`, `go vet ./...`, `go test ./...` (in `backend/`). New tests: cross-branch 404s on each loan route; `monthlyOccurrences` for day 30/31 across February and due-date cap; status on due date; payment on Pending Approval rejected.
- Web: `npm run build` / lint in `frontend/`, then manual walk of each fixed bug's steps from the sheet.
- Mobile: type-check, then run on a device for M001, M002, M006, M021.
- Report back to QA per bug ID with a re-test note.
