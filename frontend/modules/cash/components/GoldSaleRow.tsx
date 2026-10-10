"use client";

import { fmt, fmtDate } from "@/common/utils/format";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { modeCellFor } from "@/modules/cash/utils/ledgerCells";
import { type GoldSaleView } from "@/modules/cash/types/cash-types";
import { useShowBranch } from "@/common/hooks/use-branch-switch";

type GoldSaleRowProps = { g: GoldSaleView };

export function GoldSaleRow({ g }: GoldSaleRowProps) {
  const showBranch = useShowBranch();
  return (
    <tr>
      <td>{fmtDate(g.d)}</td>
      <td>{g.ornamentType}</td>
      <td className="num">{fmt(g.soldAmount)}</td>
      <td className="num">{fmt(g.costAmount)}</td>
      <td className="num" style={{ color: g.profit >= 0 ? "var(--green)" : "var(--red)" }}>
        {g.profit >= 0 ? "+" : "−"}{fmt(Math.abs(g.profit))}
      </td>
      <td>{modeCellFor(g.mode)}</td>
      <td>{g.bankId ? <LedgerRefLink kind="bank" id={g.bankId} label={g.bankName || "Bank"} /> : "—"}</td>
      {showBranch && <td>{g.branch}</td>}
      <td>{g.remarks || "—"}</td>
    </tr>
  );
}
