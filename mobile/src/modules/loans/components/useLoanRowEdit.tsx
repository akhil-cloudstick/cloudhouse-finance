import React, { useState } from "react";
import { toast, type AccAction } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { getLoan } from "@/modules/loans/services/loanService";
import { LedgerPaymentEditSheet } from "@/modules/loans/components/LedgerPaymentEditSheet";
import type { Loan } from "@/modules/loans/types/loan-types";

// The repayment types the loan's recalculation can edit or delete (same list as the loan's own ledger).
const EDITABLE_TYPES = ["Interest", "Penal Interest", "Principal", "Partial", "Full Settlement", "Discount"];

type Payment = NonNullable<Loan["payments"]>[number];

/** Edit / Delete actions for a gold-loan repayment row in the main / party / bank ledgers. The row carries the
 * loan and payment ids; the loan is fetched when an action is pressed, the payment found on it, and the same
 * sheet as the loan's own Payment Ledger opens. Gated by the loan screen's ledger-entry grants. */
export function useLoanRowEdit(row: { loanId?: number; paymentId?: number; type: string }): { actions: AccAction[]; sheet: React.ReactNode } {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ loan: Loan; payment: Payment; mode: "edit" | "delete" } | null>(null);
  const eligible = !!row.loanId && !!row.paymentId && EDITABLE_TYPES.includes(row.type);
  if (!eligible) return { actions: [], sheet: null };

  async function openFor(mode: "edit" | "delete") {
    if (busy) return;
    setBusy(true);
    try {
      const loan = await getLoan(row.loanId!);
      const payment = (loan.payments ?? []).find((p) => p.id === row.paymentId);
      if (!payment) {
        toast.error("Entry not found", "This entry could not be found on its loan.");
        return;
      }
      setOpen({ loan, payment, mode });
    } catch {
      toast.error("Could not open this entry", "Could not open this entry — try again.");
    } finally {
      setBusy(false);
    }
  }

  const actions: AccAction[] = [
    ...(can("Loan_Management", "can_edit_ledger_entry") ? [{ label: "Edit", disabled: busy, onPress: () => void openFor("edit") }] : []),
    ...(can("Loan_Management", "can_delete_ledger_entry") ? [{ label: "Delete", danger: true, disabled: busy, onPress: () => void openFor("delete") }] : []),
  ];
  return {
    actions,
    sheet: open ? <LedgerPaymentEditSheet loanId={open.loan.id} loanStart={open.loan.disbursementDate} payment={open.payment} mode={open.mode} onClose={() => setOpen(null)} /> : null,
  };
}
