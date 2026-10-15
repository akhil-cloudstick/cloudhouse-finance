"use client";

import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { EntryInfoModalContent } from "@/modules/cash/components/EntryInfoModalContent";
import { getMovementEntry } from "@/modules/cash/services/cashService";
import { RowInfoModalContent } from "@/modules/cash/components/RowInfoModalContent";
import { type LedgerRowView } from "@/modules/cash/types/cash-types";

type LedgerEntryActionsProps = {
  // The cash movement behind the row. Every row with an entryId gets the info
  // icon; `editable` only decides whether its popup also offers Edit.
  entryId?: number;
  editable?: boolean;
  // The ledger row itself: lets a row with no entryId (a loan payment…) still
  // show an info popup built from its own fields.
  row?: LedgerRowView;
  // Called after an edit is saved, so the table can reload.
  onChanged?: () => void;
};

const btn = { border: 0, background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "inline-flex", alignItems: "center" } as const;

/* The info icon (remarks + details popup) every ledger row shows. Edit lives
 * inside that popup and only appears there when the entry is one a person
 * keyed in (cash-in, debit, self transfer). It sits in the Balance cell's
 * right padding (.ledger-info, app.css) so it adds no width to the table; in
 * the stacked card layout it flows inline. */
export function LedgerEntryActions({ entryId, row, onChanged }: LedgerEntryActionsProps) {
  const { openModal } = useModal();
  if (!entryId && !row) return null;
  return (
    <span className="ledger-info">
      <button
        type="button" title="Details & remarks" aria-label="Entry details" style={btn}
        onClick={async (e) => {
          e.stopPropagation();
          if (!entryId) { openModal(<RowInfoModalContent row={row!} />); return; }
          // Fetch first, then open once with everything in place; if the fetch fails the popup opens and shows its own error.
          const initial = await getMovementEntry(entryId).catch(() => undefined);
          openModal(<EntryInfoModalContent entryId={entryId} onChanged={onChanged} initial={initial} />);
        }}
      ><Icon name="info" /></button>
    </span>
  );
}
