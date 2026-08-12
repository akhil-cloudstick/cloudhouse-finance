/* Shared purity math + formatting, mirroring backend/internal/loan/purity.go
 * exactly (ParsePurity/rateForPurity) so the client-side preview shown while
 * filling a form always matches what the server will actually compute and
 * store. Only the 24K benchmark is ever published (see goldRateApi.ts) —
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
 * this ornament yet", matching the backend's ErrInvalidPurity). */
export function rateForPurityString(k24: number, purity: string): number | null {
  const parsed = parsePurity(purity);
  if (!parsed) return null;
  return parsed.unit === "karat" ? rateForKarat(k24, parsed.value) : rateForFineness(k24, parsed.value);
}
