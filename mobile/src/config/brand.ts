import { deriveBrandRampHex, DEFAULT_BRAND_COLOR } from "../theme/brandRamp";

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
 * This is the static platform default; templates must call printColors()
 * below instead, or a business with its own colour gets CloudHouse's
 * printouts. Keep in sync with src/theme/colors.ts and the web PRINT_COLORS. */
export const PRINT_COLORS = {
  ...(() => {
    const ramp = deriveBrandRampHex(DEFAULT_BRAND_COLOR);
    return { brand: ramp.brand, brandDeep: ramp.brandDeep, tint: ramp.brandFaint };
  })(),
  accent: "#ef7f28",
  ink: "#16233d",
  muted: "#64748b",
  line: "#e9e4f2",
};

export type PrintColors = typeof PRINT_COLORS;

/* --- Per-business identity for print templates -----------------------------
 *
 * Mirrors printBrand()/printColors() in frontend/common/config/brand.ts. A
 * printed pledge slip must carry the business's own legal name and
 * money-lending registration, not CloudHouse's — printing the vendor's
 * registration on a borrower's paperwork would be wrong legally, not just
 * cosmetically.
 *
 * Held in module state rather than React context because the templates are
 * plain string builders, not components. Written by ThemeProvider on every
 * branding load (see setPrintProfile there).
 */
export type PrintProfile = {
  name: string;
  legalName: string;
  kmlRegNo: string;
  addressLine: string;
  brandColor: string;
};

let printProfile: PrintProfile | null = null;

export function setPrintProfile(profile: PrintProfile | null): void {
  printProfile = profile;
}

export type PrintBrand = {
  name: string;
  legalName: string;
  kmlRegNo: string;
  kmlRegLabel: string;
  addressLine: string;
  /* CloudHouse's own numbers, only while no business profile is loaded —
   * the backend holds no phone for a business, and printing the vendor's
   * numbers on another business's slip would send its borrowers to us. */
  phones: string;
};

/* Falls back FIELD BY FIELD rather than all-or-nothing: a business that has a
 * legal name but no registration number on file should print its own name,
 * not revert wholesale to CloudHouse's. */
export function printBrand(): PrintBrand {
  const p = printProfile;
  return {
    name: p?.name || p?.legalName || BRAND.name,
    legalName: p?.legalName || p?.name || BRAND.legalName,
    kmlRegNo: p?.kmlRegNo || BRAND.kmlReg,
    kmlRegLabel: p?.kmlRegNo ? `KML Reg. No: ${p.kmlRegNo}` : BRAND.kmlRegLabel,
    addressLine: p?.addressLine || "",
    phones: p ? "" : BRAND_PHONES,
  };
}

export function printColors(): PrintColors {
  if (!printProfile?.brandColor) return PRINT_COLORS;
  const ramp = deriveBrandRampHex(printProfile.brandColor);
  return { ...PRINT_COLORS, brand: ramp.brand, brandDeep: ramp.brandDeep, tint: ramp.brandFaint };
}

/** The CloudHouse mark, bundled with the app — used on the login screen and
 * in every page header regardless of any tenant logo uploaded on the web. */
export const APP_LOGO = require("../../assets/cloudhouse.png");
/** The same mark cut out on a transparent background (no white square),
 * for the page headers where it sits straight on the hero gradient. */
export const HEADER_LOGO = require("../../assets/header-logo.png");
