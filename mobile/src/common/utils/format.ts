// Shared money formatter for the mobile app — mirrors frontend/common/utils/format.ts.
// Amounts show 2 decimals so component lines agree with the totals they sum
// to; rounding each figure to whole rupees made settlement breakdowns appear
// to add up wrong (₹5,487.60 + ₹1.40 rendering as "₹5,488 + ₹1 = ₹5,490").
export const fmt = (n?: number | null) =>
  `₹${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Date only ("24-09-2026", DD-MM-YYYY like dmy) from a
// backend timestamp. Reads the YYYY-MM-DD prefix directly so a midnight-UTC
// date never shifts a day with the device timezone. "—" when empty.
export const fmtDate = (v?: string | null) => {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};

// Prototype money style: "₹18,42,600" — whole rupees without decimals, but a
// fractional amount keeps its 2 decimals so settlement lines still add up.
export const inr = (n?: number | null) => {
  const v = n ?? 0;
  const frac = Math.abs(v % 1) > 0.004;
  return `${v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: frac ? 2 : 0 })}`;
};

// Compact form for summary stats: ₹1.4L / ₹2.3Cr / ₹8,400.
export const inrShort = (n?: number | null) => {
  const v = Math.abs(n ?? 0);
  const sign = (n ?? 0) < 0 ? "−" : "";
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  return `${sign}₹${Math.round(v).toLocaleString("en-IN")}`;
};

// App-wide date style: "14-08-2026" (DD-MM-YYYY). Reads the YYYY-MM-DD prefix
// directly (no timezone shift). "—" when empty.
export const dmy = (v?: string | null) => {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const addDaysISO = (iso: string, days: number) => {
  const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
