/* Funds check for a payout made on the desktop app (it matters while the server cannot be reached). The server refuses a payout the till or the chosen bank cannot
 * cover (backend cash.EnsurePayoutFunds: the Cash part against cash in hand, the UPI / Bank Transfer part against the bank it leaves
 * from). Offline the same rule is applied here, to the figures this PC shows, which already count every entry still waiting to be
 * sent (see cashAdjust.ts), so an entry the server is certain to refuse is blocked on the spot instead of queued and refused later.
 *
 * It blocks only when the answer is certain: with no figures kept, or a branch this PC has no exact figure for, the entry goes
 * through and the server decides. With the server reachable the figures are its own live ones, so the answer is the same one it gives. */

import { ApiError, apiFetchEnveloped } from "@/common/services/httpClient";
import { getSelectedBranchId } from "@/common/services/branchSelection";
import { offlineReady } from "./state";

export type PayoutPart = { mode?: string; amount?: number; bankId?: number | null };
type Split = { cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number | null };

const rs = (n: number) => `₹${n.toFixed(2)}`;

/* The parts of a payout written as a payment split (cash / UPI / bank transfer amounts and one bank). */
export function partsOfSplit(s: Split): PayoutPart[] {
  return [
    { mode: "Cash", amount: s.cashAmount },
    { mode: "UPI", amount: s.upiAmount, bankId: s.bankId },
    { mode: "Bank Transfer", amount: s.bankTransferAmount, bankId: s.bankId },
  ];
}

/* Throws the server's own refusal when the payout cannot be covered; returns quietly otherwise. */
export async function assertPayoutFunds(branchId: number | null | undefined, parts: PayoutPart[], checkCash = true): Promise<void> {
  if (!offlineReady()) return;
  const cash = !checkCash ? 0 : parts.filter((p) => (p.mode ?? "Cash") === "Cash").reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const perBank = new Map<number, number>();
  for (const p of parts) {
    if ((p.mode ?? "Cash") === "Cash" || !p.bankId) continue;
    perBank.set(p.bankId, (perBank.get(p.bankId) ?? 0) + (Number(p.amount) || 0));
  }

  if (cash > 0.005) {
    try {
      const picked = getSelectedBranchId();
      // exact when the branch this payout is for is the one in view; with every branch in view, a payout bigger than ALL the cash is
      // certainly refused; with another branch in view there is no exact figure, so the server decides
      if (!picked || !branchId || picked === branchId) {
        const sum = await apiFetchEnveloped<{ cashInHand?: number }>("/cash/summary");
        if (typeof sum?.cashInHand === "number" && cash > sum.cashInHand + 0.005) {
          throw new ApiError(`Insufficient balance in hand: available ${rs(sum.cashInHand)}, required ${rs(cash)}`, 409);
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) throw e;
      /* no figure kept: the server decides */
    }
  }

  if (perBank.size) {
    try {
      const data = await apiFetchEnveloped<{ id: number; balance?: number }[] | { items?: { id: number; balance?: number }[] }>("/banks");
      const rows = Array.isArray(data) ? data : data?.items ?? [];
      for (const [id, need] of perBank) {
        const bank = rows.find((b) => b.id === id);
        if (bank && typeof bank.balance === "number" && need > bank.balance + 0.005) {
          throw new ApiError(`Insufficient balance in the selected bank: available ${rs(bank.balance)}, required ${rs(need)}`, 409);
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) throw e;
    }
  }
}
