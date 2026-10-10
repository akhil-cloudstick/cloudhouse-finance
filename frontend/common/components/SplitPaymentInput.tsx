"use client";

import { useEffect, useState } from "react";
import { Select } from "@/common/components/ui/Select";
import { fmt } from "@/common/utils/format";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { searchBanksPage, createBank } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";

export const SPLIT_PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;
export type SplitPaymentMode = (typeof SPLIT_PAYMENT_MODES)[number];

const MODE_OPTIONS = SPLIT_PAYMENT_MODES.map((m) => ({ value: m, label: m }));

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

/* bankId/bankName are only meaningful when mode is UPI/Bank Transfer/
 * Cheque — a Cash line never carries one. */
export type SplitPaymentLine = { mode: SplitPaymentMode; amount: string; bankId?: number; bankName?: string };

export const NON_CASH_MODES: readonly SplitPaymentMode[] = ["UPI", "Bank Transfer", "Cheque"];

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
    else if (l.mode === "Cheque") split.chequeAmount += amt;
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
};

/**
 * Dynamic "Add Payment" line list for recording exactly how a payment or
 * disbursement was composed across Cash / UPI / Bank Transfer / Cheque —
 * the shared control every split-payment entry point in the app builds on
 * (gold-loan and personal-loan payment collection and disbursement,
 * investment payout/deposit/withdraw, gold-loan top-up).
 *
 * Starts with a single Cash line defaulted to the full amount — zero extra
 * clicks for today's common single-mode case — and lets staff add as many
 * additional {mode, amount} lines as the payment actually needs, including
 * two lines of the same mode; they're summed together on submit. A live
 * "remaining to allocate" indicator mirrors the existing overpayment
 * hard-stop already enforced server-side (platform.ValidateSplit) so a
 * mismatched split is caught before submit, not after.
 */
export function SplitPaymentInput({
  totalAmount,
  onChange,
  scrollInternally = true,
}: SplitPaymentInputProps) {
  const [lines, setLines] = useState<SplitPaymentLine[]>([
    { mode: "Cash", amount: totalAmount > 0 ? String(totalAmount) : "" },
  ]);
  const [touched, setTouched] = useState(false);

  // Keeps the single untouched starting line following the amount field
  // above it (e.g. staff opens the modal, then types the amount) — stops
  // the moment the user actually interacts with this component.
  // A single line always follows the total, even once its mode/bank has been
  // picked — one line can only ever be the whole amount, so leaving it on a
  // stale figure just left the split unbalanced (and the parent's submit
  // disabled) for no reason. Once there are two or more lines the user's
  // own split is kept.
  useEffect(() => {
    if (lines.length !== 1) return;
    if (touched && lines[0].amount === String(totalAmount)) return;
    setLines([{ ...lines[0], amount: totalAmount > 0 ? String(totalAmount) : "" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount]);

  const split = sumSplitLines(lines);
  const remaining = Math.round((totalAmount - splitTotal(split)) * 100) / 100;
  const balanced = Math.abs(remaining) < 0.01;
  const bankId = firstSelectedBankId(lines);

  // Reports the live split/remaining/bankId to the parent on every render
  // where any changed — the parent owns submit-gating and payload assembly,
  // this component only ever reports its own current state.
  useEffect(() => {
    onChange(split, remaining, bankId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(split), remaining, bankId]);

  function updateLine(i: number, patch: Partial<SplitPaymentLine>) {
    setTouched(true);
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // Switching a line's mode to Cash clears any bank it had picked — a Cash
  // line never carries one (matches the disabled "—" bank cell it renders
  // as below).
  function updateMode(i: number, mode: SplitPaymentMode) {
    if (mode === "Cash") updateLine(i, { mode, bankId: undefined, bankName: undefined });
    else updateLine(i, { mode });
  }

  function addLine() {
    setTouched(true);
    // Prefills the new line with whatever's still unallocated — the common
    // case is one more line to finish balancing the split, so this saves
    // staff from retyping (or worse, mistyping) the remaining amount by hand.
    setLines((prev) => {
      const currentRemaining = Math.round((totalAmount - splitTotal(sumSplitLines(prev))) * 100) / 100;
      return [...prev, { mode: "Cash", amount: currentRemaining > 0 ? String(currentRemaining) : "" }];
    });
  }

  function removeLine(i: number) {
    setTouched(true);
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="split-payment">
      <label className="f">Payment breakdown</label>
      {/* Caps at ~3 visible lines and scrolls internally once a 4th is added,
       * instead of growing the modal further — same "scroll inside, not the
       * modal" treatment as EditLoanModal's ornament list. Safe to scroll
       * here (unlike `.bd` itself) because Select's own dropdown is
       * `position:fixed` (viewport-anchored, see Select.tsx), so it can't be
       * clipped by this box's overflow. Skipped when scrollInternally is
       * false (see PaymentModal), which instead relies on `.bd-scroll`. */}
      <div
        className="split-payment-lines"
        style={scrollInternally ? { maxHeight: 150, overflowY: "auto", paddingRight: 2 } : undefined}
      >
        {lines.map((l, i) => {
          const nonCash = NON_CASH_MODES.includes(l.mode);
          return (
            <div
              key={i}
              className="split-payment-line"
              style={{
                display: "grid",
                // Mode wide enough for "Bank Transfer" at any font size,
                // Amount gets more room to fit larger figures comfortably,
                // Bank is capped so it doesn't dominate the row, Close is a
                // fixed square — all four share the input's 38px height.
                gridTemplateColumns: "minmax(148px, auto) minmax(120px, 1.3fr) minmax(160px, 1fr) 38px",
                gap: 8,
                alignItems: "center",
                marginTop: i === 0 ? 6 : 8,
              }}
            >
              <Select options={MODE_OPTIONS} value={l.mode} onChange={(v) => updateMode(i, v as SplitPaymentMode)} />
              <input
                className="inp"
                type="number"
                min={0}
                step={0.01}
                placeholder="Amount"
                value={l.amount}
                onChange={(e) => updateLine(i, { amount: e.target.value })}
              />
              {nonCash ? (
                <SearchableSelect<BackendBank>
                  value={l.bankName || ""}
                  onChange={(id, item) => updateLine(i, { bankId: Number(id), bankName: item.name })}
                  fetchFn={searchBanksPage}
                  searchHint="Searches: bank name"
                  getLabel={(b) => b.name}
                  getId={(b) => String(b.id)}
                  placeholder="Search or add a bank…"
                  allowCreate
                  onCreate={createBank}
                  compact
                  compactMinWidth={160}
                />
              ) : (
                <input className="inp" value="—" disabled style={{ color: "var(--muted)" }} aria-label="Bank (not applicable for Cash)" />
              )}
              {lines.length > 1 ? (
                <button
                  type="button"
                  className="btn plain sm"
                  onClick={() => removeLine(i)}
                  aria-label="Remove this payment line"
                  style={{ width: 38, height: 38, boxSizing: "border-box", padding: 0 }}
                >
                  ✕
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="btn plain sm" style={{ marginTop: 8 }} onClick={addLine}>
        + Add Payment
      </button>
      <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: balanced ? "var(--green)" : "var(--red)" }}>
        Remaining: {fmt(remaining)}
        {/* {balanced && " · ✓ balanced"} */}
      </div>
    </div>
  );
}
