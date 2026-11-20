"use client";

import { type LedgerEditDependent, type LedgerGoldChoices } from "@/modules/loans/services/loanService";

type Props = {
  dependents: LedgerEditDependent[];
  chosen: Record<string, boolean>;
  onToggle: (kind: string, on: boolean) => void;
};

/* What a gold release did that an edit may need to undo — the gold packet, a partial release — each with a box.
 * Ticked ones are undone in the same save as the edit; a warning (e.g. a full locker) shows while its box is ticked. */
export function GoldReleaseDependents({ dependents, chosen, onToggle }: Props) {
  if (!dependents.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <label className="f">This also affects the gold released for this loan</label>
      {dependents.map((d) => (
        <label key={d.kind} className="ccheck" style={{ margin: "6px 0" }}>
          <input type="checkbox" checked={!!chosen[d.kind]} onChange={(e) => onToggle(d.kind, e.target.checked)} />
          <span className="mark" />
          <span>
            <b>Also update this:</b> {d.description}
            <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{d.current} → {d.suggested}</div>
            {d.warning && chosen[d.kind] && <div style={{ fontSize: "0.85em", color: "var(--red)", marginTop: 2 }}>{d.warning}</div>}
          </span>
        </label>
      ))}
    </div>
  );
}

/* The request flags for the boxes that are ticked. */
export function goldChoicesOf(dependents: LedgerEditDependent[] | undefined, chosen: Record<string, boolean>): LedgerGoldChoices {
  return {
    ...(dependents?.some((d) => d.kind === "packet") && chosen.packet ? { reversePacket: true } : {}),
    ...(dependents?.some((d) => d.kind === "partial_release") && chosen.partial_release ? { restorePartialRelease: true } : {}),
  };
}
