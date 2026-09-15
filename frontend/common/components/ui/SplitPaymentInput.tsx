"use client";

import { useEffect, useState } from "react";
import { Select } from "@/common/components/ui/Select";
import { fmt } from "@/common/utils/format";

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

export type SplitPaymentLine = { mode: SplitPaymentMode; amount: string };

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
}: {
  /** The amount this split must sum to — drives the live "remaining to
   * allocate" indicator. The single starting line tracks this value live
   * until the user actually edits something. */
  totalAmount: number;
  /** Fires whenever the lines (or totalAmount) change, with the summed
   * split and how much of totalAmount is still unallocated (0 = balanced,
   * matching platform.ValidateSplit's tolerance). */
  onChange: (split: SplitAmounts, remaining: number) => void;
}) {
  const [lines, setLines] = useState<SplitPaymentLine[]>([
    { mode: "Cash", amount: totalAmount > 0 ? String(totalAmount) : "" },
  ]);
  const [touched, setTouched] = useState(false);

  // Keeps the single untouched starting line following the amount field
  // above it (e.g. staff opens the modal, then types the amount) — stops
  // the moment the user actually interacts with this component.
  useEffect(() => {
    if (touched || lines.length !== 1) return;
    setLines([{ mode: lines[0].mode, amount: totalAmount > 0 ? String(totalAmount) : "" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount]);

  const split = sumSplitLines(lines);
  const remaining = Math.round((totalAmount - splitTotal(split)) * 100) / 100;
  const balanced = Math.abs(remaining) < 0.01;

  // Reports the live split/remaining to the parent on every render where
  // either changed — the parent owns submit-gating and payload assembly,
  // this component only ever reports its own current state.
  useEffect(() => {
    onChange(split, remaining);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(split), remaining]);

  function updateLine(i: number, patch: Partial<SplitPaymentLine>) {
    setTouched(true);
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setTouched(true);
    setLines((prev) => [...prev, { mode: "Cash", amount: "" }]);
  }

  function removeLine(i: number) {
    setTouched(true);
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="split-payment">
      <label className="f">Payment breakdown</label>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: i === 0 ? 6 : 8 }}>
          <div style={{ width: 150, flexShrink: 0 }}>
            <Select options={MODE_OPTIONS} value={l.mode} onChange={(v) => updateLine(i, { mode: v as SplitPaymentMode })} />
          </div>
          <input
            className="inp"
            type="number"
            min={0}
            step={0.01}
            placeholder="Amount"
            value={l.amount}
            onChange={(e) => updateLine(i, { amount: e.target.value })}
            style={{ flex: 1 }}
          />
          {lines.length > 1 && (
            <button
              type="button"
              className="btn plain sm"
              onClick={() => removeLine(i)}
              aria-label="Remove this payment line"
              style={{ flexShrink: 0 }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn plain sm" style={{ marginTop: 8 }} onClick={addLine}>
        + Add Payment
      </button>
      <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: balanced ? "var(--green)" : "var(--red)" }}>
        Remaining to allocate: {fmt(remaining)}
        {balanced && " · ✓ balanced"}
      </div>
    </div>
  );
}
