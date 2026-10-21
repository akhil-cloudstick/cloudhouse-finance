

// Endpoint streams newline-delimited JSON, not one envelope, so it isn't built on apiFetchEnveloped.
export type ResetReport = {
  deleted: Record<string, number>; // table name -> rows removed
  created: Record<string, number>; // entity name -> rows seeded
  filesRemoved: number;
  adminUsername: string;
  durationMs: number;
  seededAt: string;
};
export type ResetProgress = {
  step: string;
  index: number;
  total: number;
};
export type StreamEvent = Partial<ResetProgress> & {
  error?: string;
  done?: boolean;
  report?: ResetReport;
};
