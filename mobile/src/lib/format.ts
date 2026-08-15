// Shared money formatter for the mobile app — mirrors frontend/lib/format.ts.
// Amounts show 2 decimals so component lines agree with the totals they sum
// to; rounding each figure to whole rupees made settlement breakdowns appear
// to add up wrong (₹5,487.60 + ₹1.40 rendering as "₹5,488 + ₹1 = ₹5,490").
export const fmt = (n?: number | null) =>
  `₹${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
