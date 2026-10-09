import { brandRampHex, readCachedBrandColor } from "@/product/config/theme";
import { activeBusinessSlug } from "@/product/services/tenantSession";

/* CloudHouse Finance — single source of truth for every brand string and
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
  name: "CloudHouse Finance",
  /** The sidebar's stacked lockup splits the name across two lines. */
  nameTop: "CLOUDHOUSE",
  nameBottom: "Finance",
  /** Compact form for tight spots (browser tab, collapsed sidebar, mobile). */
  shortName: "CloudHouse",
  /** Full legal name — print headers, copyright, legal documents. */
  legalName: "CloudHouse Finance",
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
  brand: "#6054bf", // oklch(0.515 0.162 284)
  brandDeep: "#423591", // oklch(0.40  0.145 284)
  accent: "#f99603", // oklch(0.76  0.17   65)
  ink: "#11101a", // oklch(0.18  0.02  285)
  muted: "#62626f", // oklch(0.50  0.02  285)
  line: "#e3e2e7", // oklch(0.915 0.006 290)
  tint: "#f9f9ff", // oklch(0.983 0.008 284)
} as const;

/* The logo's own violet → magenta → orange sweep. Used sparingly for brand
 * moments (login panel, sidebar rail, the topbar hairline) — never behind
 * body text, where a moving background destroys contrast. */
export const BRAND_GRADIENT =
  "linear-gradient(135deg, #6644de 0%, #c61f8f 52%, #f99603 100%)";

/* VENDOR is us — the company that sells and operates this software — as
 * distinct from BRAND above, which is the product a BUSINESS's own staff and
 * customers see. They are deliberately separate strings: the superadmin
 * console is our internal tool and should say so, while the tenant app is
 * branded for whichever business is signed in (see common/BrandingProvider).
 * Overloading BRAND for both is how a customer ends up looking at our
 * vendor name on their own paperwork. */
export const VENDOR = {
  name: "CloudHouse Technologies",
  shortName: "CloudHouse",
  product: "Superadmin Console",
  markSrc: "/cloudhouse-mark.png",
} as const;

/* printColors returns the brand ramp for the CURRENT business, in hex.
 *
 * Print and PDF templates open in a new window via document.write, where this
 * app's CSS custom properties do not exist — so those templates cannot use
 * var(--brand) and need literal values. PRINT_COLORS above is the static
 * platform default; this is its per-business equivalent, and every template
 * should call it rather than reading the constant, or a business with its own
 * colour gets its own screen and CloudHouse's printouts.
 *
 * Reads the colour cached by BrandingProvider rather than the live context,
 * so plain (non-React) template builders in common/utils and module util files
 * can call it without being rewritten into hooks. */
/** Same shape as PRINT_COLORS, but widened — these values are computed. */
export type PrintColors = { [K in keyof typeof PRINT_COLORS]: string };

export function printColors(): PrintColors {
  const cached = readCachedBrandColor(activeBusinessSlug());
  if (!cached) return PRINT_COLORS;
  const ramp = brandRampHex(cached);
  return {
    ...PRINT_COLORS,
    brand: ramp["--brand"] ?? PRINT_COLORS.brand,
    brandDeep: ramp["--brand-deep"] ?? PRINT_COLORS.brandDeep,
    tint: ramp["--brand-faint"] ?? PRINT_COLORS.tint,
  };
}

/* --- Per-business identity for print templates -----------------------------
 *
 * The same problem printColors() solves, for STRINGS. A printed pledge slip
 * or statement must carry the business's own legal name and money-lending
 * registration number, not CloudHouse's — printing the vendor's registration
 * on a borrower's paperwork would be wrong in a way that matters legally,
 * not just cosmetically.
 *
 * Cached rather than read from React context for the same reason as the
 * colour: the templates are plain string builders, not components. Written by
 * BrandingProvider on every successful load.
 */

const BRAND_PROFILE_KEY_PREFIX = "cloudhouse_brand_profile::";

export type PrintBrand = {
  /** Raw registration number, for templates that render their own label. */
  kmlRegNo: string;
  legalName: string;
  kmlRegLabel: string;
  addressLine: string;
};

/* readCachedBrandIdentity replays the last-known IDENTITY (not just the print
 * fields) for a business, so a cold load can render that business's own name
 * and logo on the very first frame instead of a placeholder.
 *
 * The rule it serves: no business ever sees a brand that is not its own — not
 * the vendor's, not another tenant's. Where this returns nothing (the first
 * visit on this browser) the caller must show a neutral placeholder, never the
 * platform brand. Keyed per slug exactly like every other cache here, so two
 * businesses open in two tabs cannot read each other's.
 */
export function readCachedBrandIdentity(slug: string | null): {
  name: string;
  shortName: string;
  /** No fallback to name here — empty is meaningful to resolveLockup. */
  lockupTagline: string;
  legalName: string;
  logoUrl: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRAND_PROFILE_KEY_PREFIX + (slug || "default"));
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, string | undefined>;
    if (!p.name && !p.logoUrl) return null;
    return {
      name: p.name || "",
      shortName: p.shortName || p.name || "",
      lockupTagline: p.lockupTagline || "",
      legalName: p.legalName || p.name || "",
      logoUrl: p.logoUrl || "",
    };
  } catch {
    return null;
  }
}

export function cacheBrandProfile(
  slug: string | null,
  profile: { legalName: string; kmlRegNo: string; addressLine: string } & Partial<{ name: string; shortName: string; lockupTagline: string; logoUrl: string }>
): void {
  if (typeof window === "undefined") return;
  const key = BRAND_PROFILE_KEY_PREFIX + (slug || "default");
  try {
    /* MERGE, never replace. Two callers write this record with different
     * halves of it: the authenticated read supplies the registration number
     * and address, the public (signed-out) read only ever knows the name and
     * logo. A straight overwrite meant an expired token — which falls through
     * to the public read — silently blanked the registration number that the
     * print templates then had to fall back to the platform's for. Empty
     * strings are treated as "not supplied" and leave the stored value alone. */
    const prev = JSON.parse(window.localStorage.getItem(key) || "{}") as Record<string, string>;
    const merged: Record<string, string> = { ...prev };
    for (const [k, v] of Object.entries(profile)) if (v) merged[k] = v;
    window.localStorage.setItem(key, JSON.stringify(merged));
  } catch {
    /* storage disabled — templates fall back to the platform brand */
  }
}

/* The arranged sidebar header, replayed on a cold load like the identity
 * above so a business with a custom header does not flash the classic lockup
 * first. Its own key, REPLACED on every write rather than merged: "" is a real
 * value here (back to the classic lockup), which cacheBrandProfile's
 * empty-means-unsupplied merge would never let through. */
const BRAND_HEADER_KEY_PREFIX = "cloudhouse_brand_header::";

export type CachedBrandHeader = {
  /** Normalised layout JSON, or "" for the classic lockup. */
  headerLayout: string;
  shortNameSet: boolean;
  logoDisplay: string;
};

export function cacheBrandHeader(slug: string | null, header: CachedBrandHeader): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRAND_HEADER_KEY_PREFIX + (slug || "default"), JSON.stringify(header));
  } catch {
    /* storage disabled — the header still renders once branding loads */
  }
}

export function readCachedBrandHeader(slug: string | null): CachedBrandHeader | null {
  if (typeof window === "undefined") return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(BRAND_HEADER_KEY_PREFIX + (slug || "default")) || "null");
    if (!v || typeof v !== "object") return null;
    return {
      headerLayout: typeof v.headerLayout === "string" ? v.headerLayout : "",
      shortNameSet: v.shortNameSet === true,
      logoDisplay: typeof v.logoDisplay === "string" ? v.logoDisplay : "",
    };
  } catch {
    return null;
  }
}

/* printBrand falls back FIELD BY FIELD rather than all-or-nothing: a business
 * that has a legal name but no registration number on file should print its
 * own name, not revert wholesale to CloudHouse's. */
export function printBrand(): PrintBrand {
  const fallback: PrintBrand = {
    legalName: BRAND.legalName,
    kmlRegLabel: BRAND.kmlRegLabel,
    kmlRegNo: BRAND.kmlReg,
    addressLine: "",
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(BRAND_PROFILE_KEY_PREFIX + (activeBusinessSlug() || "default"));
    if (!raw) return fallback;
    const p = JSON.parse(raw) as { legalName?: string; kmlRegNo?: string; addressLine?: string };
    return {
      legalName: p.legalName || fallback.legalName,
      kmlRegLabel: p.kmlRegNo ? `KML Reg. No: ${p.kmlRegNo}` : fallback.kmlRegLabel,
      kmlRegNo: p.kmlRegNo || fallback.kmlRegNo,
      addressLine: p.addressLine || "",
    };
  } catch {
    return fallback;
  }
}

/* tenantLenderProfile is printBrand's counterpart with NO platform fallback:
 * it returns empty strings when the business has not set a value.
 *
 * The two exist separately because they answer different questions. A
 * printed masthead always needs *something*, so printBrand falls back to
 * CloudHouse. The pledge agreement and release form instead have their own
 * historical defaults — the particulars this deployment has been printing
 * since before tenant profiles existed — and must keep using those rather
 * than silently switching a live business's legal paperwork to the platform
 * name. So they need to know whether a tenant value actually exists, which
 * a pre-filled fallback would hide.
 */
export function tenantLenderProfile(): { legalName: string; addressLine: string; kmlRegNo: string } {
  const empty = { legalName: "", addressLine: "", kmlRegNo: "" };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(BRAND_PROFILE_KEY_PREFIX + (activeBusinessSlug() || "default"));
    if (!raw) return empty;
    const p = JSON.parse(raw) as { legalName?: string; kmlRegNo?: string; addressLine?: string };
    return {
      legalName: p.legalName || "",
      addressLine: p.addressLine || "",
      kmlRegNo: p.kmlRegNo || "",
    };
  } catch {
    return empty;
  }
}
