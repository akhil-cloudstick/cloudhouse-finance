"use client";

import { fmt, fmtDate } from "@/common/utils/format";
import { TruncText } from "@/common/components/ui/TruncText";
import { LedgerEntryActions } from "@/modules/cash/components/LedgerEntryActions";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { modeCellFor } from "@/modules/cash/utils/ledgerCells";
import { type GoldSaleView } from "@/modules/cash/types/cash-types";
import { useShowBranch } from "@/common/hooks/use-branch-switch";

type GoldSaleRowProps = { g: GoldSaleView; onChanged?: () => void };

export function GoldSaleRow({ g, onChanged }: GoldSaleRowProps) {
  const showBranch = useShowBranch();
  return (
    <tr>
      <td data-label="Date">{fmtDate(g.d)}</td>
      <td data-label="Ornament Type">{g.ornamentType}</td>
      <td className="num" data-label="Sold For">{fmt(g.soldAmount)}</td>
      <td className="num" data-label="Cost">{fmt(g.costAmount)}{g.costMode && g.costAmount > 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>paid by {g.costMode}</div>}</td>
      <td className="num" data-label="Profit / Loss" style={{ color: g.profit >= 0 ? "var(--green)" : "var(--red)" }}>
        {g.profit >= 0 ? "+" : "−"}{fmt(Math.abs(g.profit))}
      </td>
      <td data-label="Mode">{modeCellFor(g.mode)}</td>
      <td data-label="Bank">{g.bankId ? <LedgerRefLink kind="bank" id={g.bankId} label={g.bankName || "Bank"} /> : "—"}</td>
      {showBranch && <td data-label="Branch">{g.branch}</td>}
      <td data-label="Remarks"><TruncText text={g.remarks} maxWidth={120} /><LedgerEntryActions entryId={g.cashMovementId} onChanged={onChanged} /></td>
    </tr>
  );
}
