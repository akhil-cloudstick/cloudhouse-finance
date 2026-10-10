import { fmt } from "@/common/utils/format";

// A bank balance can be overdrawn — sign before the ₹ ("−₹1,200.00"), not
// fmt's "₹-1,200.00", and red.
export const fmtBalance = (n: number) => (n < 0 ? "−" + fmt(-n) : fmt(n));
// Zero or more is green, like the other ledgers' credits.
export const balanceColor = (n: number) => (n < 0 ? "var(--red)" : "var(--green)");
