import React, { useState } from "react";
import { PrimaryButton, Sheet, type AccAction } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { AuctionEntryEditSheet, type AuctionEditKind } from "@/modules/auctions/components/AuctionEntryEditSheet";

const KIND_LABELS: Record<AuctionEditKind, string> = { sale: "Auction sale", surplus: "Surplus settlement", "write-off": "Write-off" };
type Target = { loanId: number; loanNumber: string; kinds: AuctionEditKind[] };
type Mode = "edit" | "delete";

/** Edit / Delete for the entries an auction books (sale, surplus settlement, write-off), shared by Auction History
 * and the loan ledger's auction rows. Gated like web: can_edit_ledger_entry / can_delete_ledger_entry. With more than
 * one entry on the row the first press asks which one. Render `sheet` once, call `actionsFor` per row. */
export function useAuctionEntryEditor() {
  const { can } = useAuth();
  const canEdit = can("Loan_Management", "can_edit_ledger_entry");
  const canDelete = can("Loan_Management", "can_delete_ledger_entry");
  const [pick, setPick] = useState<(Target & { mode: Mode }) | null>(null);
  const [open, setOpen] = useState<{ loanId: number; loanNumber: string; kind: AuctionEditKind; mode: Mode } | null>(null);

  function start(t: Target, mode: Mode) {
    if (t.kinds.length === 1) setOpen({ loanId: t.loanId, loanNumber: t.loanNumber, kind: t.kinds[0], mode });
    else setPick({ ...t, mode });
  }
  const actionsFor = (t: Target): AccAction[] => [
    ...(canEdit ? [{ label: "Edit", onPress: () => start(t, "edit") }] : []),
    ...(canDelete ? [{ label: "Delete", danger: true, onPress: () => start(t, "delete") }] : []),
  ];
  const sheet = (
    <>
      <Sheet visible={!!pick} onClose={() => setPick(null)} title={pick ? `${pick.mode === "delete" ? "Delete" : "Edit"} — ${pick.loanNumber}` : ""}>
        {pick?.kinds.map((k) => (
          <PrimaryButton
            key={k}
            label={KIND_LABELS[k]}
            variant="outline"
            style={{ marginTop: 10 }}
            onPress={() => {
              setOpen({ loanId: pick.loanId, loanNumber: pick.loanNumber, kind: k, mode: pick.mode });
              setPick(null);
            }}
          />
        ))}
      </Sheet>
      <AuctionEntryEditSheet target={open} onClose={() => setOpen(null)} />
    </>
  );
  return { actionsFor, sheet };
}
