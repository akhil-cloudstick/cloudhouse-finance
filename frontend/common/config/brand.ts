/* Chittilapilly Thommana Financiers & Investments (CTFI) — single source of
 * truth for every brand string and logo path in the web app.
 *
 * Why this file exists: the previous brand name was hardcoded in ~14 places
 * (sidebar, topbar, login, five print templates, an auction venue string),
 * so a rebrand meant hunting literals across the whole tree. The backend is
 * already multi-tenant (backend/internal/tenant) and substitutes the business
 * name into SMS at send time; this is the frontend equivalent of that seam.
 * Import from here — never retype a brand string in a component.
 */

export const BRAND = {
  /** Display name for chrome: sidebar, topbar breadcrumb, page titles. */
  name: "Chittilapilly Thommana",
  /** The sidebar's stacked lockup splits the name across two lines. */
  nameTop: "CHITTILAPILLY",
  nameBottom: "Thommana",
  /** Compact form for tight spots (browser tab, collapsed sidebar, mobile). */
  shortName: "CTFI",
  /** Full legal name — print headers, copyright, legal documents. */
  legalName: "Chittilapilly Thommana Financiers & Investments",
  /** Sits under the legal name on documents and the login brand panel. */
  descriptor: "Financiers & Investments",
  /** Kerala Money Lenders registration — required on customer documents. */
  kmlReg: "32080354468",
  kmlRegLabel: "KML Reg. No: 32080354468",
  phones: ["+91 9497250240", "+91 9037374004"],
  /** Circular seal, square + transparent. Sidebar, login, favicon. */
  markSrc: "/ctfi-mark.png",
  /** Full horizontal lockup. Login brand panel and print headers. */
  wordmarkSrc: "/ctfi-wordmark.jpeg",
} as const;

/** `+91 9497250240 | +91 9037374004` — the wordmark's own separator style. */
export const BRAND_PHONES = BRAND.phones.join("  |  ");

/* Print/PDF documents open in a new window via `document.write`, where this
 * app's CSS custom properties do not exist — so those templates cannot use
 * var(--brand-700) and must emit literal hex. Rather than retyping the palette
 * into each of the nine templates (which is how the old brand gold ended up
 * duplicated as #c9971c in six files), they import these. Keep in sync with
 * the :root block in app/app/app.css. */
export const PRINT_COLORS = {
  brand: "#1a3e93",
  brandDeep: "#0e2050",
  accent: "#c9a227",
  ink: "#16233d",
  muted: "#64748b",
  line: "#e1e7f2",
  tint: "#f2f6fd",
} as const;
