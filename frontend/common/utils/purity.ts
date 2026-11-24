// Mirrors backend/internal/loan/purity.go exactly, so the client-side preview matches the server's computation.

export const MIN_KARAT = 10;
export const MAX_KARAT = 24;
export const MIN_FINENESS_PERCENT = 0; // exclusive
export const MAX_FINENESS_PERCENT = 100;
// 24K is quoted as 999 (99.9% pure) and is the reference every other karat derives from.
export const FINENESS_24K = 99.9;

export type PurityUnit = "karat" | "fineness";

export function isKaratInRange(karat: number): boolean {
	return karat >= MIN_KARAT && karat <= MAX_KARAT;
}

export function isFinenessInRange(finenessPercent: number): boolean {
	return finenessPercent > MIN_FINENESS_PERCENT && finenessPercent <= MAX_FINENESS_PERCENT;
}

// Matches puritystandard.FinenessForKarat.
export function finenessForKarat(karat: number): number {
	return Math.round((karat / 24) * 1000) / 10;
}

// Inverse of rateForFineness; restores the fineness last used for a karat since fineness itself isn't stored.
export function finenessFromRate(k24: number, rate: number, karat: number): number {
	if (!(k24 > 0) || !(rate > 0)) return finenessForKarat(karat);
	const f = Math.round((rate / k24) * FINENESS_24K * 100) / 100;
	return isFinenessInRange(f) ? f : finenessForKarat(karat);
}

// Matches loan/purity.go's rateForPurity.
export function rateForKarat(k24: number, karat: number): number {
	return Math.round((k24 * karat) / 24);
}
/* Per-gram rate for a fineness: fineness ÷ 24K fineness (99.9) × K24, as the Set Gold Rate modal defines it. */
export function rateForFineness(k24: number, finenessPercent: number): number {
	return Math.round((k24 * finenessPercent) / FINENESS_24K);
}

// Canonical unit-suffixed string stored on Ornament.Purity / OrnamentPurityTest.TestedPurity.
export function formatPurity(unit: PurityUnit, value: number): string {
	return unit === "karat" ? `${value}K` : `${value}%`;
}

// Mirrors loan/purity.go's ParsePurity. null if it doesn't match either shape or falls outside range.
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

// null means "can't value this ornament yet" (matches backend's ErrInvalidPurity). Always derives off K24.
export function rateForPurityString(k24: number, purity: string): number | null {
	const parsed = parsePurity(purity);
	if (!parsed) return null;
	return parsed.unit === "karat" ? rateForKarat(k24, parsed.value) : rateForFineness(k24, parsed.value);
}

// Unlike rateForPurityString, exact 22K/18K use their own published rate if set (>0); everything else derives off K24.
// Use where a live estimate must match the backend's actual enforcement (e.g. Edit Loan's eligible-amount preview).
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
