"use client";

import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { EntryInfoModalContent } from "@/modules/cash/components/EntryInfoModalContent";

type LedgerEntryActionsProps = {
  // The cash movement behind the row, and whether it is a cash-in / debit /
  // self transfer a person keyed in — every other row shows nothing.
  entryId?: number;
  editable?: boolean;
  // Called after an edit is saved, so the table can reload.
  onChanged?: () => void;
};

const btn = { border: 0, background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "inline-flex", alignItems: "center" } as const;

/* The info icon (remarks + details popup) every ledger table shows at the end
 * of a cash-in, debit or self-transfer row; Edit lives inside that popup. It
 * sits in the Balance cell's right padding (.ledger-info, app.css) so it adds
 * no width to the table; in the stacked card layout it flows inline. */
export function LedgerEntryActions({ entryId, editable, onChanged }: LedgerEntryActionsProps) {
  const { openModal } = useModal();
  if (!editable || !entryId) return null;
  return (
    <span className="ledger-info">
      <button
        type="button" title="Details & remarks" aria-label="Entry details" style={btn}
        onClick={(e) => { e.stopPropagation(); openModal(<EntryInfoModalContent entryId={entryId} onChanged={onChanged} />); }}
      ><Icon name="info" /></button>
    </span>
  );
}
