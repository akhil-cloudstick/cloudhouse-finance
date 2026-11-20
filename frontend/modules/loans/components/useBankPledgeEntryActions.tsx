"use client";

import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { getBankPledgeHistory } from "@/modules/loans/services/loanService";
import { BankPledgeEditModalContent } from "@/modules/loans/components/BankPledgeEditModalContent";

/* Opens the bank pledge editor (edit or delete) for a pledge record, e.g. from the main ledger's entry popup. The
 * editor opens on top of the popup: closing it brings the popup back, and saving it closes both and reloads. */
export function useBankPledgeEntryActions(onChanged?: () => void) {
  const { openChildModal, closeAllModals } = useModal();
  const toast = useToast();
  const saved = () => { onChanged?.(); closeAllModals(); };

  return {
    async pledge(loanId: number, pledgeId: number, mode: "edit" | "delete") {
      try {
        const recs = await getBankPledgeHistory(loanId);
        const rec = recs.find((r) => r.id === pledgeId);
        if (!rec) { toast("This bank pledge could not be found on its loan."); return; }
        if (rec.status === "Voided") { toast("A voided bank pledge is kept as history and cannot be edited."); return; }
        openChildModal(<BankPledgeEditModalContent loanId={loanId} pledge={{ ...rec, bankId: rec.bankId ?? null }} mode={mode} onSaved={saved} />, true);
      } catch { toast("Could not open this entry — try again."); }
    },
  };
}
