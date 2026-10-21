"use client";

import { fmt } from "@/common/utils/format";

type SplitPartNoteProps = { part: { index: number; count: number }; total: number };

export function SplitPartNote({ part, total }: SplitPartNoteProps) {
  return (
    <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>
      Split {part.index + 1} of {part.count} · total {fmt(total)}
    </div>
  );
}
