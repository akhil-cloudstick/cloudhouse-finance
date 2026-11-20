

/* The demo-data reset.
 *
 * Not built on apiFetchEnveloped like every other service in this codebase,
 * and the exception is deliberate: this endpoint answers with a STREAM of
 * newline-delimited JSON rather than one envelope, so the operator can watch
 * the phases tick past instead of staring at a frozen screen for the several
 * seconds the reset takes. apiFetchEnveloped reads the whole body and parses
 * it as a single object, which is exactly what has to be avoided here.
 *
 * See internal/demoreset/handler.go for the protocol and why it is NDJSON.
 */

export type ResetReport = {
  /** table name -> rows removed */
  deleted: Record<string, number>;
  /** entity name -> rows seeded */
  created: Record<string, number>;
  filesRemoved: number;
  /** The login that was preserved. */
  adminUsername: string;
  durationMs: number;
  seededAt: string;
};
/** One completed phase, as reported by the seeder. */
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
