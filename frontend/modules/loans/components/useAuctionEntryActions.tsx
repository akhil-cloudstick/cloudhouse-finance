"use client";

import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { getLoan } from "@/modules/loans/services/loanService";
import { AuctionConductedEditModalContent } from "@/modules/loans/components/AuctionConductedEditModalContent";
import { type ConcludedAuctionRowView } from "@/modules/loans/types/loan-types";
import { AuctionEditModalContent, type AuctionEditKind } from "@/modules/loans/components/AuctionEditModalContent";

/* Opens the auction editors (the sale, its surplus settlement, its write-off) from a ledger entry's info popup. The
 * editor opens on top of the popup: closing it brings the popup back, saving it closes both and reloads the ledger. */
export function useAuctionEntryActions(onChanged?: () => void) {
  const { openChildModal, closeAllModals } = useModal();
  const toast = useToast();
  const saved = () => { onChanged?.(); closeAllModals(); };

  return {
    // The one editor for a concluded auction (sale, expenses, surplus settlement / write-off), opened from Auction History.
    async editConducted(auction: ConcludedAuctionRowView) {
      try {
        const loan = await getLoan(auction.loanId);
        openChildModal(<AuctionConductedEditModalContent auction={auction} loanId={loan.numericId} minDate={loan.opened?.slice(0, 10) || undefined} onSaved={saved} />, true);
      } catch { toast("Could not open this entry — try again."); }
    },
    async open(loanId: number, kind: AuctionEditKind, mode: "edit" | "delete") {
      try {
        const loan = await getLoan(loanId);
        openChildModal(<AuctionEditModalContent loanId={loan.numericId} kind={kind} mode={mode} minDate={loan.opened?.slice(0, 10) || undefined} onSaved={saved} />, true);
      } catch { toast("Could not open this entry — try again."); }
    },
  };
}
