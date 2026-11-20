# Interest calculation: move to actual days ÷ 365

Status: proposed, not implemented.

## Why

Today the single-rate schemes (Monthly simple, Quarterly simple, Flat monthly, Compound monthly) charge:

- a **flat monthly amount** for each completed calendar month (1% of principal for a 12% p.a. scheme), and
- a **days ÷ 30** share for any partial period (early repayment, minimum period).

This mixes two bases. A hand calculation on actual days gives a different figure from the app. Example: 10,000 at 12% for the 10-day minimum period.

| Calculation | Interest |
|---|---|
| App today (days ÷ 30) | 33.33 |
| Actual days ÷ 365 | 32.88 |

The February problem is also unresolved: a 28-day month and a 31-day month cost the same flat amount.

## Decision

Charge interest on **actual days between the two dates, over a 365-day year**, for every case, including full months.

```
interest = outstanding × (annual rate ÷ 100) ÷ 365 × actual days
```

- One rule for everything. No flat-month exception and no February special case.
- A full year is exactly the quoted annual rate.
- A calendar month varies with its length. Example, 10,000 at 12%:

| Period | Days | Interest |
|---|---|---|
| 3 Oct → 3 Nov | 31 | 101.92 |
| 3 Feb → 3 Mar | 28 | 92.05 |

- Multiple-interest loans already use this basis (`multipleDayRate` in `accrual.go`).

## Rules

1. **Minimum period** stays. If a loan is settled before the minimum days (10 in the example), the minimum days are charged.
2. **Repayment** settles interest up to the payment date, counted in actual days. No full month is charged for a partial one.
3. **Leap years:** always divide by 365, even in a 366-day year.
4. **Existing loans** keep the old calculation, so their interest does not change. New loans use the new basis. This needs a flag on the loan (or a scheme calculation version).
5. **Display:** show "Actual days ÷ 365" on the loan details, the loan document and the receipt.

## What changes

| Area | Work |
|---|---|
| Backend | `backend/modules/Loan/controllers/accrual.go`: replace `singleRateInterestForDays`, the flat-month branches and `partialPeriodInterest` for new loans |
| Loan model | Flag recording which basis a loan uses, set at creation, defaulting to the old basis for existing rows |
| Offline mode | Frontend and desktop calculation (`frontend/common/offline`, `frontend/desktop/localstore`) must match the backend exactly |
| Loan preview | Creation preview and settlement preview use the same formula |
| Documents | Loan documents and receipts print the basis |
| Tests | Update the minimum-period tests that expect 33.33; add tests for February, a 31-day month, a leap year, early repayment and the minimum period |

## Open questions

- **Compound monthly:** it compounds per month today. Decide whether to compound per period using actual days, or leave this scheme on the old basis.
- **Quarterly simple and Flat monthly:** confirm both move to days ÷ 365 (Flat monthly would charge on the original principal).
- **Rounding:** round each posted charge to 2 decimals (the example gives 32.88; truncation gives 32.87).

## Verification

1. Open a loan on 23-10-2026, 10,000 at 12%, 10-day minimum. Interest on day 0 is 32.88.
2. Repay a test loan on day 12. Interest is 39.45.
3. A 3 Feb → 3 Mar loan shows 92.05 and a 3 Oct → 3 Nov loan shows 101.92.
4. Offline mode and the backend give the same figure for each case.
5. An existing loan keeps its previous interest.
