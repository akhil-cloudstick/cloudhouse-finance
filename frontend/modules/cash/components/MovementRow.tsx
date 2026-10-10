"use client";

import { fmt, fmtDate } from "@/common/utils/format";
import { particularsFor, refTitleFor, refCellFor, modeCellFor } from "@/modules/cash/utils/ledgerCells";
import { BillLink } from "@/modules/cash/components/BillLink";
import { type CashMovementView } from "@/modules/cash/types/cash-types";

type MovementRowProps = { m: CashMovementView; balance: number; categoryIds: Record<string, number> };

export function MovementRow({ m, balance, categoryIds }: MovementRowProps) {
  return (
    <tr data-ledger-key={`m-${m.id}`} data-ledger-date={m.d} data-ledger-amount={m.amount}>
      <td data-label="Date">{fmtDate(m.d)}</td>
      <td className="ledger-ref" data-label="Ref No" title={refTitleFor(m)}>{refCellFor(m, categoryIds)}</td>
      <td data-label="Particulars">{particularsFor(m, categoryIds)}<BillLink url={m.receiptImage} title={m.purpose || m.source || "Entry"} /></td>
      <td data-label="Mode">{modeCellFor(m.mode)}</td>
      <td className="num" data-label="Debit" style={{ color: m.type === "out" ? "var(--red)" : undefined }}>{m.type === "out" ? fmt(m.amount) : "—"}</td>
      <td className="num" data-label="Credit" style={{ color: m.type === "in" ? "var(--green)" : undefined }}>{m.type === "in" ? fmt(m.amount) : "—"}</td>
      <td className="num" data-label="Balance">{fmt(balance)}</td>
    </tr>
  );
}
