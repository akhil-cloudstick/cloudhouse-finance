/* Chittilapilly Thommana Financiers & Investments (CTFI) — single source of
 * truth for every brand string and logo asset in this app.
 *
 * Mirrors frontend/common/config/brand.ts. The two are separate files because
 * the apps do not share a package, but they must stay in step: the printed
 * pledge slip and statement are generated on both web and mobile and are
 * expected to come out identical.
 */

export const BRAND = {
  /** Display name for chrome and drawer footers. */
  name: "Chittilapilly Thommana",
  /** Compact form for tight spots — tab titles, headers, splash. */
  shortName: "CTFI",
  /** Full legal name — print headers, copyright, payment sheets. */
  legalName: "Chittilapilly Thommana Financiers & Investments",
  descriptor: "Financiers & Investments",
  /** Kerala Money Lenders registration — required on customer documents. */
  kmlReg: "32080354468",
  kmlRegLabel: "KML Reg. No: 32080354468",
  phones: ["+91 9497250240", "+91 9037374004"],
} as const;

/** `+91 9497250240 | +91 9037374004` — the wordmark's own separator style. */
export const BRAND_PHONES = BRAND.phones.join("  |  ");

/* Printed documents are rendered as standalone HTML by expo-print, where the
 * app's theme object does not exist — so those templates need literal hex.
 * Keep in sync with src/theme/colors.ts and with the web app's PRINT_COLORS. */
export const PRINT_COLORS = {
  brand: "#1a3e93",
  brandDeep: "#0e2050",
  accent: "#c9a227",
  ink: "#16233d",
  muted: "#64748b",
  line: "#e1e7f2",
  tint: "#f2f6fd",
} as const;
