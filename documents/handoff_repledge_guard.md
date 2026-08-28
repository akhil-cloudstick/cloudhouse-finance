# Handoff — bank re-pledge eligibility guard

**Status:** code complete, builds and tests pass, **not yet verified in a
running app** — the backend needs a restart to pick it up. A follow-up on
2026-08-28 closed the `CompleteRelease` drift hole and added the missing
test — see *Follow-up done* below.
**Branch:** `filechanges`
**Related change in the same session:** bank-pledge expense mirroring removed
(see `handoff` notes at the end).

---

## The problem

`Service.RecordBankPledge` had **no status check of any kind**. Any loan could
be pledged to a bank regardless of whether the branch still held the gold. In
practice that meant a `Closed` loan — gold already handed back to the
customer — could be re-pledged straight back into the Bank Pledge worklist,
and the same for auctioned loans and loans not yet sanctioned.

This was not hypothetical. The live database contains records created through
that gap (see *Pre-existing bad data* below).

---

## Decisions taken (by the product owner, in session)

1. **Closed and released loans cannot be re-pledged.** The originating request.
2. ~~**A bank pledge is once per loan, for its lifetime.**~~ **Reversed
   2026-08-28** — see *Follow-up done* below. Originally confirmed after it was
   flagged that this also blocks a loan whose gold had come back *from* the
   bank (`bankPledgeStatus = "Released"`); the product owner has since
   revisited it, and released gold is re-pledgeable again. Only an **open**
   pledge now blocks a new one.
3. **`Closure Requested` is also refused.** This one was *not* requested — it
   is an inference, flagged as such, and is the most likely candidate if any
   part of this needs reverting. Rationale: the release is already approved and
   the gold committed, and `CompleteRelease` refuses while a pledge is active,
   so allowing a pledge at that point deadlocks the loan.

---

## The rule, in one place

`backend/internal/loan/model_loan.go` — `bankPledgeIneligibleStatuses` and
`CanAcceptBankPledge(status string) bool`.

A loan may be pledged only when **both** hold:

| Condition | Refused values |
|---|---|
| `Loan.Status` not in the ineligible list | `Closed`, `Closure Requested`, `Auctioned`, `Auctioned - Balance Due`, `Pending Approval` |
| `Loan.BankPledgeStatus` is not `Bank Pledged` (and no pledge record is still `Active`) | `Bank Pledged` |

Errors returned (`backend/internal/loan/service.go`, error block ~line 129):

| Error | Meaning |
|---|---|
| `ErrLoanNotPledgeable` | status is in the ineligible list |
| `ErrBankPledgeStillActive` | a pledge is already open |

Both are 400s via `httpx.NewBadRequest`. (`ErrBankPledgeAlreadyUsed` existed
for the once-per-lifetime rule and was removed with it on 2026-08-28.)

---

## Files changed

### Backend

| File | Change |
|---|---|
| `internal/loan/model_loan.go` | Added `bankPledgeIneligibleStatuses` + `CanAcceptBankPledge`. Expanded the `BankPledgeStatus` doc comment to spell out that `Released` means *from the bank*, not to the customer. |
| `internal/loan/service.go` | `RecordBankPledge` now refuses a loan whose status is ineligible or whose pledge is still open, before creating the record. (It originally also added `ErrBankPledgeAlreadyUsed` for the once-per-lifetime rule; both were removed on 2026-08-28.) |
| `internal/loan/repository.go` | `LoanFilter.ExcludeBankPledged` now also requires `status NOT IN (…)` (was only `<> 'Pending Approval'`). It briefly required `bank_pledge_status = 'Not Pledged'`; back to `<> 'Bank Pledged'` since 2026-08-28. Comment rewritten. |

### Frontend

| File | Change |
|---|---|
| `modules/loans/services/loanService.ts` | Added `canAcceptBankPledge(status, bankPledgeStatus)` + `BANK_PLEDGE_INELIGIBLE_STATUSES`, mirroring the Go list. |
| `modules/loans/components/LoanDetail.tsx` | "Repledge to Bank" button now gated on `canAcceptBankPledge(l.status, l.bankPledgeStatus)` (was `l.status !== "Closed"`). |
| `modules/packets/components/PacketDetail.tsx` | `openBankPledge()` checks the loan *after* fetching it and shows a toast instead of opening the modal. Needed because the packet page has no loan loaded until the click. |

### Docs

`documents/api_documentation.md` (bank pledge section + the
`excludeBankPledged` query-param row) and `documents/change_log.md`
(`[Unreleased] → Fixed`).

**The frontend list is a copy of the Go list and is kept in sync by hand.**
That is deliberate — the server is authoritative, so a stale copy degrades to
an error toast rather than a bad write. If a status is ever added, both must
change.

---

## Entry points covered

There are four ways into a re-pledge. All four are now guarded:

1. `POST /api/v1/loans/:id/bank-pledge` — the service check (authoritative).
2. Bank Re-Pledge page → "New Re-Pledge" → loan picker — via
   `excludeBankPledged`, so ineligible loans are never offered.
3. Loan detail → "Repledge to Bank" button — hidden.
4. Packet detail → "Repledge to Bank" button — checked on click.

---

## Data impact

At the time of the original change, on the dev database: **11 loans remained
pledgeable, 10 became blocked.** The 2026-08-28 reversal returns the three
`Released` loans (LN-00003, LN-00004, LN-00008) to the eligible set on the
status rule — though all three still carry an `Active` pledge record, so
`HasActive` refuses them anyway until that drifted data is corrected.

| Blocked by | Loans |
|---|---|
| `Bank Pledged` | LN-00019 |
| `Closed` | LN-00015, LN-00017, LN-00020 |
| `Closure Requested` | LN-00018 |
| `Pending Approval` | LN-00005, LN-00021 |

LN-00003 was the one flagged to eyeball — `Active`, blocked purely by the
once-per-lifetime rule. That rule has since been dropped (decision 2), which
is exactly the revisit this paragraph anticipated.

No migration and no data change ships with this — it is enforcement only.

---

## Follow-up done (2026-08-28) — the drift no longer fools the guards

The "next step" below has been taken, in its narrow form. The loan-level
`bank_pledge_status` string is still stored (deriving it is still the better
end state, and still open — see the bottom of this section), but **no guard
trusts it alone any more**:

| File | Change |
|---|---|
| `internal/loan/repository.go` | `BankPledgeRepository.HasActive(loanID)` — does this loan have any pledge record still `Active`? |
| `internal/loan/service.go` | `CompleteRelease` and `RecordBankPledge` both now call `HasActive` in addition to reading the string. The string is checked first (cheap, covers the normal case); the record query is what catches a drifted loan. |
| `internal/loan/model_loan.go` | The status-matrix decision extracted into pure `bankPledgeRefusal(status, bankPledgeStatus) error`, so it is testable without a database. `RecordBankPledge` calls it instead of inlining the checks. |
| `internal/loan/bank_pledge_test.go` | **New.** Table test over the full status matrix, asserting the *specific* error each combination refuses with, plus a guard that every entry in `bankPledgeIneligibleStatuses` is actually refused. |

Concretely: LN-00008 could be closed with a live ₹30,000 pledge because
`CompleteRelease` read only the string. It now also asks the records, so that
exact route is shut whether or not the three bad rows are ever corrected.

`go build ./...`, `go vet ./internal/loan/`, `go test ./internal/loan/` pass.

### Decision 2 reversed in the same pass — released gold is pledgeable again

The product owner revisited the once-per-lifetime rule and dropped it: a loan
whose gold has come back **from** the bank (`bankPledgeStatus = "Released"`)
may be pledged again, and can cycle pledge → release → pledge for as long as
its own status stays eligible. Only an **open** pledge blocks a new one.

That rule's original justification was mechanical, not commercial — a second
pledge would overwrite `bankPledgeStatus` and orphan the first record with no
release path. `HasActive` above enforces "one open pledge at a time" straight
off the records, so repeat pledging is now safe in a way it was not when the
rule was written.

| File | Change |
|---|---|
| `internal/loan/model_loan.go` | `bankPledgeRefusal` no longer refuses `Released`. |
| `internal/loan/service.go` | `ErrBankPledgeAlreadyUsed` deleted — no callers left. |
| `internal/loan/repository.go` | `ExcludeBankPledged` back to `bank_pledge_status <> 'Bank Pledged'`, so the picker offers released loans again. |
| `modules/loans/services/loanService.ts` | `canAcceptBankPledge` mirrors it: `bankPledgeStatus !== "Bank Pledged"`. |
| `internal/loan/bank_pledge_test.go` | The `Released` row now expects `nil`. |

The loan-status rule is untouched: `Closed`, `Closure Requested`, `Auctioned`,
`Auctioned - Balance Due` and `Pending Approval` are still refused.

**Still open:** deriving `bank_pledge_status` from the pledge records instead
of storing it. That removes the drift class rather than defending against it,
but it touches `LoanFilter.ExcludeBankPledged` and the loan list query, so it
was deliberately not bundled here.

---

## Pre-existing bad data — NOT fixed, needs a decision

Three pledge records are `Active` while their loan's `bank_pledge_status` says
`Released`:

```
pledge 1 → LN-00003  loan: Released  pledge: Active  ₹900
pledge 2 → LN-00004  loan: Released  pledge: Active  ₹900   (loan is Pending Approval)
pledge 3 → LN-00008  loan: Released  pledge: Active  ₹30,000 (loan is CLOSED)
```

The loan-level `bank_pledge_status` string and the pledge record's own `status`
have drifted apart. LN-00008 is the serious one: a closed loan with a ₹30,000
bank pledge still open against it.

This matters beyond tidiness because **`CompleteRelease` trusts only the
loan-level string** — `CompleteRelease` at `internal/loan/service.go:2740`
raises `ErrBankPledgeStillActive` at line 2753 by testing
`l.BankPledgeStatus`, never the pledge records. Once the two drift,
the release guard passes when it should not — which is the likely route by
which LN-00008 was closed with a live pledge.

The new guard prevents *new* occurrences of this shape, but these three rows
are still wrong. **Deliberately left untouched** — correcting financial
records is the product owner's call, not a side effect of a code change.

Reproduce with:

```sql
SELECT p.id AS pledge_id, p.status AS pledge_status, l.loan_number,
       l.status AS loan_status, l.bank_pledge_status, p.pledged_amount
FROM bank_pledge_records p JOIN loans l ON l.id = p.loan_id
WHERE p.status = 'Active' ORDER BY p.id;
```

Next step for whoever picks this up: trace `ReleaseBankPledge` and
`CompleteRelease` to find the path that updates one side without the other,
then decide whether the two fields should be reconciled, or whether the
loan-level string should be derived from the pledge records rather than stored
at all — the second option removes the drift class entirely.

---

## Verification

Backend: `go build ./...`, `go vet ./internal/loan/`, `go test ./internal/loan/`
— all pass. Frontend: `npx tsc --noEmit` — clean.

**A running backend restart is required.** The dev backend on :8080 is the
pre-change binary; the frontend on :3000 hot-reloads.

Manual checks once restarted:

1. Open LN-00008 (closed) and LN-00003 (released) — the "Repledge to Bank"
   button should be absent on both.
2. Bank Re-Pledge → New Re-Pledge → search — neither should appear in the
   picker, nor should any `Closed` / `Pending Approval` loan.
3. Call the endpoint directly with a blocked loan id and confirm a 400 with the
   right message. This is the check that matters: the UI hiding a button is
   cosmetic, the service refusing is the guarantee.
   ```
   POST /api/v1/loans/8/bank-pledge
   { "bankName": "SBI", "pledgedAmount": 1000, "pledgeDate": "2026-08-28",
     "cashTreatment": "RecordOnly" }
   → 400 "this loan's gold has already been pledged to a bank and released once…"
   ```
4. Confirm an eligible loan (e.g. LN-00016) still pledges normally — the guard
   must not have over-reached.

A table test over the status matrix now exists —
`internal/loan/bank_pledge_test.go`, added in the 2026-08-28 follow-up above.

---

## Also in this session, same area

Bank pledges are no longer mirrored as expenses. Pledging books cash-in only;
the expense belongs to the release leg. `RecordBankPledgeExpense` was removed
from `loan.CashRecorder` and `cash.MovementService`, and
`internal/migrate.purgeBankPledgeMirrorExpenses` deletes the historical mirror
rows. **That migration has already run on the dev database.** See
`documents/change_log.md` for the full entry.
