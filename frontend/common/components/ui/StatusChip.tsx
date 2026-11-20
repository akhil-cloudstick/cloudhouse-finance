import { statusChipColor } from "@/common/utils/format";

type StatusChipProps = { status: string };

/* Ported from legacy/app.js's `statusChip(s)` helper. */
export function StatusChip({ status }: StatusChipProps) {
  return <span className={`chip ${statusChipColor(status)}`}>{status}</span>;
}
