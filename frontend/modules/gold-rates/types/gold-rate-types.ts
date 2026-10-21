

// Every publish is an append-only row; the latest row by Date/ID is treated as current.
export type BackendGoldRate = {
  id: number;
  date: string; // RFC3339
  k24: number;
  k22: number;
  k18: number;
  setBy: string;
  createdAt: string;
};
// k22/k18 fall back to a client-side computation off k24 for rows predating independent publishing.
export type GoldRateView = {
  id: string;
  date: string; // "YYYY-MM-DD"
  k24: number;
  k22: number;
  k18: number;
  setBy: string;
};
// karat: which single column is being set; the other two carry forward unchanged server-side.
export type GoldRatePublishInput = {
  karat: 24 | 22 | 18;
  rate: number;
  setBy: string;
};
