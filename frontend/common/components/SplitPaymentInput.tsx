"use client";

import { useEffect, useState } from "react";
import { PaymentBreakdownFields, newPaymentRow, type PaymentRow } from "@/modules/cash/components/PaymentBreakdownFields";

// Cheque is not a payment mode in the application: Cash, UPI and Bank Transfer only.
export const SPLIT_PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer"] as const;
export type SplitPaymentMode = (typeof SPLIT_PAYMENT_MODES)[number];


/* Mirrors backend's four fixed split columns (e.g.
 * backend/internal/loan/model_payment.go's LoanPayment) — every
 * split-payment endpoint in the app accepts exactly this shape alongside
 * its own `amount`. */
export type SplitAmounts = {
  cashAmount: number;
  upiAmount: number;
  bankTransferAmount: number;
  chequeAmount: number;
};

/* bankId/bankName are only meaningful when mode is UPI/Bank Transfer —
 * a Cash line never carries one. */
export type SplitPaymentLine = { mode: SplitPaymentMode; amount: string; bankId?: number; bankName?: string };

export const NON_CASH_MODES: readonly SplitPaymentMode[] = ["UPI", "Bank Transfer"];

/* One payment event stores exactly one BankID today (see
 * backend/internal/loan/model_payment.go's LoanPayment.BankID doc comment)
 * even though the split can span multiple non-cash lines — this picks the
 * first bank selected across those lines as "the" bank for the payment,
 * matching what the backend can actually persist. Undefined when no
 * non-cash line has a bank selected yet. */
export function firstSelectedBankId(lines: SplitPaymentLine[]): number | undefined {
  for (const l of lines) {
    if (NON_CASH_MODES.includes(l.mode) && l.bankId) return l.bankId;
  }
  return undefined;
}

export const ZERO_SPLIT: SplitAmounts = { cashAmount: 0, upiAmount: 0, bankTransferAmount: 0, chequeAmount: 0 };

/* Sums any number of {mode, amount} lines — including several lines of the
 * same mode (e.g. two separate cash handovers) — into the backend's four
 * fixed columns. Exported so callers can derive the request payload from
 * whatever line state SplitPaymentInput last reported via onChange. */
export function sumSplitLines(lines: SplitPaymentLine[]): SplitAmounts {
  const split = { ...ZERO_SPLIT };
  for (const l of lines) {
    const amt = +l.amount || 0;
    if (amt <= 0) continue;
    if (l.mode === "Cash") split.cashAmount += amt;
    else if (l.mode === "UPI") split.upiAmount += amt;
    else if (l.mode === "Bank Transfer") split.bankTransferAmount += amt;
  }
  return {
    cashAmount: Math.round(split.cashAmount * 100) / 100,
    upiAmount: Math.round(split.upiAmount * 100) / 100,
    bankTransferAmount: Math.round(split.bankTransferAmount * 100) / 100,
    chequeAmount: Math.round(split.chequeAmount * 100) / 100,
  };
}

function splitTotal(s: SplitAmounts): number {
  return Math.round((s.cashAmount + s.upiAmount + s.bankTransferAmount + s.chequeAmount) * 100) / 100;
}

type SplitPaymentInputProps = {
  /** The amount this split must sum to — drives the live "remaining to
   * allocate" indicator. The single starting line tracks this value live
   * until the user actually edits something. */
  totalAmount: number;
  /** Fires whenever the lines (or totalAmount) change, with the summed
   * split, how much of totalAmount is still unallocated (0 = balanced,
   * matching platform.ValidateSplit's tolerance), and the bank id to submit
   * alongside the payment (see firstSelectedBankId's doc comment — nil when
   * no non-cash line has picked one yet). */
  onChange: (split: SplitAmounts, remaining: number, bankId: number | undefined) => void;
  /** Caps the lines list at ~3 visible rows and scrolls internally past
   * that, instead of growing with the list — the default, used by every
   * modal except PaymentModal, which sets this false so the breakdown
   * never gets cropped and only the modal's own `.bd-scroll` body scrolls. */
  scrollInternally?: boolean;
  /** Heading above the lines; null drops it (PaymentModal's section title already names it). */
  label?: string | null;
};

/**
 * Payment breakdown for recording exactly how a payment or disbursement was
 * composed across Cash / UPI / Bank Transfer — the shared control every
 * split-payment entry point in the app builds on (gold-loan and personal-loan
 * payment collection and disbursement, investment payout/deposit/withdraw,
 * gold-loan top-up).
 *
 * Renders the cash module's PaymentBreakdownFields (the Credit / Debit
 * ledger forms' breakdown) so every breakdown in the app looks and behaves
 * the same: an icon button adds a line, a lone line follows the total, and a
 * live "still to allocate" line mirrors the server-side overpayment
 * hard-stop (platform.ValidateSplit). This wrapper only maps those rows to
 * the backend's four fixed split columns and reports them via onChange.
 */
export function SplitPaymentInput({
  totalAmount,
  onChange,
  scrollInternally = true,
  label,
}: SplitPaymentInputProps) {
  const [rows, setRows] = useState<PaymentRow[]>(() => [
    newPaymentRow({ mode: "Cash", amount: totalAmount > 0 ? String(totalAmount) : "" }),
  ]);

  const lines: SplitPaymentLine[] = rows.map((r) => ({
    mode: r.mode as SplitPaymentMode,
    amount: r.amount,
    bankId: r.bankId ? +r.bankId : undefined,
    bankName: r.bankName,
  }));
  const split = sumSplitLines(lines);
  const remaining = Math.round((totalAmount - splitTotal(split)) * 100) / 100;
  const bankId = firstSelectedBankId(lines);

  // Reports the live split/remaining/bankId to the parent on every render
  // where any changed — the parent owns submit-gating and payload assembly,
  // this component only ever reports its own current state.
  useEffect(() => {
    onChange(split, remaining, bankId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(split), remaining, bankId]);

  return (
    <div className="split-payment" style={{ width: "100%" }}>
      <PaymentBreakdownFields total={totalAmount} rows={rows} onChange={setRows} scrollInternally={scrollInternally} label={label} />
    </div>
  );
}

/* The one mode a split uses, or null when it spans several (or is empty). For screens whose backend
 * records a single payment mode and bank per event (auction proceeds and surplus refund). */
export function singleSplitMode(s: SplitAmounts): SplitPaymentMode | null {
  const used: SplitPaymentMode[] = [];
  if (s.cashAmount > 0) used.push("Cash");
  if (s.upiAmount > 0) used.push("UPI");
  if (s.bankTransferAmount > 0) used.push("Bank Transfer");
  return used.length === 1 ? used[0] : null;
}
