
import type { SplitAmounts } from "@/modules/investments/types/investment-types";

// The backend requires cash + UPI + bank + cheque to add up to the amount
// (platform.ValidateSplit), so every payment/disbursement carries this split.

export const ZERO_SPLIT: SplitAmounts = { cashAmount: 0, upiAmount: 0, bankTransferAmount: 0, chequeAmount: 0 };

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const splitTotal = (s: SplitAmounts) => round2(s.cashAmount + s.upiAmount + s.bankTransferAmount + s.chequeAmount);
export const isBalanced = (s: SplitAmounts, total: number) => Math.abs(splitTotal(s) - round2(total)) < 0.01;
