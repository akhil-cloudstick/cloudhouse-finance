/* The auction stage of each loan, kept on this PC. The loan records do not carry it (it lives on the loan's latest auction
 * case), yet the Auctions page filters loans by it. It is filled from the server's own answer for each loan's case (see warm.ts)
 * and moved at once by an auction step taken on this PC, so a step shows in the table before it has been sent. A pull replaces
 * the loan records but never this, so it is a file of its own. */

import { offlineStore } from "@/common/services/desktopBridge";

const FILE = "data/auction_stages.json";
let stages: Record<string, string> = {};
let writes: Promise<void> = Promise.resolve();

export async function loadAuctionStages(): Promise<void> {
	try {
		const text = await offlineStore.readFile(FILE);
		stages = text ? (JSON.parse(text) as Record<string, string>) : {};
	} catch {
		stages = {};
	}
}

/* What the loan's status alone says, for a loan whose case was never read on this PC. */
function fromStatus(status: string | undefined): string | undefined {
	if (status === "Auction Eligible") return "AuctionEligible";
	if (status === "Auctioned" || status === "Auctioned - Balance Due") return "Auctioned";
	return undefined;
}

export function auctionStageOf(loanId: number, status?: string): string | undefined {
	return stages[String(loanId)] ?? fromStatus(status);
}

/* `null` forgets the loan's stage (it has no case any more). */
export function setAuctionStage(loanId: number, stage: string | null): void {
	const key = String(loanId);
	if ((stages[key] ?? null) === stage) return;
	const next = { ...stages };
	if (stage) next[key] = stage;
	else delete next[key];
	stages = next;
	const snapshot = JSON.stringify(next);
	writes = writes.then(() => offlineStore.writeFile(FILE, snapshot)).catch(() => {});
}
