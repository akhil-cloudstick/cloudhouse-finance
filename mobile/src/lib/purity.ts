/* Shared purity math, ported from frontend/lib/purity.ts (itself mirroring
 * backend/internal/loan/purity.go's ParsePurity/rateForPurity exactly), so
 * the mobile New Loan preview matches what the server will actually compute
 * and store. Only the 24K benchmark is ever published — every other purity
 * is resolved here, per-ornament, at entry time. */

export const MIN_KARAT = 10;
export const MAX_KARAT = 24;
export const MIN_FINENESS_PERCENT = 0; // exclusive
export const MAX_FINENESS_PERCENT = 100;
// 24K is quoted as 999 (99.9% pure). Shown fixed and read-only in the Set
// Rate modal; it labels the 24K rate rather than scaling it — 24K IS the
// reference every other karat derives from.
export const FINENESS_24K = 99.9;

export type PurityUnit = "karat" | "fineness";

export function isKaratInRange(karat: number): boolean {
  return karat >= MIN_KARAT && karat <= MAX_KARAT;
}

export function isFinenessInRange(finenessPercent: number): boolean {
  return finenessPercent > MIN_FINENESS_PERCENT && finenessPercent <= MAX_FINENESS_PERCENT;
}

/* The exact karat/24 ratio, rounded to 1 decimal — matches
 * puritystandard.FinenessForKarat, used to seed/suggest fineness% for a
 * given karat (Auto-mode gold rate publishing). */
export function finenessForKarat(karat: number): number {
  return Math.round((karat / 24) * 1000) / 10;
}

/* The fineness% a published rate implies against its K24 — the inverse of
 * rateForFineness, to 2 decimals. Fineness itself is never stored (only the
 * three rates are), so the gold-rate modal uses this to restore the fineness
 * last used for a karat instead of resetting to the standard karat/24 ratio.
 * Falls back to the standard ratio when either rate is missing, or the
 * result isn't a valid fineness. */
export function finenessFromRate(k24: number, rate: number, karat: number): number {
  if (!(k24 > 0) || !(rate > 0)) return finenessForKarat(karat);
  const f = Math.round((rate / k24) * 10000) / 100;
  return isFinenessInRange(f) ? f : finenessForKarat(karat);
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
 * Ornament.Purity — "22K" or "91.6%". */
export function formatPurity(unit: PurityUnit, value: number): string {
  return unit === "karat" ? `${value}K` : `${value}%`;
}

/* Parses a stored/typed purity string ("22K" or "91.6%") back into its unit
 * + numeric value. Returns null for anything that doesn't match either
 * shape or falls outside range — mirrors loan/purity.go's ParsePurity. */
export function parsePurity(purity: string): { unit: PurityUnit; value: number } | null {
  const karatMatch = /^(\d+)K$/i.exec(purity.trim());
  if (karatMatch) {
    const karat = Number(karatMatch[1]);
    return isKaratInRange(karat) ? { unit: "karat", value: karat } : null;
  }
  const finenessMatch = /^(\d+(?:\.\d+)?)%$/.exec(purity.trim());
  if (finenessMatch) {
    const fineness = Number(finenessMatch[1]);
    return isFinenessInRange(fineness) ? { unit: "fineness", value: fineness } : null;
  }
  return null;
}

/* Resolves a purity string's per-gram rate off K24 — returns null if the
 * string doesn't parse (caller should treat that as "can't value this
 * ornament yet"). */
export function rateForPurityString(k24: number, purity: string): number | null {
  const parsed = parsePurity(purity);
  if (!parsed) return null;
  return parsed.unit === "karat" ? rateForKarat(k24, parsed.value) : rateForFineness(k24, parsed.value);
}
