# Plan: Defaulted flag should require real payment arrears, not just an expired due date
_Locked via grill — by Claude + user_

## Goal
`Loan.IsDefaulted` (backend/internal/loan/accrual.go) is currently computed purely from
`overdueDays > 90` against the loan's `DueDate`, with zero awareness of whether the
customer has actually kept up with interest/penal-interest payments. This causes a loan
that was correctly withdrawn from the auction pipeline (via the "Removed From Auction"
partial-repayment decision, after a payment covered its interest) to reappear as
"Defaulted" in the Auctions Management worklist on the very next page load — nothing
about the withdrawal or the payment changes `IsDefaulted`, only the calendar does.

Fix: a loan should only be considered Defaulted if it is both overdue by more than the
threshold AND still carries genuine unpaid interest/penal-interest arrears. A loan that
is past its term due date but has kept its accrued interest and penal interest fully
paid down should not be flagged Defaulted, should not show up needing auction attention,
and should not be startable into a fresh auction case via "Mark Auction Eligible".

## Approach
1. **`backend/internal/loan/accrual.go`** — `enrichStatusFlags`: change
   ```go
   l.IsDefaulted = overdueDays > defaultedAfterDays
   ```
   to
   ```go
   l.IsDefaulted = overdueDays > defaultedAfterDays &&
       (l.OutstandingInterest > 0 || l.OutstandingPenalInterest > 0)
   ```
   `OutstandingInterest`/`OutstandingPenalInterest` are already computed earlier in
   `enrich()` (accrual.go) before `enrichStatusFlags` is called, so no ordering change
   is needed. `IsOverdue`/`DaysOverdue`/`IsDueSoon` are untouched — only `IsDefaulted`
   gets the new arrears gate.
2. **No other backend changes needed.** `MarkAuctionEligible` (service.go) already
   gates on `l.IsDefaulted`, so it automatically inherits the stricter, payment-aware
   check — staff can no longer manually start an auction case on a loan that's current
   on interest/penal interest, which is a correctness fix in its own right.
3. **No frontend changes needed.** `Auctions.tsx`'s worklist filter, `LoanDetail.tsx`'s
   status chip, and `Loans.tsx`'s "Defaulted" filter tab all read `l.isDefaulted`
   straight from the API response — they automatically pick up the corrected
   definition once the backend changes.
4. Update the doc comments on `IsDefaulted` (model.go) and `enrichStatusFlags`
   (accrual.go) to describe the new arrears-aware rule instead of "pure date-vs-DueDate".

## Key decisions & tradeoffs
- **Scope: redefine `IsDefaulted` globally**, not just the Auctions.tsx worklist filter.
  Confirmed with the user — every place `isDefaulted` is read (Auctions worklist, its
  status chip/stepper, LoanDetail's chip, Loans.tsx's Defaulted filter tab,
  `MarkAuctionEligible`'s server-side gate) should reflect real arrears, not just an
  expired date. Audited every read site; no undesired ripple effects — Dashboard's KPI
  cards ("Overdue Loans", "Auction Cases") filter on `l.status`/`l.status==="Overdue"`
  directly, not `isDefaulted`, so they're unaffected either way.
- **"Interest paid current" = `OutstandingInterest <= 0`.** Uses the existing computed
  field (`AccruedInterest − InterestPaid`) directly — no new tracking/period concept
  needed. A loan whose accrued interest is fully paid off counts as current even if
  principal remains outstanding, which is normal for a bullet-repayment gold loan.
- **Penal interest also gates it**: the loan must additionally have
  `OutstandingPenalInterest <= 0`. Processing fee is deliberately excluded from the
  gate — requiring every possible charge at zero would make it near-impossible for an
  overdue-but-paying loan to ever count as current, defeating the fix's purpose.
- **`IsOverdue`/`IsDueSoon` stay pure date-based.** Only the auction-facing `IsDefaulted`
  flag gets the arrears gate; the earlier reminder-ladder flags are untouched.
- **90-day threshold (`defaultedAfterDays`) is unchanged** — this fix adds a condition,
  it doesn't change the time window.

## Risks / open questions
- No existing test coverage on `enrichStatusFlags`/`IsDefaulted` was found, so this
  change has no regression tests today; worth adding a couple of table-driven cases
  (overdue+unpaid → Defaulted; overdue+fully-paid interest & penal → not Defaulted) but
  that's an implementation detail, not a plan blocker.
- Noticed (pre-existing, unrelated) dead code: `Dashboard.tsx`'s `auctionLoans` filter
  checks `l.status === "Defaulted"`, but the backend never actually assigns the literal
  string `"Defaulted"` to `Loan.Status` anywhere — that branch is currently unreachable.
  Flagging it, but it's out of scope for this fix.

## Out of scope
- Not touching `IsOverdue`/`IsDueSoon`/the 7/90-day thresholds.
- Not fixing the pre-existing dead `l.status === "Defaulted"` branch in Dashboard.tsx.
- Not adding a persisted "paid-through date" or monthly-cycle concept — the fix uses
  already-computed accrued/paid totals, not a new due-date-per-period model.
