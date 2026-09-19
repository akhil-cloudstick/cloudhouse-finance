/* Shared purity math + formatting, mirroring backend/internal/loan/purity.go
 * exactly (ParsePurity/rateForPurity) so the client-side preview shown while
 * filling a form always matches what the server will actually compute and
 * store. Only the 24K benchmark is ever published (see
 * modules/gold-rates/services/goldRateService.ts) —
 * every other purity is resolved here, per-ornament, at entry time. */

export const MIN_KARAT = 10;
export const MAX_KARAT = 24;
export const MIN_FINENESS_PERCENT = 0; // exclusive
export const MAX_FINENESS_PERCENT = 100;

export type PurityUnit = "karat" | "fineness";

export function isKaratInRange(karat: number): boolean {
  return karat >= MIN_KARAT && karat <= MAX_KARAT;
}

export function isFinenessInRange(finenessPercent: number): boolean {
  return finenessPercent > MIN_FINENESS_PERCENT && finenessPercent <= MAX_FINENESS_PERCENT;
}

/* The exact karat/24 ratio, rounded to 1 decimal — matches
 * puritystandard.FinenessForKarat, used to seed/suggest fineness% for a
 * given karat. */
export function finenessForKarat(karat: number): number {
  return Math.round((karat / 24) * 1000) / 10;
}

/* Per-gram rate for a purity, off the day's K24 benchmark — rounded to the
 * nearest whole rupee, matching loan/purity.go's rateForPurity. */
export function rateForKarat(k24: number, karat: number): number {
  return Math.round((k24 * karat) / 24);
}
export function rateForFineness(k24: number, finenessPercent: number): number {
  return Math.round((k24 * finenessPercent) / 100);
}

/* Formats a purity into the canonical unit-suffixed string stored on
 * Ornament.Purity / OrnamentPurityTest.TestedPurity — "22K" or "91.6%". */
export function formatPurity(unit: PurityUnit, value: number): string {
  return unit === "karat" ? `${value}K` : `${value}%`;
}

/* Parses a stored/typed purity string back into its unit + numeric value.
 * Returns null for anything that doesn't match either shape or falls
 * outside range — mirrors loan/purity.go's ParsePurity. */
export function parsePurity(purity: string): { unit: PurityUnit; value: number } | null {
  const karatMatch = /^(\d+)K$/.exec(purity);
  if (karatMatch) {
    const karat = Number(karatMatch[1]);
    return isKaratInRange(karat) ? { unit: "karat", value: karat } : null;
  }
  const finenessMatch = /^(\d+(?:\.\d+)?)%$/.exec(purity);
  if (finenessMatch) {
    const fineness = Number(finenessMatch[1]);
    return isFinenessInRange(fineness) ? { unit: "fineness", value: fineness } : null;
  }
  return null;
}

/* Resolves a stored purity string's per-gram rate off K24 — returns null
 * if the string doesn't parse (caller should treat that as "can't value
 * this ornament yet", matching the backend's ErrInvalidPurity). Always
 * derives off K24, even for exactly 22K/18K — see rateForPurityFull below
 * for the version that reads an independently-published K22/K18 instead,
 * where that distinction actually matters. */
export function rateForPurityString(k24: number, purity: string): number | null {
  const parsed = parsePurity(purity);
  if (!parsed) return null;
  return parsed.unit === "karat" ? rateForKarat(k24, parsed.value) : rateForFineness(k24, parsed.value);
}

/* Same as rateForPurityString, but mirrors backend/internal/loan/purity.go's
 * rateForPurity exactly: an ornament at precisely 22K or 18K reads that
 * karat's own independently-published rate (Manual mode may have set it to
 * something other than K24×ratio) when one has actually been published
 * (>0), falling back to the K24-derived figure otherwise — 24K and every
 * other purity (16K, a custom fineness%, etc.) always derives off K24.
 * Use this wherever a live estimate needs to match what the backend will
 * actually compute/enforce (e.g. Edit Loan's eligible-amount preview);
 * rateForPurityString's plain K24-only derivation is intentionally kept
 * everywhere else (New Loan's own valuation panel) unchanged. */
export function rateForPurityFull(rates: { k24: number; k22: number; k18: number }, purity: string): number | null {
  const parsed = parsePurity(purity);
  if (!parsed) return null;
  if (parsed.unit === "karat") {
    if (parsed.value === 24) return Math.round(rates.k24);
    if (parsed.value === 22 && rates.k22 > 0) return Math.round(rates.k22);
    if (parsed.value === 18 && rates.k18 > 0) return Math.round(rates.k18);
    return rateForKarat(rates.k24, parsed.value);
  }
  return rateForFineness(rates.k24, parsed.value);
}
