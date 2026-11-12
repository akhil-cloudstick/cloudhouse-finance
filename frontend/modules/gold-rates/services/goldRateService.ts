import { apiFetchEnveloped as apiFetch, ApiError, quietly } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { refuse } from "@/common/offline/validate";
import { localToday } from "@/common/utils/format";
import { rateForKarat, finenessFromRate } from "@/common/utils/purity";
import type { BackendGoldRate, GoldRateView, GoldRatePublishInput } from "@/modules/gold-rates/types/gold-rate-types";

function toView(r: BackendGoldRate): GoldRateView {
	const k22 = r.k22 > 0 ? r.k22 : rateForKarat(r.k24, 22);
	const k18 = r.k18 > 0 ? r.k18 : rateForKarat(r.k24, 18);
	return {
		id: String(r.id),
		date: r.date ? r.date.slice(0, 10) : "",
		k24: r.k24,
		k22,
		k18,
		// Rows from before fineness was stored fall back to what their rates imply.
		fineness22: r.fineness22 && r.fineness22 > 0 ? r.fineness22 : finenessFromRate(r.k24, k22, 22),
		fineness18: r.fineness18 && r.fineness18 > 0 ? r.fineness18 : finenessFromRate(r.k24, k18, 18),
		setBy: r.setBy,
		setByDesignation: r.setByDesignation || "",
		createdAt: r.createdAt || "",
		entries: r.entries?.map(toView),
	};
}

export async function listGoldRates(): Promise<GoldRateView[]> {
	const rec = await apiFetch<BackendGoldRate[]>("/gold-rates");
	return (rec || []).map(toView);
}

export const GOLD_RATES_HISTORY_PAGE_SIZE = 10;

/* Paginated variant of listGoldRates — backs GoldRates.tsx's Rate History
 * table. `page` is 1-based; the backend responds with an {items, hasMore}
 * envelope whenever `limit` is passed (see backend/internal/goldrate/
 * handler.go's List), matching loansApi.listLoansPage's pattern. */
export async function listGoldRatesPage(
	page: number,
	limit?: number
): Promise<{ items: GoldRateView[]; hasMore: boolean; total: number }> {
	const pageSize = limit ?? (typeof window !== "undefined" && (window.innerWidth < 1600 || window.innerHeight < 950) ? 6 : 10);
	const params = new URLSearchParams({
		limit: String(pageSize),
		offset: String((page - 1) * pageSize),
	});
	const rec = await apiFetch<{ items: BackendGoldRate[]; hasMore: boolean; total?: number }>(`/gold-rates?${params}`);
	return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

/* Rate History table: one item per calendar day — the day's newest rate, with
 * every change of that day in `entries`. `from` / `to` ("YYYY-MM-DD") narrow to a range of days. */
export async function listGoldRateDaysPage(
	page: number,
	limit: number,
	from?: string,
	to?: string,
	q?: string
): Promise<{ items: GoldRateView[]; hasMore: boolean; total: number }> {
	const params = new URLSearchParams({
		limit: String(limit),
		offset: String((page - 1) * limit),
		group: "day",
	});
	if (from) params.set("from", from);
	if (to) params.set("to", to);
	if (q?.trim()) params.set("search", q.trim());
	const rec = await apiFetch<{ items: BackendGoldRate[]; hasMore: boolean; total?: number }>(`/gold-rates?${params}`);
	return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function getLatestGoldRate(): Promise<GoldRateView | null> {
	const rec = await apiFetch<BackendGoldRate>("/gold-rates/latest");
	return rec ? toView(rec) : null;
}

export async function publishGoldRate(input: GoldRatePublishInput): Promise<GoldRateView> {
	// offline mode running: the rate is queued at once, the server is not asked first
	if (offlineReady()) return (await queueIfUnreachable(new ApiError("", 0), { [input.karat]: input.rate }, input.setBy))!;
	try {
		// quiet: when the server does not answer the rate is queued below, so no "couldn't reach" pop-up is wanted
		const rec = await quietly(() =>
			apiFetch<BackendGoldRate>("/gold-rates", {
				method: "POST",
				body: JSON.stringify(input),
			}),
		);
		return toView(rec);
	} catch (e) {
		const queued = await queueIfUnreachable(e, { [input.karat]: input.rate }, input.setBy);
		if (queued) return queued;
		throw e;
	}
}

/* Publishes every changed karat as ONE history row (keys 24/22/18). `fineness` (keys 22/18) saves the Auto-mode
 * fineness with it; omitted, the last one carries forward. */
export async function publishGoldRates(rates: Partial<Record<24 | 22 | 18, number>>, setBy: string, fineness?: Partial<Record<22 | 18, number>>, date?: string): Promise<GoldRateView> {
	if (offlineReady()) return (await queueIfUnreachable(new ApiError("", 0), rates, setBy, fineness, date))!;
	try {
		const rec = await quietly(() =>
			apiFetch<BackendGoldRate>("/gold-rates", {
				method: "POST",
				body: JSON.stringify({ rates, setBy, ...(fineness ? { fineness } : {}), ...(date ? { date } : {}) }),
			}),
		);
		return toView(rec);
	} catch (e) {
		const queued = await queueIfUnreachable(e, rates, setBy, fineness, date);
		if (queued) return queued;
		throw e;
	}
}

/* Desktop, server not answering: the rate goes into the outbox with its date (the day it was set, today unless the form
 * picked another, not the day it is sent) and shows as the latest rate at once (see common/offline/goldRateAdjust.ts). */
async function queueIfUnreachable(e: unknown, rates: Partial<Record<number, number>>, setBy: string, fineness?: Partial<Record<22 | 18, number>>, setOn?: string): Promise<GoldRateView | null> {
	if (!offlineReady() || !(e instanceof ApiError) || e.status !== 0) return null;
	checkRates(rates, setBy, fineness);
	const date = setOn || localToday();
	const entry = newEntry("POST", "/gold-rates", { rates, setBy, date, ...(fineness ? { fineness } : {}) }, currentActor());
	await enqueueAndWait(entry, () => undefined, () => undefined);
	const view = await getLatestGoldRate().catch(() => null);
	if (view) return view;
	const k24 = rates[24] ?? 0, k22 = rates[22] ?? 0, k18 = rates[18] ?? 0;
	return {
		id: "", date, k24, k22, k18,
		fineness22: fineness?.[22] ?? finenessFromRate(k24, k22, 22),
		fineness18: fineness?.[18] ?? finenessFromRate(k24, k18, 18),
		setBy, setByDesignation: "", createdAt: new Date().toISOString(),
	};
}

/* The server's field rules for publishing a rate (common/controllers/gold_rate.go), applied before a rate is queued. */
function checkRates(rates: Partial<Record<number, number>>, setBy: string, fineness?: Partial<Record<22 | 18, number>>) {
	if (fineness) {
		for (const [k, v] of Object.entries(fineness)) {
			if (k !== "22" && k !== "18") refuse("fineness can only be set for 22K or 18K");
			if (!(Number(v) > 0 && Number(v) <= 100)) refuse("fineness must be above 0% and at most 100%");
		}
	}
	for (const [k, v] of Object.entries(rates)) {
		if (k !== "24" && k !== "22" && k !== "18") refuse("karat must be 24, 22, or 18");
		if (!(Number(v) > 0)) refuse("rate must be greater than zero");
	}
	if (!(setBy ?? "").trim()) refuse("set_by is required");
}
