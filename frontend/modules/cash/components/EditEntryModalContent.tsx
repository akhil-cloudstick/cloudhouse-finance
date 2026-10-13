"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { getExpenseEntry, getMovementEntry } from "@/modules/cash/services/cashService";
import { type EntryInfo } from "@/modules/cash/types/cash-types";
import { AddCashModalContent } from "@/modules/cash/components/AddCashModalContent";
import { ExpenseModalContent } from "@/modules/cash/components/ExpenseModalContent";
import { SelfTransferModalContent } from "@/modules/cash/components/SelfTransferModalContent";

// viaExpense: entryId is an expense id (the Expense Register's Edit button), not a cash movement.
type EditEntryModalContentProps = { entryId: number; onSaved?: () => void; info?: EntryInfo; viaExpense?: boolean };

/* The ledger's Edit button for a cash-in, a debit or a self transfer: loads
 * the entry and opens the same form it was recorded with — Credit, Debit or
 * Self Transfer — filled in. Saving replaces the whole entry (every payment
 * line, or both legs of a transfer). */
export function EditEntryModalContent({ entryId, onSaved, info: given, viaExpense }: EditEntryModalContentProps) {
  const { closeModal } = useModal();
  const [info, setInfo] = useState<EntryInfo | null>(given ?? null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (given) return;
    let cancelled = false;
    (viaExpense ? getExpenseEntry(entryId) : getMovementEntry(entryId))
      .then((i) => { if (!cancelled) setInfo(i); })
      .catch(() => { if (!cancelled) setErr("Could not load this entry."); });
    return () => { cancelled = true; };
  }, [entryId, given, viaExpense]);

  if (!info) {
    return (
      <>
        <div className="hd"><h3>Edit Entry</h3><button className="x" onClick={closeModal}>×</button></div>
        <div className="bd"><p style={{ color: err ? "var(--red)" : "var(--muted)", fontSize: 13 }}>{err || "Loading…"}</p></div>
      </>
    );
  }
  if (info.kind === "debit") return <ExpenseModalContent edit={info} onSaved={onSaved} />;
  if (info.kind === "self_transfer") return <SelfTransferModalContent edit={info} onSaved={onSaved} />;
  return <AddCashModalContent edit={info} onSaved={onSaved} />;
}
