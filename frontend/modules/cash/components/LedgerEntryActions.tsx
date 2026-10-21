"use client";

import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { EntryInfoModalContent } from "@/modules/cash/components/EntryInfoModalContent";
import { getMovementEntry } from "@/modules/cash/services/cashService";
import { RowInfoModalContent } from "@/modules/cash/components/RowInfoModalContent";
import { type LedgerRowView } from "@/modules/cash/types/cash-types";

type LedgerEntryActionsProps = {
  entryId?: number;
  editable?: boolean;
  row?: LedgerRowView; // lets a row with no entryId still show an info popup built from its own fields
  onChanged?: () => void;
};

const btn = { border: 0, background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "inline-flex", alignItems: "center" } as const;

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
