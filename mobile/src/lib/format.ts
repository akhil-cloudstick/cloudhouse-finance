// Shared money formatter for the mobile app — mirrors frontend/lib/format.ts.
// Amounts show 2 decimals so component lines agree with the totals they sum
// to; rounding each figure to whole rupees made settlement breakdowns appear
// to add up wrong (₹5,487.60 + ₹1.40 rendering as "₹5,488 + ₹1 = ₹5,490").
export const fmt = (n?: number | null) =>
  `₹${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Date only ("24/9/2026", same shape as toLocaleDateString("en-IN")) from a
// backend timestamp. Reads the YYYY-MM-DD prefix directly so a midnight-UTC
// date never shifts a day with the device timezone. "—" when empty.
export const fmtDate = (v?: string | null) => {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${+m[3]}/${+m[2]}/${m[1]}` : "—";
};
