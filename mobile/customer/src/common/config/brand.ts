// Keep in step with frontend/common/config/brand.ts: pledge slip/statement are generated on both and must match.
export const BRAND = {
  /** Display name for chrome and drawer footers. */
  name: "CloudHouse Finance",
  /** Compact form for tight spots — tab titles, headers, splash. */
  shortName: "CloudHouse",
  /** Full legal name — print headers, copyright, payment sheets. */
  legalName: "CloudHouse Finance",
  descriptor: "Gold Loans & Finance",
  // DEMO VALUES: replace both with CloudHouse's real KML registration before printing to a customer.
  kmlReg: "KL/CHGF/2026/00184",
  kmlRegLabel: "KML Reg. No: KL/CHGF/2026/00184",
  phones: ["+91 9000012345", "+91 9000067890"],
} as const;

/** `+91 9000012345 | +91 9000067890` — the wordmark's own separator style. */
export const BRAND_PHONES = BRAND.phones.join("  |  ");

// Printed HTML templates can't reach the theme object, so these need literal hex; keep in sync with colors.ts.
export const PRINT_COLORS = {
  brand: "#c0177a",
  brandDeep: "#8a0f5c",
  accent: "#ef7f28",
  ink: "#16233d",
  muted: "#64748b",
  line: "#e9e4f2",
  tint: "#fdf4f9",
} as const;
