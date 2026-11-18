// Mirrors backend/internal/goldrate/model.go's JSON shape.
export type GoldRate = {
  id: number;
  date: string;
  k24: number;
  // K22/K18 can now be independently published (Manual mode) or derived
  // and stored explicitly (Auto mode) — see backend/internal/goldrate/
  // model.go's own doc comment. Carried forward unchanged from the
  // previous latest row when a publish only touches one karat.
  k22: number;
  k18: number;
  setBy: string;
  /** The setter's role (designation), stamped by the server. */
  setByDesignation?: string;
  createdAt: string;
  /** Day-grouped listing only (`group=day`): every change made that day, newest first. */
  entries?: GoldRate[];
};
