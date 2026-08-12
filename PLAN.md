# Plan: Replace hardcoded 24K/22K/18K purity with a purity_standards lookup + per-ornament karat/fineness entry
_Locked via grill — by Claude + user_

## Goal
Gold purity is currently a closed 3-value enum duplicated in two unrelated places: `GoldRate.K24/K22/K18`
(backend/internal/goldrate/model.go) requires staff to publish three independently-typed daily rates, and
`Ornament.Purity`/`OrnamentPurityTest.TestedPurity` are validated against a hardcoded
`"24K"|"22K"|"18K"` switch. This makes it impossible to handle any other purity (20K, 16K, a custom
fineness%) without a code change, and lets the three published rates drift from their true mathematical
relationship since nothing ties K22/K18 to K24.

This plan moves to: **only the 24K benchmark is published daily**; every other purity is resolved
per-ornament, at pledge/re-test time, as `24K_rate × (karat/24)` or `24K_rate × (fineness%/100)` depending
on which unit the staff member used. A new `purity_standards` reference table (seeded 24K down to 10K)
powers a searchable suggest-or-create picker so staff get instant suggestions instead of typing free text,
without permanently locking the app to a fixed purity list.

## Approach

1. **New `purity_standards` table** (`backend/internal/puritystandard`, mirroring `internal/bank`'s
   shape/find-or-create pattern):
   - `ID`, `Karat *int` (nullable), `FinenessPercent *float64` (nullable — a row may only have one of the
     two populated if entered from a single unit, though seeded rows have both), `Label string` (e.g.
     `"22K (916)"`), `IsActive bool`.
   - Seed every whole karat from 24K down to 10K (24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11,
     10 — not just the common even ones), each with its fineness% computed as `round(karat/24*100, 1)`
     (e.g. 24K/100.0, 23K/95.8, 22K/91.7, 21K/87.5, 20K/83.3, 18K/75.0, 14K/58.3, 10K/41.7), via the
     migration (same idempotent seed-if-missing pattern as `authz.SeedDefaults`). Using the exact
     karat/24 ratio for every seeded row keeps the table internally consistent — no row's fineness%
     deviates from what the formula would compute anyway.
   - `FindOrCreate`-style endpoint so a staff-typed custom value not in the seed list gets saved for future
     suggestion — same UX as `ornamenttype`'s inline creation from `SearchableSelect`.
   - This table is **suggestion-only** — nothing FKs into it. Ornament/GoldRate never reference its ID;
     picking a suggestion just fills in the karat-or-fineness value used to compute and format the stored
     string (step 3).

2. **`GoldRate` schema simplification** (`backend/internal/goldrate/model.go`):
   - Drop `K22`/`K18` as live fields; add a migration that **renames** the existing columns to
     `legacy_k22`/`legacy_k18` (not dropped — preserves real historical per-purity numbers staff entered in
     the past, which are not reconstructable from K24 alone). Nothing new is ever written to them.
   - `PublishInput`/`Service.Publish`/`bankPledgeRequest`-equivalent request struct only accept/validate
     `K24` (+ `SetBy`) going forward.
   - `GoldRate.K22`/`K18` Go struct fields are removed entirely (the renamed legacy columns are not mapped
     — a follow-up read-only migration/report can query them directly by column name if historical 22K/18K
     figures are ever needed).

3. **Purity string format** — `Ornament.Purity` and `OrnamentPurityTest.TestedPurity` stay `string` columns
   (no FK), but their format/validation changes from the closed `"24K"|"22K"|"18K"` switch to an
   open unit-suffixed pattern: `"<int>K"` (karat mode, e.g. `"22K"`) or `"<decimal>%"` (fineness mode, e.g.
   `"91.6%"`). Existing historical values (`"24K"`, `"22K"`, `"18K"`) already conform to the new `"<int>K"`
   format — **no data migration needed** for existing Ornament/OrnamentPurityTest rows.
   - New validation (`backend/internal/loan/service.go`, replacing `ErrInvalidPurity`'s fixed check):
     regex-match `^\d+K$` or `^\d+(\.\d+)?%$`, reject anything else.

4. **Rate resolution** (`backend/internal/loan/service.go`'s `rateForPurity`):
   - Replace the fixed switch with: parse the purity string's suffix; if `K`, compute
     `round(goldRate.K24 * karat / 24)`; if `%`, compute `round(goldRate.K24 * fineness / 100)`. Rounding to
     the nearest whole rupee happens on the **per-gram rate**, before multiplying by weight into
     `GoldValue` — matching how K24 itself and the old K22/K18 values were always whole-rupee figures.
   - `RecordPurityTest`'s validation gets the identical parse/validate treatment (was previously its own
     hardcoded `"24K"|"22K"|"18K"` check).

5. **Frontend: shared purity-entry control** — new small component (e.g.
   `components/PurityPicker.tsx`) used everywhere purity is entered: a Karat/Fineness% toggle plus a
   `SearchableSelect<PurityStandardView>` (`allowCreate` wired to the new find-or-create endpoint, same
   pattern as `ornamenttype`/`bank` pickers) that fills in the toggle's value and computes the resulting
   `"NNK"`/`"NN.N%"` string. Wired into:
   - `NewLoan.tsx`'s ornament rows (replaces the `k24/k22/k18` `<select>` at line 581-583; `rowVals`'s
     client-side preview math mirrors the new backend formula).
   - The ornament purity-(re)test flow (wherever `RecordPurityTest`/`TestedPurity` is entered — same
     component, same validation).
   - `Dashboard.tsx`'s gold-value calculator (replaces its `calcP` 3-option `<select>`).

6. **Frontend: rate publish/display**:
   - `RateModal.tsx` — drop the K22/K18 inputs; only K24 is entered.
   - `NewLoan.tsx`'s inline "Set today's gold rate" recovery banner — same reduction to K24-only.
   - `Topbar.tsx`/`GoldRates.tsx`/`Dashboard.tsx`'s rate tiles — keep showing 22K/18K tiles, but as
     **client-side computed** values (`k24 × 22/24`, `k24 × 18/24`, rounded to the nearest rupee) labeled
     distinctly from the published K24 figure (e.g. a "computed" tag/tooltip) rather than reading
     now-nonexistent `latest.k22`/`latest.k18` fields.
   - `goldRateApi.ts`/`GoldRatesProvider.tsx` types drop `k22`/`k18` from `GoldRateView`/`BackendGoldRate`
     and add the client-side computed helper used by the tiles above.

7. **Docs**: update `documents/api_documentation.md`'s gold-rate and ornament sections, and
   `documents/change_log.md`, per the keep-docs-in-sync convention.

## Key decisions & tradeoffs
- **Only 24K is published; 22K/18K/etc. are computed per-ornament, not stored as daily rates.** Matches the
  user's explicit direction — simpler daily workflow, and purity resolution happens exactly where it's
  needed (at valuation time) rather than requiring every possible purity to be pre-published.
- **`purity_standards` is suggestion-only, no FK from Ornament/GoldRate.** Ornament stores a plain
  unit-suffixed string, converted/computed at save time — avoids the complexity and historical-drift risk
  of a fully-normalized FK (editing a `purity_standards` row later can't silently reinterpret old
  ornaments), at the cost of not being able to bulk-rename a purity later. Acceptable since purity_standards
  exists purely to power suggestions, not to be a source of truth.
- **Legacy K22/K18 columns renamed, not dropped.** Preserves real historical staff-entered figures (which
  are not reconstructable from K24 × ratio, since they were independently entered) without carrying them
  forward as live, writable fields.
- **Unit-suffixed string format (`"22K"` / `"91.6%"`) over normalized-to-fineness%.** Self-describing,
  requires no separate "unit" column, and existing historical Ornament.Purity values already conform to the
  `"<int>K"` half of the new format — zero-migration for existing ornament data.
- **Rounding to the nearest whole rupee on the per-gram rate**, before multiplying into GoldValue — matches
  existing precision conventions (K24 and the old K22/K18 were always whole-rupee).
- **Full consistency across all purity-entry surfaces** (ornament pledge, purity re-test, Dashboard
  calculator) via one shared `PurityPicker` component, rather than fixing only the primary loan-creation
  flow and leaving others on the old 3-option dropdown.

## Risks / open questions
- None outstanding after the grill — all scope questions (schema shape, legacy data handling, format,
  rounding, which UI surfaces to update, seed range) were resolved above.

## Out of scope
- Reconstructing/backfilling historical K22/K18 "what it would have computed to" values — legacy columns
  are preserved as-is (renamed), not recomputed or exposed through new API fields.
- A management/reporting view over the renamed `legacy_k22`/`legacy_k18` columns — noted as a possible
  future follow-up, not built here.
- Any change to `Scheme.LTVPercent`/haircut modeling (raised in earlier discussion) — purity/rate handling
  only.
