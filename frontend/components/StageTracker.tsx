/* Shared progress-stepper UI for any fixed, ordered stage chain — used by
 * LoanDetail.tsx's 4-stage loan sanction chain and Auctions.tsx's 7-stage
 * auction workflow. Replaces what used to be a per-page, purely-decorative
 * `<div className="track">` (see Auctions.tsx's old STAGES.indexOf(l.status)
 * track) with one component that actually reflects a real current-stage
 * value passed in by the caller, rather than deriving progress from a
 * loosely-related status string. */
export function StageTracker({
  stages,
  currentIndex,
  terminal,
}: {
  stages: string[];
  /** Index into `stages` of the currently-active/next-pending stage, or
   * stages.length if every stage is done. */
  currentIndex: number;
  /** When set (e.g. "Rejected"), renders as a red terminal marker instead
   * of the normal stage list — the chain stopped before completing. */
  terminal?: string;
}) {
  if (terminal) {
    return (
      <div className="track">
        <div className="st done" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{terminal}</div>
      </div>
    );
  }
  return (
    <div className="track">
      {stages.map((s, i) => (
        <div key={s} className={`st ${i < currentIndex ? "done" : i === currentIndex ? "on" : ""}`}>{s}</div>
      ))}
    </div>
  );
}
