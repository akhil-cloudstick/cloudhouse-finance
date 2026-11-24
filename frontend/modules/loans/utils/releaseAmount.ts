import { type LoanView } from "@/modules/loans/types/loan-types";
import { roundRupee } from "@/common/utils/format";

// Mirrors backend partialReleaseDrift (release.go): what the balance sits above what the ornaments that stay can support.
export function partialReleaseRemaining(outstandingBalance: number, remainingGoldValue: number, ltvPercent: number): number {
	return outstandingBalance - (remainingGoldValue * ltvPercent) / 100;
}

// What must be paid (payment plus discount) before this release's gold can go, from the loan as it stands now —
// the same figure the backend checks when the payment is recorded (releaseAmountNeeded in release.go).
// `keptOrnamentIds` are the ornaments that stay pledged after a partial release; null means a full release.
// Like the backend, the figure is a whole rupee (RoundMoney): ₹11,852.20 outstanding means ₹11,852 must be paid, not ₹11,852.20.
// `excludedOrnamentIds` are ornaments locked by an earlier open release request: left out of the sum entirely.
export function releaseAmountNeeded(loan: LoanView, keptOrnamentIds: number[] | null, excludedOrnamentIds: number[] = []): number {
	if (keptOrnamentIds == null) return roundRupee(Math.max(loan.totalOutstandingBalance, 0));
	const keptValue = loan.ornaments.filter((o) => !o.releasedAt && keptOrnamentIds.includes(o.id) && !excludedOrnamentIds.includes(o.id)).reduce((sum, o) => sum + o.goldValue, 0);
	return roundRupee(Math.max(partialReleaseRemaining(loan.totalOutstandingBalance, keptValue, loan.schemeLtv), 0));
}
