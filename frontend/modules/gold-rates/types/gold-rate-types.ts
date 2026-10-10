

/* Shape returned by the Go backend (backend/internal/goldrate/model.go's
 * GoldRate). Every publish is an append-only row — there is no in-place
 * "current rate" record; the latest row by Date/ID is treated as current.
 * K24 is always published directly; K22/K18 can now ALSO be published
 * directly (Manual mode — see RateModalContent), independent of what
 * K24×ratio would derive, or left to carry forward from the previous
 * latest row. (These are new, live columns — not a revival of the old,
 * unrelated legacy_k22/legacy_k18 columns, which stay retired.) */
export type BackendGoldRate = {
  id: number;
  date: string; // RFC3339
  k24: number;
  k22: number;
  k18: number;
  setBy: string;
  createdAt: string;
};
/* UI-facing shape — field names match what GoldRates.common/components/modals/RateModalContent.tsx/
 * Topbar.modules/loans/pages/NewLoanPage.tsx/Dashboard.tsx already expect from the old
 * common/utils/data.ts Rates/RateHistoryEntry shapes. k22/k18 reflect whatever the
 * backend actually stored — a genuinely independently-published Manual
 * rate, an Auto-derived rate that was explicitly published, or (for rows
 * predating this feature, where the column is still its default zero) a
 * live client-side fallback computed off k24, same formula the backend
 * itself falls back to (see internal/loan/purity.go's rateForPurity). */
export type GoldRateView = {
  id: string;
  date: string; // "YYYY-MM-DD"
  k24: number;
  k22: number;
  k18: number;
  setBy: string;
};
/* karat: which single column this publish is setting (24, 22, or 18) —
 * Manual mode types `rate` directly for the chosen karat; Auto mode
 * computes `rate` client-side off the latest k24 and an editable
 * fineness%, then publishes it the same way. The other two columns carry
 * forward unchanged server-side (see backend PublishInput's doc comment).
 * `karat` defaults to 24 server-side when omitted, so any older caller
 * that only ever sent {k24, setBy} keeps working unchanged. */
export type GoldRatePublishInput = {
  karat: 24 | 22 | 18;
  rate: number;
  setBy: string;
};
