import { inr } from "@/common/utils/format";
import { C } from "@/common/components/ui/base";

// A bank balance can be overdrawn: sign before the ₹ ("−₹1,200"), red; zero or more is green (web bankBalance.ts).
export const fmtBalance = (n: number) => (n < 0 ? `−${inr(-n)}` : inr(n));
export const balanceColor = (n: number) => (n < 0 ? C.red : C.green);
