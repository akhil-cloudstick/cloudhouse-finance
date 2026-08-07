import { statusChipColor } from "@/lib/format";

/* Ported from legacy/app.js's `statusChip(s)` helper. */
export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${statusChipColor(status)}`}>{status}</span>;
}
