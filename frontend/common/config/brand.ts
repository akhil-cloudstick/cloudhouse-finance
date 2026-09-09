/* CloudHouse Gold Finance — single source of truth for every brand string and
 * logo path in the web app.
 *
 * Why this file exists: the brand name used to be hardcoded in ~14 places
 * (sidebar, topbar, login, five print templates, an auction venue string),
 * so a rebrand meant hunting literals across the whole tree. The backend is
 * already multi-tenant (backend/internal/tenant) and substitutes the business
 * name into SMS at send time; this is the frontend equivalent of that seam.
 * Import from here — never retype a brand string in a component.
 */

export const BRAND = {
  /** Display name for chrome: sidebar, topbar breadcrumb, page titles. */
  name: "CloudHouse Gold Finance",
  /** The sidebar's stacked lockup splits the name across two lines. */
  nameTop: "CLOUDHOUSE",
  nameBottom: "Gold Finance",
  /** Compact form for tight spots (browser tab, collapsed sidebar, mobile). */
  shortName: "CloudHouse",
  /** Full legal name — print headers, copyright, legal documents. */
  legalName: "CloudHouse Gold Finance",
  /** Sits under the legal name on documents and the login brand panel. */
  descriptor: "Gold Loans & Finance",
  /* Kerala Money Lenders registration — required on customer documents.
   * DEMO VALUES: replace both with CloudHouse's real registration before
   * anything printed here is handed to a customer. */
  kmlReg: "KL/CHGF/2026/00184",
  kmlRegLabel: "KML Reg. No: KL/CHGF/2026/00184",
  phones: ["+91 9000012345", "+91 9000067890"],
  /** Square + transparent. Sidebar, login, favicon. */
  markSrc: "/cloudhouse-mark.png",
  /** Full vertical lockup. Login brand panel and print headers. */
  wordmarkSrc: "/cloudhouse-wordmark.svg",
} as const;

/** `+91 9000012345 | +91 9000067890` — the wordmark's own separator style. */
export const BRAND_PHONES = BRAND.phones.join("  |  ");

/* Print/PDF documents open in a new window via `document.write`, where this
 * app's CSS custom properties do not exist — so those templates cannot use
 * var(--brand-700) and must emit literal hex. Rather than retyping the palette
 * into each of the nine templates (which is how the old brand colour ended up
 * duplicated in six files), they import these. Keep in sync with the :root
 * block in app/app/app.css. */
export const PRINT_COLORS = {
  brand: "#c0177a",
  brandDeep: "#8a0f5c",
  accent: "#ef7f28",
  ink: "#16233d",
  muted: "#64748b",
  line: "#e9e4f2",
  tint: "#fdf4f9",
} as const;

/* The logo's own violet → magenta → orange sweep. Used sparingly for brand
 * moments (login panel, sidebar rail, the topbar hairline) — never behind
 * body text, where a moving background destroys contrast. */
export const BRAND_GRADIENT =
  "linear-gradient(135deg, #6855bc 0%, #d91786 52%, #f49e35 100%)";
