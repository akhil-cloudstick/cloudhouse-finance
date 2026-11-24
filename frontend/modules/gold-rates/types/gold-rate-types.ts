

// Every publish is an append-only row; the latest row by Date/ID is treated as current.
export type BackendGoldRate = {
	id: number;
	date: string; // RFC3339
	k24: number;
	k22: number;
	k18: number;
	/* 22K/18K fineness % last set in Auto mode; 0 on rows from before it was stored. */
	fineness22?: number;
	fineness18?: number;
	setBy: string;
	setByDesignation?: string;
	createdAt: string;
	/* Only on the day-grouped listing: every change made that day, newest first. */
	entries?: BackendGoldRate[];
};
// k22/k18 fall back to a client-side computation off k24 for rows predating independent publishing.
export type GoldRateView = {
	id: string;
	date: string; // "YYYY-MM-DD"
	k24: number;
	k22: number;
	k18: number;
	/* The 22K/18K fineness % set in Auto mode — the stored value, or for older rows what the rates imply. */
	fineness22: number;
	fineness18: number;
	setBy: string;
	setByDesignation: string;
	/* Time the rate was published (ISO) — tells a day's changes apart. */
	createdAt: string;
	/* Day-grouped listing only: all changes of that day, newest first. */
	entries?: GoldRateView[];
};
// karat: which single column is being set; the other two carry forward unchanged server-side.
export type GoldRatePublishInput = {
	karat: 24 | 22 | 18;
	rate: number;
	setBy: string;
};
