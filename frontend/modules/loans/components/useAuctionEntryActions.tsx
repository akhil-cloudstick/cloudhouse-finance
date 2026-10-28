"use client";

import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { getLoan } from "@/modules/loans/services/loanService";
import { AuctionEditModalContent, type AuctionEditKind } from "@/modules/loans/components/AuctionEditModalContent";

/* Opens the auction editors (the sale, its surplus settlement, its write-off) from a ledger entry's info popup. The
 * editor opens on top of the popup: closing it brings the popup back, saving it closes both and reloads the ledger. */
export function useAuctionEntryActions(onChanged?: () => void) {
  const { openChildModal, closeAllModals } = useModal();
  const toast = useToast();
  const saved = () => { onChanged?.(); closeAllModals(); };

  return {
    async open(loanId: number, kind: AuctionEditKind, mode: "edit" | "delete") {
      try {
        const loan = await getLoan(loanId);
        openChildModal(<AuctionEditModalContent loanId={loan.numericId} kind={kind} mode={mode} minDate={loan.disbursementDate?.slice(0, 10) || undefined} onSaved={saved} />, true);
      } catch { toast("Could not open this entry — try again."); }
    },
  };
}
