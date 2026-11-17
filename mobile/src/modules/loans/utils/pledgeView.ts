import type { BankPledgeRecord, Loan } from "@/modules/loans/types/loan-types";

/** Grams to 3 decimals, like web's fmtW. */
export const fmtW = (v?: number | null) => (v ? `${(+v).toFixed(3)} g` : "—");

/** Ornament names a pledge covers (the backend fills ornament_names; falls back to the loan's own ornaments by id). */
export function pledgeOrnamentNames(p: BankPledgeRecord, loan?: Pick<Loan, "ornaments"> | null): string[] {
  const named = p.ornamentNames ?? p.ornament_names;
  if (named?.length) return named;
  if (!p.ornamentIds?.length) return [];
  return (loan?.ornaments ?? []).filter((o) => p.ornamentIds!.includes(o.id)).map((o) => o.name);
}

/** "All ornaments" for a whole-loan pledge, else the names joined. */
export const pledgeOrnaments = (p: BankPledgeRecord, loan?: Pick<Loan, "ornaments"> | null) => pledgeOrnamentNames(p, loan).join(", ") || "All ornaments";

/** Past its due date and still with the bank (web PledgeDetailsGrid). */
export function pledgeOverdue(p: BankPledgeRecord): boolean {
  if (!p.bankPledgeDueDate || p.status === "Voided" || p.status === "Released") return false;
  return p.bankPledgeDueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}
