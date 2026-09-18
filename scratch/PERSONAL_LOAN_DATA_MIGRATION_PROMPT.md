# Personal Loan Data Migration Prompt (for deployed server session)

Paste this into the Claude session connected to the deployed server/DB (Go + GORM backend,
`backend/internal/personalloan`, `backend/internal/cash`, `backend/internal/customer`). Field
names below match the actual Go models — use these, not a raw copy of the spreadsheet's column
headers.

**Scope of this run — personal loans only.** Source file: `GL.xlsx`, Sheet1, the "PRO-NOTE
LOAN" block (columns O–V, rows 3–27, 25 loans). The "GOLD LOAN" block (columns A–M) on the same
sheet is NOT part of this run — do not touch gold loans, their customers, or any other module's
data.

---

I need to seed personal loan data into this deployed system, driven strictly by the 25 rows in
`GL.xlsx`'s PRO-NOTE LOAN block. These are historical loans backdated back to 2022, so insert
**real rows directly into the actual tables** (`personal_loans`, `personal_loan_installments`,
`personal_loan_payments`, `personal_loan_history`, `cash_movements`, `customers`) with every
column populated exactly as `CreateLoan`/`RecordPayment` would have computed them — do not go
through the HTTP API/service layer for this seed, since `CreateLoan`/`RecordPayment` always
stamp `time.Now()` for `OpenedDate`/`DisbursedAt`/`PaidOn`/`OccurredOn`, and every one of these
loans needs its true historical date instead. Compute every derived value using the exact same
formulas the service uses (below), then write the rows with those values — the numbers must
still match what the service would have produced, only the insertion path is direct. Wrap each
loan's full set of rows (loan + installments + payments + history + cash movements) in one DB
transaction so a failure partway through never leaves a half-seeded loan. Do NOT use
`FullDisbursement` — see Step 2, interest is withheld upfront, matching the service's default
path.

## Step 1 — Clear existing data (personal loan + its cash movements ONLY)

Do NOT touch: admin users, roles, branch/branding config, gold loans, gold loan customers,
existing personal loan schemes/config, `GoldRate`, `Packet`, `Expense`, `GoldSale`, or any
`CashMovement` not tied to a personal loan.

Delete only:
- All `PersonalLoan` + `PersonalLoanInstallment` + `PersonalLoanPayment` + `PersonalLoanHistory`
  rows (table names `personal_loans`, `personal_loan_installments`, `personal_loan_payments`,
  `personal_loan_history`).
- Only the `CashMovement` rows caused by personal loan activity — i.e. rows where
  `Purpose = "Personal Loan Disbursement"` or (for payments) rows recorded by
  `RecordLoanPaymentCashIn` with `paymentType = "Personal Loan Payment"`. Identify these
  precisely (e.g. by `Purpose`/description text and `PartyCustomerID` matching a personal-loan
  customer, or by `TransactionGroupID` if these movements were tagged) — do NOT delete gold loan
  disbursement/payment cash movements, expenses, opening balances, or gold sales.
- Do NOT delete `Customer` rows in bulk — only remove a customer if (a) they exist solely
  because of a personal loan seeded in an earlier run, AND (b) they have no gold loan, no other
  personal loan, and no unrelated data referencing them. If unsure about any customer, leave them
  and just delete their personal loan record.

Reset `PersonalLoan.LoanNumber` sequencing so the next generated number starts at `PL-00001`.
`LoanNumber` is generated in `Service.CreateLoan` as `fmt.Sprintf("PL-%05d", count+1)`, where
`count` comes from `Repository.CountAll`, which does an **unscoped** count of all `PersonalLoan`
rows (including soft-deleted). Confirm whether your delete is a hard delete or soft delete
(GORM's default `Delete` on a model with `DeletedAt` is soft) — if soft, `CountAll` will keep
counting the "deleted" rows and the next `LoanNumber` will NOT restart at 1. Hard-delete
(`Unscoped().Delete(...)`) the personal loan tables in Step 1 so numbering truly resets, or tell
me if you'd rather keep soft-deleted history and accept `LoanNumber` continuing past 25.

## Step 2 — Loan terms: interest withheld upfront (the service's default path)

**Every loan below withholds interest upfront** — do NOT set `FullDisbursement = true`. This
mirrors the `CreateInput.FullDisbursement = false` default path in
`personalloan.Service.CreateLoan` (`backend/internal/personalloan/service.go`) — replicate its
math exactly when building each `PersonalLoan` row:

- `InterestType = "Percentage"`, `InterestValue = 10`.
- `InterestAmount = RoundMoney(principal * 10 / 100)`.
- `DisbursedAmount = RoundMoney(principal - InterestAmount)` — the actual cash handed to the
  customer historically.
- `PrincipalAmount` (the DB column name for the repayment **obligation**, not the disbursed cash)
  `= principal` unchanged — only `FullDisbursement = true` would add interest on top, which we
  are NOT using.
- `Frequency = "Daily"`, `TenureCount = 100`.
- `InstallmentAmount = RoundMoney(PrincipalAmount / 100)`.
- `FullDisbursement = false`.
- `OpenedDate` = the DATE column (Step 5) — a real historical `time.Time`, not `time.Now()`.
- `DisbursedAt` = same as `OpenedDate`.
- `ClosedAt` = `NULL`.
- `LoanNumber` = `PL-00001`...`PL-00025` in the Step 5 `seq` order (see Step 1's numbering reset).
- `BranchID`, `CreatedByEmployeeID`, `TenantID` = whatever this deployment's normal personal-loan
  creation currently uses (same branch/tenant as existing data) — confirm which branch/employee
  id to stamp before running if more than one exists.
- `RenewedFromLoanID`/`RenewedToLoanID` = `NULL` (none of these are renewals).

### Outstanding balance, status, and real penal history — read directly from the sheet's two BALANCE columns

The sheet's two BALANCE columns are NOT a simple "duplicate/typo" pair — they mean two different
things, and together they tell you exactly which loans really were charged penal interest in the
real world, with no simulation needed:

- **First/leftmost BALANCE column** = the loan's TOTAL amount actually accrued to date —
  `principal` plus any real penal interest actually charged against it historically. For most
  loans this equals `principal` exactly (no penal interest was ever charged), but for 9 loans it
  is HIGHER than `principal` — that excess is the real, historical penal charge.
- **Second/rightmost BALANCE column** = the loan's CURRENT remaining balance after collections —
  this is `OutstandingAmount` (Step 5's `balance` column, unchanged from before).

For every loan: `OutstandingAmount` = the second/rightmost BALANCE column, **directly,
unmodified** — this is ground truth, not something to project forward or adjust further.
`TotalPaid` = `principal − OutstandingAmount`, matching Step 5's `collected` column exactly —
per the earlier decision, the installment schedule/`paidInstallments` count (Step 5/9) for ALL 25
loans, including the 9 with real penal history, stays based on the ORIGINAL `principal` and
`OpenedDate`, not the post-penal accrued total. The 9 loans' penal charge is recorded purely as an
informational `personal_loan_history` entry (below, and Step 8) layered on top of that unchanged
schedule/`OutstandingAmount` — it does not resize the installments or shift their due dates.

`PenalInterestRate = 10`, `PenalFlatAmount = 0`, `GracePeriodDays = 15` for every loan — these are
the loan's TERMS, applied uniformly, and (for the 9 loans below) also happen to be exactly what
produced their real historical accrual once reconstructed against their real `OpenedDate`.

**9 of the 25 loans show real, historical penal accrual** (first BALANCE column > principal) —
for these, and only these, insert a real `personal_loan_history` row with `Event =
"penal_applied"` alongside `loan_created` (see Step 8), and set the loan's penal fields to match:

```
name=JOSHI A B           principal=19000 firstBalance(totalAccrued)=22905 secondBalance(current)=19000  penalTotal=3905  cycle=6  lastCycleDate=09-08-2026  status=Pending
name=SATHEESHAN          principal=11000 firstBalance(totalAccrued)=19000 secondBalance(current)=9000   penalTotal=8000  cycle=11 lastCycleDate=19-08-2026  status=Pending
name=VARGHESE            principal=10000 firstBalance(totalAccrued)=16075 secondBalance(current)=10000  penalTotal=6075  cycle=14 lastCycleDate=08-09-2026  status=Pending
name=PRIYA SADHANANDAN   principal=15000 firstBalance(totalAccrued)=33066 secondBalance(current)=13500  penalTotal=18066 cycle=14 lastCycleDate=20-07-2026  status=Pending
name=UNNIKRISHNAN        principal=5000  firstBalance(totalAccrued)=5892  secondBalance(current)=4500   penalTotal=892   cycle=6  lastCycleDate=03-06-2026  status=Pending
name=HAMEED T A          principal=5000  firstBalance(totalAccrued)=10500 secondBalance(current)=5000   penalTotal=5500  cycle=10 lastCycleDate=03-09-2026  status=Pending
name=CHANDRAN V K        principal=5000  firstBalance(totalAccrued)=5200  secondBalance(current)=4000   penalTotal=200   cycle=9  lastCycleDate=15-07-2026  status=Pending
name=CHASHIN E P         principal=7500  firstBalance(totalAccrued)=10050 secondBalance(current)=7200   penalTotal=2550  cycle=10 lastCycleDate=12-08-2026  status=Pending
name=BINU N R            principal=6500  firstBalance(totalAccrued)=6710  secondBalance(current)=6500   penalTotal=210   cycle=10 lastCycleDate=19-06-2026  status=Pending
```

`cycle` = how many full `TenureCount`(100-day) + `GracePeriodDays`(15-day) penal windows
have elapsed between that loan's `OpenedDate` and today (2026-09-18), i.e. how many times the
loan's schedule could naturally have gone through a penal cycle under these terms — computed the
same way `evaluateAndApplyPenal`/`isPastGracePeriod` would step through it, WITHOUT assuming an
exact 10%-compounding match to `penalTotal` (the real-world charges on this sheet were not
computed on a strict 10%-per-100-day-cycle schedule, so simulating exact compounding cycles
consistently overshoots the sheet's real total by a few hundred to a few thousand rupees — do not
force-fit fake intermediate cycle amounts to make the math land exactly; the sheet's `penalTotal`
is the real figure, use it directly). `lastCycleDate` is the most recent such window's end date —
use it as `LastPenalAppliedAt` and as the single history row's `OccurredAt` (see Step 8).

For these 9 loans, on the `PersonalLoan` row: `PenalCycleCount = cycle`,
`TotalPenalInterestCharged = penalTotal`, `LastPenalAppliedAt = lastCycleDate`, `Status =
"Pending"` (the loan has a real penal charge on record and is currently past its latest cycle's
grace period with a balance still owed — matches `StatusPending`'s meaning). For all other 16
loans (no accrual beyond principal): `PenalCycleCount = 0`, `TotalPenalInterestCharged = 0`,
`LastPenalAppliedAt = NULL`, `Status = "Active"`.

This yields, per loan: `InterestAmount = principal * 10%`, `PrincipalAmount = principal`
(unchanged), `DisbursedAmount = principal - InterestAmount`, `InstallmentAmount =
PrincipalAmount / 100` — see Step 5's table for every row's resolved figures.

## Step 6 — Cash reflection (insert `CashMovement` rows directly)

Mirror exactly what `RecordLoanDisbursementCashOut`/`RecordLoanPaymentCashIn`
(`backend/internal/cash`) would have written, as real `cash_movements` rows, dated on the true
historical date instead of `time.Now()`:

- **One disbursement row per loan**: `CashMovement{Type:"out", Purpose:"Personal Loan
  Disbursement", Amount: DisbursedAmount, OccurredOn: OpenedDate, PartyCustomerID: <customer's
  id>, BranchID: <loan's branch>, Mode:"", Bank:"", TenantID: <loan's tenant>}`. No `Source` (that
  field is only for `Type:"in"`), no `BankID` (plain cash, no bank of record).
- **One payment row per installment already collected** (see Step 5's `paidInstallments`):
  `CashMovement{Type:"in", Source:"Loan", Purpose:"", Amount: installmentAmount, OccurredOn:
  <that installment's due date>, PartyCustomerID: <customer's id>, BranchID: <loan's branch>,
  Mode:"Cash", TenantID: <loan's tenant>}` — match whatever `Mode`/`Source` convention
  `RecordLoanPaymentCashIn` currently uses for a plain-cash personal loan payment in this
  codebase (check the function body — mirror it verbatim rather than guessing free-text values).
- Do not touch any `CashMovement` row for gold loans, expenses, opening balances, or gold sales.

## Step 7 — Personal loan payment ledger rows (`personal_loan_payments`)

For every collected installment (Step 5), also insert a matching `PersonalLoanPayment` row (this
is the loan's own payment ledger — separate from, and in addition to, the `CashMovement` row
above, since `CashMovement` has no loan FK): `PersonalLoanID`, `Amount = installmentAmount`,
`PaidOn = <installment due date>`, `Method = "Cash"`, `CashAmount = Amount`, `UpiAmount =
BankTransferAmount = ChequeAmount = 0` (platform.ValidateSplit's split fields must sum to
`Amount`), `ReceivedByEmployeeID` = whichever employee id Step 2 stamps on the loan,
`RunningBalance` = the outstanding balance immediately after that payment (i.e.
`PrincipalAmount − installmentAmount × N` for the Nth payment), `Reference`/`Description` blank,
`InstallmentID` = the matching `PersonalLoanInstallment` row's id (Step 9).

## Step 8 — History rows (`personal_loan_history`)

Insert, per loan, in `OccurredAt` order:

1. One `Event = "loan_created"` row for every loan: `Detail = "Loan opened for
   ₹<PrincipalAmount>"`, `Amount = PrincipalAmount`, `RelatedLoanID = NULL`, `OccurredAt =
   OpenedDate` — matching what `CreateLoan`'s own `logHistory` call would have written.
2. For ONLY the 9 loans listed in Step 2's penal table, one additional `Event = "penal_applied"`
   row: `Amount = penalTotal` (the row's real accrued penal amount from the sheet), `RelatedLoanID
   = NULL`, `OccurredAt = lastCycleDate`, `Detail = "Installment period ended unpaid — ₹<penalTotal,
   2dp> penal interest added (cycle <cycle>)"` — matching `applyPenalIfDue`'s own
   `logHistory` message format in `penal.go`, but as a single collapsed entry representing the
   loan's real total accrued penal interest rather than one row per intermediate cycle (the sheet
   only gives a final total, not a per-cycle breakdown, and simulating exact intermediate 10%
   cycle amounts would not sum to that real total — see Step 2's note).

The other 16 loans get only their `loan_created` row — no `penal_applied` row, since their first
BALANCE column matches `principal` exactly (no real penal interest was ever charged on them).

## Step 9 — Installment schedule rows (`personal_loan_installments`)

For every loan, insert all 100 `PersonalLoanInstallment` rows up front (the full schedule, same
as `generateSchedule` would produce): `SequenceNo` 1–100, `DueDate = OpenedDate + N days` (daily
frequency) for sequence N, `Amount = InstallmentAmount` for every row except sequence 100, which
gets `RoundMoney(PrincipalAmount − sum of the other 99)` so the schedule sums to exactly
`PrincipalAmount` (matches `generateSchedule`'s own rounding-drift handling). For the first
`paidInstallments` rows (Step 5, oldest due date first): `Status = "Paid"`, `PaidAmount =
Amount`. Every later row: `Status = "Pending"`, `PaidAmount = 0`.

Note this schedule's last due date (`OpenedDate + 100 days`) is what the live penal sweep will
check against today's date the moment these rows exist. For the 16 loans with no historical penal
charge, this will be their genuinely first sweep-triggered cycle if the grace period has already
lapsed. For the 9 loans that already have a real historical `penal_applied` entry (Step 2/8), this
same schedule is still the ORIGINAL principal-based one (per the earlier decision not to resize
it) — so the sweep, unaware of the informational history row, will treat it exactly like any other
overdue loan and fire its own next cycle against `OutstandingAmount` (the second-column balance),
independently of the historical `penalTotal` already logged.

## Step 4 — Customers to create

One row per unique person below (source sheet has no address/place/district for personal-loan
customers — leave `address`/`place`/`district`/`taluk`/`village` blank). `customerType =
"Borrower"`. Before creating each, check whether a customer with the same name+phone already
exists (this is a personal-loans-only run against a system that may already have gold-loan
customers) — reuse the existing `Customer` row rather than creating a duplicate if one matches.

```
PRIYA SADHANANDAN  919745632197
VARGHESE           917356619841
SHAMNAD (ABDHULU)  918547285062
SATHEESHAN         919539410814
BINU N R           919745518829
CHASHIN E P        918714285988
HAMEED T A         919061737059
AMBIKA DEVI        918594072334
CHANDRAN V K       919846304328
SREERAMAN V K      919895997571
JAMALU P K         919895419944
HUSAIN K K         917994360638
RONY K A           918891109686
UNNIKRISHNAN       919747591081
REHNA SUJITH       916282891236
JOSHI A B          919645147047
AFSAL P H          917306542743
JASMIN JOY         919387443552
DHIBIN             917736375983
RENIMOL            919645761841
BIJOY A S          917736994653
HANEEFA            919605578734
REJEESH A R        919605875481
SUNILKUMAR         919809869697
SHAMLA M V         918086083579
```

## Step 5 — Personal loans to create

Sorted earliest `openedDate` first so that inserting top-to-bottom yields `loanNumber`
`PL-00001` for the earliest loan and `PL-00025` for the newest (see Step 1's numbering reset).
`seq` below is that intended insertion order — not a DB field.

For each row: `principal` = the sheet's AMOUNT column, `balance` = the sheet's rightmost/second
BALANCE column (see note below on which column to use). All loans: `interestType="Percentage"`,
`interestValue=10`, `frequency="Daily"`, `tenureCount=100`, `fullDisbursement=false` (Step 2).
`balance` is the loan's real, current `OutstandingAmount` — used as-is, with no further penal
adjustment (see Step 2).

`collected = principal − balance` (since `obligation = principal` under this interest-withheld
model — not `principal × 1.10` the way a full-disbursement model would compute it).
`paidInstallments = round(collected / installmentAmount)`, where `installmentAmount =
principal / 100`. A handful of rows don't divide evenly into whole installments — the sheet
tracks a running rupee balance, not an exact paid-installment count, so up to one installment's
width of rounding drift is expected and fine (see `impliedCollected` vs `collected` per row —
they're within one installment of each other everywhere).

**Which BALANCE column:** the sheet has two BALANCE columns (source columns U and V). The
figures below already use the **second/rightmost** column — it is the only one that is ever
`<= principal` for every row (the obligation under this interest-withheld model never exceeds
`principal`, so a valid remaining balance can't exceed it either); the first/leftmost BALANCE
column exceeds `principal` for several rows (e.g. JOSHI A B: first column 22905 > principal
19000, SATHEESHAN: 19000 > 11000, VARGHESE: 16075 > 10000, PRIYA SADHANANDAN: 33066 > 15000,
UNNIKRISHNAN: 5892 > 5000, HAMEED T A: 10500 > 5000, CHASHIN E P: 10050 > 7500), which cannot
happen since `OutstandingAmount` only ever decreases from `principal`. Use the second column
throughout; the table below already has it resolved.

None of these 25 loans reach `balance = 0` in the sheet, so none are `Closed` at seed time — all
25 stay `Active` after their paid installments are recorded via `RecordPayment` (which is the
service's own logic — do not set `status` by hand).

```
seq=01 customer=PRIYA SADHANANDAN     date=21-02-2022  principal=15000  interest=1500.00  disbursed=13500.00  installment=150.00  balance=13500  collected=1500.00   paidInstallments=10
seq=02 customer=VARGHESE              date=12-04-2022  principal=10000  interest=1000.00  disbursed=9000.00   installment=100.00  balance=10000  collected=0.00      paidInstallments=0
seq=03 customer=SHAMNAD (ABDHULU)     date=30-06-2022  principal=7500   interest=750.00   disbursed=6750.00   installment=75.00   balance=7500   collected=0.00      paidInstallments=0   # implied 150.00 — within one installment
seq=04 customer=SATHEESHAN            date=03-03-2023  principal=11000  interest=1100.00  disbursed=9900.00   installment=110.00  balance=9000   collected=2000.00   paidInstallments=18  # implied 1980.00
seq=05 customer=BINU N R              date=26-04-2023  principal=6500   interest=650.00   disbursed=5850.00   installment=65.00   balance=6500   collected=0.00      paidInstallments=0
seq=06 customer=CHASHIN E P           date=19-06-2023  principal=7500   interest=750.00   disbursed=6750.00   installment=75.00   balance=7200   collected=300.00    paidInstallments=4
seq=07 customer=HAMEED T A            date=11-07-2023  principal=5000   interest=500.00   disbursed=4500.00   installment=50.00   balance=5000   collected=0.00      paidInstallments=0
seq=08 customer=AMBIKA DEVI           date=11-09-2023  principal=2500   interest=250.00   disbursed=2250.00   installment=25.00   balance=1100   collected=1400.00   paidInstallments=56
seq=09 customer=CHANDRAN V K          date=14-09-2023  principal=5000   interest=500.00   disbursed=4500.00   installment=50.00   balance=4000   collected=1000.00   paidInstallments=20
seq=10 customer=SREERAMAN V K         date=26-02-2024  principal=5000   interest=500.00   disbursed=4500.00   installment=50.00   balance=3500   collected=1500.00   paidInstallments=30
seq=11 customer=JAMALU P K            date=30-03-2024  principal=15000  interest=1500.00  disbursed=13500.00  installment=150.00  balance=14400  collected=600.00    paidInstallments=4
seq=12 customer=HUSAIN K K            date=27-05-2024  principal=5000   interest=500.00   disbursed=4500.00   installment=50.00   balance=1500   collected=3500.00   paidInstallments=70
seq=13 customer=RONY K A              date=21-06-2024  principal=5000   interest=500.00   disbursed=4500.00   installment=50.00   balance=5000   collected=0.00      paidInstallments=0
seq=14 customer=UNNIKRISHNAN          date=13-07-2024  principal=5000   interest=500.00   disbursed=4500.00   installment=50.00   balance=4500   collected=500.00    paidInstallments=10
seq=15 customer=REHNA SUJITH          date=03-08-2024  principal=5000   interest=500.00   disbursed=4500.00   installment=50.00   balance=3500   collected=1500.00   paidInstallments=30
seq=16 customer=JOSHI A B             date=18-09-2024  principal=19000  interest=1900.00  disbursed=17100.00  installment=190.00  balance=19000  collected=0.00      paidInstallments=0
seq=17 customer=AFSAL P H             date=15-01-2025  principal=25000  interest=2500.00  disbursed=22500.00  installment=250.00  balance=12100  collected=12900.00  paidInstallments=52  # implied 13000.00
seq=18 customer=JASMIN JOY            date=25-02-2025  principal=15000  interest=1500.00  disbursed=13500.00  installment=150.00  balance=4850   collected=10150.00  paidInstallments=68  # implied 10200.00
seq=19 customer=DHIBIN                date=27-03-2025  principal=8000   interest=800.00   disbursed=7200.00   installment=80.00   balance=8000   collected=0.00      paidInstallments=0
seq=20 customer=RENIMOL               date=04-09-2025  principal=2500   interest=250.00   disbursed=2250.00   installment=25.00   balance=2500   collected=0.00      paidInstallments=0
seq=21 customer=BIJOY A S             date=10-02-2026  principal=5000   interest=500.00   disbursed=4500.00   installment=50.00   balance=2700   collected=2300.00   paidInstallments=46
seq=22 customer=HANEEFA               date=18-06-2026  principal=10000  interest=1000.00  disbursed=9000.00   installment=100.00  balance=900    collected=9100.00   paidInstallments=91
seq=23 customer=REJEESH A R           date=20-08-2026  principal=7500   interest=750.00   disbursed=6750.00   installment=75.00   balance=5300   collected=2200.00   paidInstallments=29  # implied 2175.00
seq=24 customer=SUNILKUMAR            date=25-08-2026  principal=13000  interest=1300.00  disbursed=11700.00  installment=130.00  balance=12400  collected=600.00    paidInstallments=5   # implied 650.00
seq=25 customer=SHAMLA M V            date=14-09-2026  principal=15000  interest=1500.00  disbursed=13500.00  installment=150.00  balance=14600  collected=400.00    paidInstallments=3   # implied 450.00
```

Each row above supplies everything Steps 2, 6, 7 and 9 need per loan: `PersonalLoan.
OutstandingAmount` = the row's `balance` directly, `TotalPaid` = the row's `collected` directly,
and `paidInstallments` rows of the 100-row schedule get marked `Paid` (oldest due date first)
with a matching `PersonalLoanPayment` + `CashMovement` row each — since this is a historical
backfill, set these fields directly on the rows you insert rather than relaying through
`RecordPayment` (which only knows how to apply a payment going forward from today).

## Step 10 — What NOT to touch

Do not modify: `Loan`/`Ornament`/gold loan tables, `GoldRate`, `Packet`, `Expense`, `GoldSale`,
`OpeningCashBalance`, any `CashMovement` not created by this migration's own
disbursement/payment inserts, roles/permissions, branch config, or any `Customer` not listed in
Step 4 (and even those, only if they don't already exist).

## Before running anything destructive

Show a dry-run summary first: exact delete counts per table (personal loan tables + identified
personal-loan `CashMovement` rows only), the 25 customers to create/reuse, each loan's computed
`InterestAmount`/`DisbursedAmount`/`InstallmentAmount`/`paidInstallments`/`OutstandingAmount`/
`TotalPaid` (the sheet's real second-column `balance`, unmodified), confirmation that
`FullDisbursement=false` and `PenalInterestRate=10`/`GracePeriodDays=15` are set on every loan,
the 9 loans getting a real `penal_applied` history row + `PenalCycleCount`/
`TotalPenalInterestCharged`/`LastPenalAppliedAt`/`Status="Pending"` per Step 2's table (and
confirmation the other 16 get none of that), real historical `OpenedDate`/`DisbursedAt`/`PaidOn`/
`OccurredOn` values (not `time.Now()`) on every inserted row, which
`BranchID`/`CreatedByEmployeeID`/`TenantID` will be stamped (Step 2), and an explicit call-out of
which loans' 100-day schedules have already lapsed past their 15-day grace as of today (meaning
`SweepPenalInterest` will fire a further real penal cycle on them almost immediately after
seeding, on top of the historical one already recorded) — then wait for go-ahead before writing
anything.

## Step 11 — Gold loan scheme penal rate update (separate change, NOT part of the personal loan seed above)

**This step touches gold loans, not personal loans** — it is unrelated to Steps 1–10 and must run
as its own change, not inside the same transaction, not gated by the same dry-run approval. Do not
let it interact with anything above; nothing else in `Loan`/`Ornament`/`Scheme` besides the one
field below should change.

In the `schemes` table (`scheme.Scheme`, `backend/internal/scheme/model.go`), change the
`PenalRate` column from `0.5` to `5` — only this field, on only the scheme row(s) currently at
`0.5`. Do not touch `InterestRate`, `DurationMonths`, `LTVPercent`, `InterestMethod`, `Conditions`,
`IsActive`, or any other column on those rows, and do not touch schemes whose `PenalRate` is
already something other than `0.5`.

Note `PenalRate` is stored as a per-annum percentage — `loan.accrual.go`'s `projectAccrual`
already divides it by `100 * 12` to get a monthly charge, so no other math needs to change to make
this "annual"; changing the stored value from `0.5` to `5` is the entire update on the scheme side.

**Also update the same field on the `loans` table.** `Loan.applySchemeSnapshot`
(`backend/internal/loan/model_loan.go`) copies `Scheme.PenalRate` onto each loan's own
`SchemePenalRate` column once, at that loan's creation, and never re-reads it from the scheme
afterward — so updating only the scheme leaves every already-open loan still charging penal
interest at `0.5`. Update `Loan.SchemePenalRate` from `0.5` to `5` as well, directly on every
`loans` row that: (a) references one of the scheme id(s) just changed, AND (b) currently has
`SchemePenalRate = 0.5`. Do this as a scoped `UPDATE` restricted to exactly those rows (or via
`loan.Repository`/`loan.Service` if an existing method already does a scoped bulk field update —
check before writing raw SQL). Do not touch a loan whose `SchemePenalRate` is something other than
`0.5` (it was scheme-reassigned or customized since creation — leave it alone), and do not touch
any other column on the `loans` table.

Show a dry-run summary before changing anything: which scheme row(s) currently have `PenalRate =
0.5` (id, code, name, branch), how many currently-open gold loans reference each one, and how many
of those loans currently have `SchemePenalRate = 0.5` (i.e. will actually be updated) versus some
other value (left alone) — then wait for go-ahead before updating either table.
