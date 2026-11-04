"use client";

import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { getLoan, listTopUps, linkedDiscountOf } from "@/modules/loans/services/loanService";
import { LedgerPaymentEditModalContent } from "@/modules/loans/components/LedgerPaymentEditModalContent";
import { SanctionEditModalContent } from "@/modules/loans/components/SanctionEditModalContent";
import { TopUpEditModalContent } from "@/modules/loans/components/TopUpEditModalContent";
import { getPersonalLoan, listPersonalLoanPaymentsPage } from "@/modules/personal-loans/services/personalLoanService";
import { PersonalLedgerEditModalContent } from "@/modules/personal-loans/components/PersonalLedgerEditModalContent";
import { getInvestment, getInvestmentLedger } from "@/modules/investments/services/investmentService";
import { InvestmentLedgerEditModalContent } from "@/modules/investments/components/InvestmentLedgerEditModalContent";

/* Opens the gold-loan editors (a repayment, the sanction, a top-up) from a ledger entry's info popup. Each editor
 * opens on top of the popup: closing it brings the popup back, and saving it closes both and reloads the ledger. */
export function useLoanEntryActions(onChanged?: () => void) {
  const { openChildModal, closeAllModals } = useModal();
  const toast = useToast();
  const saved = () => { onChanged?.(); closeAllModals(); };
  const failed = () => toast("Could not open this entry — try again.");

  return {
    async payment(loanId: number, paymentId: number, mode: "edit" | "delete") {
      try {
        const loan = await getLoan(loanId);
        const payment = loan.payments.find((p) => p.id === paymentId);
        if (!payment) { toast("This entry could not be found on its loan."); return; }
        openChildModal(<LedgerPaymentEditModalContent loanId={loan.numericId} payment={payment} linkedDiscount={linkedDiscountOf(loan.payments, payment)} mode={mode} minDate={loan.opened?.slice(0, 10) || undefined} onSaved={saved} />, true);
      } catch { failed(); }
    },
    async sanction(loanId: number) {
      try {
        const loan = await getLoan(loanId);
        if (!loan.disbursementDate) { toast("This loan has not been disbursed yet."); return; }
        const payment = [...loan.payments].reverse().find((p) => p.type === "Disbursement") ?? null;
        openChildModal(<SanctionEditModalContent loanId={loan.numericId} sanctionedAmount={loan.sanctionedAmount} serviceChargeAmount={loan.serviceChargeAmount} disbursementDate={loan.disbursementDate} dueDate={loan.due} payment={payment} onSaved={saved} />, true);
      } catch { failed(); }
    },
    async personalPayment(loanId: number, paymentId: number, mode: "edit" | "delete") {
      try {
        const [loan, page] = await Promise.all([getPersonalLoan(loanId), listPersonalLoanPaymentsPage(loanId, 0, 10000)]);
        const rows = page.items.filter((r) => r.kind === "payment" && r.id === paymentId);
        if (rows.length === 0) { toast("This payment could not be found on its personal loan."); return; }
        // a split payment shows one ledger row per mode: the editor takes the whole payment
        const entry = { ...rows[0], amount: rows.reduce((s, x) => s + x.amount, 0) };
        const bankId = rows.find((x) => x.bankId)?.bankId ?? null;
        const minDate = (loan.disbursedAt || loan.openedDate || "").slice(0, 10) || undefined;
        openChildModal(<PersonalLedgerEditModalContent loanId={loan.id} entry={entry} bankId={bankId} mode={mode} minDate={mode === "edit" ? minDate : undefined} onSaved={saved} />, true);
      } catch { failed(); }
    },
    async personalDisbursement(loanId: number) {
      try {
        const [loan, page] = await Promise.all([getPersonalLoan(loanId), listPersonalLoanPaymentsPage(loanId, 0, 10000)]);
        const entry = page.items.find((r) => r.kind === "disbursement");
        if (!entry) { toast("This loan's disbursement could not be found."); return; }
        const minDate = (loan.disbursedAt || loan.openedDate || "").slice(0, 10) || undefined;
        openChildModal(<PersonalLedgerEditModalContent loanId={loan.id} entry={entry} bankId={entry.bankId ?? null} mode="edit" minDate={minDate} onSaved={saved} />, true);
      } catch { failed(); }
    },
    async investment(investmentId: number, entryId: string, mode: "edit" | "delete") {
      try {
        const [inv, ledger] = await Promise.all([getInvestment(investmentId), getInvestmentLedger(investmentId)]);
        const row = ledger.find((r) => r.id === entryId) ?? ledger.find((r) => r.id.startsWith(`${entryId}-`));
        if (!row) { toast("This entry could not be found on its investment."); return; }
        if (mode === "edit" ? !row.editable : !row.deletable) { toast(`This entry cannot be ${mode === "edit" ? "edited" : "deleted"} in the investment's current state.`); return; }
        openChildModal(<InvestmentLedgerEditModalContent investmentId={inv.id} row={row} mode={mode} live={inv.engine === "Live"} minDate={mode === "edit" ? inv.startDate?.slice(0, 10) || undefined : undefined} onSaved={saved} />, true);
      } catch { failed(); }
    },
    async topUp(loanId: number, topUpId: number, mode: "edit" | "delete") {
      try {
        const [loan, topUps] = await Promise.all([getLoan(loanId), listTopUps(loanId)]);
        const topUp = topUps.find((t) => t.id === topUpId);
        if (!topUp) { toast("This top-up could not be found on its loan."); return; }
        openChildModal(<TopUpEditModalContent loanId={loan.numericId} topUp={topUp} mode={mode} minDate={loan.opened?.slice(0, 10) || undefined} onSaved={saved} />, true);
      } catch { failed(); }
    },
  };
}

// The repayment types the loan's recalculation can edit or delete.
export const LEDGER_EDITABLE_TYPES = ["Interest", "Penal Interest", "Principal", "Partial", "Full Settlement", "Discount"];
