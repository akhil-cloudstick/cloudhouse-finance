/* Auction steps taken on this PC and not sent yet. A loan's auction case on screen (GET /loans/:id/auction) is the server's last
 * answer, which cannot know about them, so each waiting step (eligible, notice, schedule, sale, settle) is applied to that
 * answer in order, the way the server will once it is sent. When it has been sent the server's own answer includes it and it is
 * no longer in the outbox, so nothing is applied twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import type { OutboxEntry } from "./types";

const STAGE_OF: Record<string, string> = { eligible: "AuctionEligible", notice: "NoticeIssued", schedule: "AuctionScheduled", sale: "Auctioned", settle: "Settled" };

type Step = { loanId: number; step: string; body: Record<string, unknown>; at: string };

export async function waitingAuctionSteps(loanId?: number): Promise<Step[]> {
	const found: Step[] = [];
	for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
		try {
			const e = JSON.parse(line) as OutboxEntry;
			const m = /^\/loans\/(\d+)\/auction\/(eligible|notice|schedule|sale|settle)$/.exec(e.path.split("?")[0]);
			if (e.method !== "POST" || !m) continue;
			if (loanId !== undefined && Number(m[1]) !== loanId) continue;
			found.push({ loanId: Number(m[1]), step: m[2], body: (e.body ?? {}) as Record<string, unknown>, at: e.occurredAt });
		} catch {
			/* a line that cannot be read adds nothing */
		}
	}
	return found;
}

/* What each step puts on the case besides its new stage. */
function patchOf(s: Step): Record<string, unknown> {
	switch (s.step) {
		case "schedule":
			return { auctionDate: s.body.auctionDate ?? null, auctionReferenceNumber: s.body.referenceNumber ?? "" };
		case "sale":
			return { saleAmount: s.body.saleAmount ?? 0, auctionExpenses: s.body.auctionExpenses ?? 0 };
		case "settle":
			return { surplusDisposition: s.body.disposition ?? "", surplusRemarks: s.body.remarks ?? "" };
		default:
			return {};
	}
}

/* GET /loans/:id/auction[?optional=1]: the case with the waiting steps applied; a loan with no case yet gets one. */
export async function adjustAuctionRecord(path: string, body: string): Promise<string> {
	const m = /\/loans\/(\d+)\/auction(\?|$)/.exec(path);
	if (!m) return body;
	const steps = await waitingAuctionSteps(Number(m[1]));
	if (!steps.length) return body;
	try {
		const env = JSON.parse(body) as { data?: Record<string, unknown> | null };
		let rec: Record<string, unknown> = env.data && typeof env.data === "object" ? { ...env.data } : { id: 0, loanId: Number(m[1]), notices: [], events: [], decisionRequests: [] };
		for (const s of steps) rec = { ...rec, ...patchOf(s), stage: STAGE_OF[s.step], syncPending: true };
		env.data = rec;
		return JSON.stringify(env);
	} catch {
		return body;
	}
}
