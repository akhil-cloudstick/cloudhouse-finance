import { useEffect, useState } from "react";
import { PaymentBreakdownFields, isBankMode, newPaymentRow, type PaymentRow } from "@/modules/cash/components/PaymentBreakdownFields";
import type { SplitAmounts } from "@/modules/investments/types/investment-types";
import { ZERO_SPLIT, round2, splitTotal } from "@/common/utils/paymentSplit";

// Ready means the split adds up and every UPI / Bank Transfer line has its bank.
export type SplitPayment = { split: SplitAmounts; bankId?: number; remaining: number; ready: boolean };

type SplitPaymentInputProps = {
  total: number;
  onChange: (value: SplitPayment) => void;
  bankLabel?: string;
};

// One payment event stores exactly one bank, so the first bank picked across non-cash lines is the one sent.
export function SplitPaymentInput({ total, onChange, bankLabel = "Bank (your account)" }: SplitPaymentInputProps) {
  const [rows, setRows] = useState<PaymentRow[]>(() => [newPaymentRow()]);

  const split: SplitAmounts = { ...ZERO_SPLIT };
  let bankId: number | undefined;
  let bankMissing = false;
  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    if (amount <= 0) continue;
    if (r.mode === "Cash") split.cashAmount += amount;
    else if (r.mode === "UPI") split.upiAmount += amount;
    else if (r.mode === "Bank Transfer") split.bankTransferAmount += amount;
    if (isBankMode(r.mode)) {
      if (!r.bank) bankMissing = true;
      else if (bankId === undefined) bankId = r.bank.id;
    }
  }
  split.cashAmount = round2(split.cashAmount);
  split.upiAmount = round2(split.upiAmount);
  split.bankTransferAmount = round2(split.bankTransferAmount);
  const remaining = round2(total - splitTotal(split));
  const ready = Math.abs(remaining) < 0.01 && !bankMissing;

  // Reports the live figures to the parent whenever any of them changes.
  useEffect(() => {
    onChange({ split, bankId, remaining, ready });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(split), bankId, remaining, ready]);

  return <PaymentBreakdownFields total={total} rows={rows} onChange={setRows} bankLabel={bankLabel} />;
}
