"use client";

import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { EntryInfoModalContent } from "@/modules/cash/components/EntryInfoModalContent";

type LedgerEntryActionsProps = {
  // The cash movement behind the row. Every row with an entryId gets the info
  // icon; `editable` only decides whether its popup also offers Edit.
  entryId?: number;
  editable?: boolean;
  // Called after an edit is saved, so the table can reload.
  onChanged?: () => void;
};

const btn = { border: 0, background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "inline-flex", alignItems: "center" } as const;

/* The info icon (remarks + details popup) every ledger row shows. Edit lives
 * inside that popup and only appears there when the entry is one a person
 * keyed in (cash-in, debit, self transfer). It sits in the Balance cell's
 * right padding (.ledger-info, app.css) so it adds no width to the table; in
 * the stacked card layout it flows inline. */
export function LedgerEntryActions({ entryId, onChanged }: LedgerEntryActionsProps) {
  const { openModal } = useModal();
  if (!entryId) return null;
  return (
    <span className="ledger-info">
      <button
        type="button" title="Details & remarks" aria-label="Entry details" style={btn}
        onClick={(e) => { e.stopPropagation(); openModal(<EntryInfoModalContent entryId={entryId} onChanged={onChanged} />); }}
      ><Icon name="info" /></button>
    </span>
  );
}
