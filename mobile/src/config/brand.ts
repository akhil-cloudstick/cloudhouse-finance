/* CloudHouse Finance — single source of truth for every brand string and
 * logo asset in this app.
 *
 * Mirrors frontend/common/config/brand.ts. The two are separate files because
 * the apps do not share a package, but they must stay in step: the printed
 * pledge slip and statement are generated on both web and mobile and are
 * expected to come out identical.
 */

export const BRAND = {
  /** Display name for chrome and drawer footers. */
  name: "CloudHouse Finance",
  /** Compact form for tight spots — tab titles, headers, splash. */
  shortName: "CloudHouse",
  /** Full legal name — print headers, copyright, payment sheets. */
  legalName: "CloudHouse Finance",
  descriptor: "Gold Loans & Finance",
  /* Kerala Money Lenders registration — required on customer documents.
   * DEMO VALUES: replace both with CloudHouse's real registration before
   * anything printed here is handed to a customer. */
  kmlReg: "KL/CHGF/2026/00184",
  kmlRegLabel: "KML Reg. No: KL/CHGF/2026/00184",
  phones: ["+91 9000012345", "+91 9000067890"],
} as const;

/** `+91 9000012345 | +91 9000067890` — the wordmark's own separator style. */
export const BRAND_PHONES = BRAND.phones.join("  |  ");

/* Printed documents are rendered as standalone HTML by expo-print, where the
 * app's theme object does not exist — so those templates need literal hex.
 * Keep in sync with src/theme/colors.ts and with the web app's PRINT_COLORS. */
export const PRINT_COLORS = {
  brand: "#c0177a",
  brandDeep: "#8a0f5c",
  accent: "#ef7f28",
  ink: "#16233d",
  muted: "#64748b",
  line: "#e9e4f2",
  tint: "#fdf4f9",
} as const;
