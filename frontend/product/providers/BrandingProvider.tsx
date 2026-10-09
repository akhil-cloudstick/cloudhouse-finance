"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { cacheBrandHeader, cacheBrandProfile, readCachedBrandHeader, readCachedBrandIdentity } from "@/product/config/brand";
import { monogramFor, parseHeaderLayout, serializeHeaderLayout, type HeaderLayout } from "@/product/config/headerLayout";
import {
  applyBrandTheme,
  applyDocumentTitle,
  applyBrandFavicon,
  applyCachedFavicon,
  cacheBrandLogo,
  cacheBrandTheme,
  cacheDocumentTitle,
  readCachedDocumentTitle,
  NEUTRAL_DOCUMENT_TITLE,
  DEFAULT_BRAND_COLOR,
} from "@/product/config/theme";
import { activeBusinessSlug, readToken } from "@/product/services/tenantSession";
import {
  fetchMyBranding,
  fetchPublicBranding,
  type MyBranding,
} from "@/product/pages/branding/services/brandingService";

/* The business's own identity — name, logo, colour — and the two grants that
 * decide what the app will show at all.
 *
 * Sits beside AuthProvider rather than inside it because branding is needed
 * in states where there is no session: the sign-in page renders a business's
 * logo and colour before anyone has authenticated. So this loads in two
 * stages:
 *
 *   1. Signed out — the PUBLIC endpoint, keyed by the slug in the URL
 *      (/<code>/login). Name, logo and colour only.
 *   2. Signed in — the authenticated endpoint, which additionally returns the
 *      address, registration number, enabled modules and document languages.
 *      The business comes from the token, never the URL: the slug SELECTS a
 *      business to authenticate against and never grants anything, exactly as
 *      tenantSession.ts's header comment sets out.
 *
 * Everything falls back to the platform brand (common/config/brand.ts). A
 * branding lookup that fails must degrade to CloudHouse's own mark, never to
 * a blank shell — and, critically, never to another business's branding.
 */

export type BrandingValue = {
  name: string;
  legalName: string;
  /** Compact identity for tight spots — sidebar headline, tab title, login
   * subtext. Falls back to name, never empty. */
  shortName: string;
  /** Sidebar subline under the headline. CAN be empty — no server-side
   * fallback — which resolveLockup reads as "use the business name, unless
   * that would just repeat the headline". See common/utils/brandLockup.ts. */
  lockupTagline: string;
  addressLine: string;
  kmlRegNo: string;
  brandColor: string;
  /** Empty means "not set" — see frontend/common/config/theme.ts. */
  secondaryColor: string;
  accentColor: string;
  sidebarColor: string;
  fontFamily: string;
  fontScale: string;
  logoScale: string;
  logoDisplay: string;
  /** Text on the sidebar ground / on primary fills; empty = automatic. */
  navTextColor: string;
  onBrandTextColor: string;
  /** The vendor-arranged sidebar header; null renders the classic lockup.
   * See product/config/headerLayout.ts. */
  headerLayout: HeaderLayout | null;
  /** False when shortName is only the business-name fallback. An arranged
   * header shows no title then, rather than repeat a name the logo carries. */
  shortNameSet: boolean;
  /** Empty means "render the platform mark" — see BrandLogo. */
  logoUrl: string;
  appUrl: string;
  modules: string[];
  languages: string[];
  /** This business works on its one default branch only: branch pickers lock
   * to it and the branch switcher is hidden. Per business, set by the vendor. */
  singleBranch: boolean;
  /** True once a real response has been applied (either stage). */
  loaded: boolean;
  /** True when this browser already knew the business's name and logo before
   * the fetch — i.e. the values on screen are the business's own, replayed
   * from cache, and a placeholder is not needed. False on a first-ever visit,
   * where chrome must render neutrally until `loaded`. */
  cached: boolean;
  /**
   * hasModule gates an OPTIONAL module (tenant.KnownModules). Fails closed:
   * an unknown key, or a value that has not loaded yet, is false.
   *
   * This only decides what is DRAWN. The backend enforces the same flag per
   * request via platform.RequireTenantModule — hiding a nav item has never
   * been access control.
   */
  hasModule: (key: string) => boolean;
  /** hasLanguage gates a document language. English is always available. */
  hasLanguage: (code: string) => boolean;
  refresh: () => void;
};

const FALLBACK: Omit<BrandingValue, "hasModule" | "hasLanguage" | "refresh" | "loaded" | "cached"> = {
  /* EMPTY, not the platform brand. This is what every consumer renders on the
   * one load where a business's own identity is not yet known, and the rule is
   * that a business sees its own brand or a neutral placeholder — never the
   * vendor's and never another tenant's, not even for a frame. Chrome that
   * reads these (Sidebar, Topbar, the login panel, BrandLogo) handles the empty
   * case explicitly rather than substituting a name of its own. */
  name: "",
  legalName: "",
  shortName: "",
  lockupTagline: "",
  addressLine: "",
  kmlRegNo: "",
  brandColor: DEFAULT_BRAND_COLOR,
  secondaryColor: "",
  accentColor: "",
  sidebarColor: "",
  fontFamily: "",
  fontScale: "",
  logoScale: "",
  logoDisplay: "",
  navTextColor: "",
  onBrandTextColor: "",
  headerLayout: null,
  shortNameSet: false,
  logoUrl: "",
  appUrl: "",
  modules: [],
  languages: ["en"],
  singleBranch: false,
};

const BrandingContext = createContext<BrandingValue | undefined>(undefined);

/* initialBranding replays the business's last-known name and logo so a reload
 * renders ITS identity on the first frame rather than the platform's.
 *
 * Returns FALLBACK only when this browser has never loaded this business.
 * Callers must treat that state (loaded === false and cached === false) as
 * "show a neutral placeholder" — never as licence to paint the platform mark,
 * which is the whole flash this file exists to remove.
 *
 * Applied from an EFFECT, never during render. This used to be a lazy
 * useState initializer, on the reasoning that a lazy initializer "runs in the
 * browser only". It does not: lazy means it runs on the first render rather
 * than every render, and the client's first render is the HYDRATION render —
 * the one pass that must match the prerendered HTML exactly. The build has no
 * localStorage, so it rendered BrandLogo's neutral placeholder while a
 * returning user's browser rendered an <img>: two different elements in one
 * slot, which React reports as a hydration mismatch and then crashes trying
 * to unpick ("Cannot read properties of null (reading 'removeChild')").
 *
 * Deferring costs nothing visually. The browser paints the prerendered HTML —
 * the placeholder — before any of this code runs either way; the cache can
 * only ever swap it afterwards. What is genuinely pre-paint is the inline
 * script in brand-preload.tsx, which sets colours, title and favicon outside
 * React's tree, where there is no hydration contract to break.
 */
function initialBranding(): { state: typeof FALLBACK; cached: boolean } {
  const id = readCachedBrandIdentity(activeBusinessSlug());
  if (!id) return { state: FALLBACK, cached: false };
  const header = readCachedBrandHeader(activeBusinessSlug());
  return {
    state: {
      ...FALLBACK,
      headerLayout: parseHeaderLayout(header?.headerLayout),
      shortNameSet: header?.shortNameSet ?? false,
      logoDisplay: header?.logoDisplay ?? "",
      name: id.name || FALLBACK.name,
      shortName: id.shortName || id.name || FALLBACK.shortName,
      lockupTagline: id.lockupTagline,
      legalName: id.legalName || id.name || FALLBACK.legalName,
      logoUrl: id.logoUrl,
    },
    cached: true,
  };
}

/* The tab icon draws letters instead of the logo when the logo is WIDE (a
 * wordmark shrunk to 16px is an unreadable smear), or when an arranged header
 * has no logo: the short name, else the sign-in code. Businesses still on the
 * classic lockup keep the icon they had. */
function faviconMonogram(
  layout: HeaderLayout | null,
  logoUrl: string,
  shortName: string,
  code: string | null,
  name: string
): string | undefined {
  if (!layout) return undefined;
  if (logoUrl && layout.logoShape !== "wide") return undefined;
  return monogramFor(shortName, code || "", name) || undefined;
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  /* FALLBACK on the first render, on BOTH sides — that is what makes the
   * hydration render agree with the prerendered HTML. The cache lands in the
   * effect below, one tick later. */
  const [state, setState] = useState(FALLBACK);
  const [cached, setCached] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname();

  /* Replay the cache and re-assert the cached favicon, after hydration.
   *
   * brand-preload.tsx already set the favicon before the first paint, but
   * Next's App Router re-applies the static <Metadata> when it hydrates,
   * which put the neutral placeholder back and left it there until the fetch
   * returned — the "tab stays wrong until the next refresh" symptom. The tab
   * text itself is handled by the dedicated effect below, not here.
   */
  useEffect(() => {
    const seed = initialBranding();
    if (!seed.cached) return;
    /* set-state-in-effect is exactly what is wanted here, not an oversight.
     * localStorage is an external system React cannot read during render
     * without breaking hydration — which is the bug this effect exists to
     * fix. One extra render on mount is the price, and it is invisible: the
     * browser has already painted the prerendered HTML by this point. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(seed.state);
    setCached(true);
    /* The cached GENERATED icon, not the raw logo — see applyBrandFavicon.
     * Rebuilding here would use FALLBACK's colour, since the seed carries no
     * theme; the fetch below rebuilds if anything actually changed. */
    applyCachedFavicon(activeBusinessSlug());
  }, []);

  /* The tab text, in ONE place, re-applied whenever the answer could change.
   *
   * Three bugs lived in doing this at each fetch site instead. A fetch that
   * returned nothing (unknown slug, a 404, a backend blip) skipped its
   * apply call entirely and left "Loading…" in the tab forever, with no
   * retry and nothing to recover it but a manual reload. A browser holding a
   * cached title but no cached profile took an early return and never
   * re-asserted after the App Router restored the static metadata title. And
   * because every apply was tied to a fetch that runs once per mount, a
   * client-side navigation could restore the metadata title with nothing left
   * to overwrite it again.
   *
   * Keying on pathname fixes the third; falling back through the title cache
   * to the neutral placeholder fixes the other two. The result is never
   * empty, which matters: an empty document.title makes the browser display
   * the raw URL, the "tab shows localhost:3000/ctfi/newloan" symptom.
   */
  useEffect(() => {
    applyDocumentTitle(
      state.shortName || readCachedDocumentTitle(activeBusinessSlug()) || NEUTRAL_DOCUMENT_TITLE
    );
  }, [pathname, state.shortName]);

  const load = useCallback(async () => {
    const slug = activeBusinessSlug();

    // Signed in: the authoritative read. Modules and languages only ever
    // come from here — the public endpoint deliberately does not expose
    // them, and a grant read from an unauthenticated endpoint would be a
    // grant anyone could ask about.
    if (readToken()) {
      try {
        const b: MyBranding = await fetchMyBranding();
        const next = {
          name: b.name || FALLBACK.name,
          legalName: b.legalName || b.name || FALLBACK.legalName,
          shortName: b.shortName || b.name || FALLBACK.shortName,
          lockupTagline: b.lockupTagline || "",
          addressLine: b.addressLine || "",
          kmlRegNo: b.kmlRegNo || "",
          brandColor: b.brandColor || DEFAULT_BRAND_COLOR,
          secondaryColor: b.secondaryColor || "",
          accentColor: b.accentColor || "",
          sidebarColor: b.sidebarColor || "",
          fontFamily: b.fontFamily || "",
          fontScale: b.fontScale || "",
          logoScale: b.logoScale || "",
          logoDisplay: b.logoDisplay || "",
          navTextColor: b.navTextColor || "",
          onBrandTextColor: b.onBrandTextColor || "",
          headerLayout: parseHeaderLayout(b.headerLayout),
          shortNameSet: !!b.shortNameSet,
          logoUrl: b.logoUrl || "",
          appUrl: b.appUrl || "",
          modules: b.modules || [],
          languages: b.languages?.length ? b.languages : ["en"],
          singleBranch: !!b.singleBranch,
        };
        setState(next);
        setLoaded(true);
        const theme = {
          primary: next.brandColor,
          secondary: next.secondaryColor,
          fontFamily: next.fontFamily,
          fontScale: next.fontScale,
          navText: next.navTextColor,
          onBrandText: next.onBrandTextColor,
        };
        applyBrandTheme(theme);
        cacheBrandTheme(slug, theme);
        void applyBrandFavicon(slug, {
          logoUrl: next.logoUrl,
          brandColor: next.brandColor,
          name: next.shortName || next.name,
          monogram: faviconMonogram(next.headerLayout, next.logoUrl, next.shortNameSet ? next.shortName : "", slug, next.name),
        });
        cacheBrandHeader(slug, {
          headerLayout: next.headerLayout ? serializeHeaderLayout(next.headerLayout) : "",
          shortNameSet: next.shortNameSet,
          logoDisplay: next.logoDisplay,
        });
        cacheBrandLogo(slug, next.logoUrl);
        /* Only CACHE here — applying is the title effect's job, driven off
         * state.shortName, which setState above has just changed. Applying at
         * the fetch sites too is what let the failure paths below fall
         * through with the tab still saying "Loading…". */
        cacheDocumentTitle(slug, next.shortName);
        // The print templates are plain string builders and cannot read
        // React context — see printBrand in common/config/brand.ts.
        cacheBrandProfile(slug, {
          legalName: next.legalName,
          kmlRegNo: next.kmlRegNo,
          addressLine: next.addressLine,
          // Also the pre-paint identity — see readCachedBrandIdentity.
          name: next.name,
          shortName: next.shortName,
          lockupTagline: next.lockupTagline,
          logoUrl: next.logoUrl,
        });
        return;
      } catch {
        // Fall through to the public read. A failed authenticated fetch
        // (expired token, backend blip) should still leave the sign-in
        // chrome correctly branded.
      }
    }

    const pub = await fetchPublicBranding(slug);
    if (pub) {
      const pubLayout = parseHeaderLayout(pub.headerLayout);
      setState((prev) => ({
        ...prev,
        name: pub.name || FALLBACK.name,
        legalName: pub.legalName || pub.name || FALLBACK.legalName,
        shortName: pub.shortName || pub.name || FALLBACK.shortName,
        lockupTagline: pub.lockupTagline || "",
        brandColor: pub.brandColor || DEFAULT_BRAND_COLOR,
        secondaryColor: pub.secondaryColor || "",
        accentColor: pub.accentColor || "",
        sidebarColor: pub.sidebarColor || "",
        fontFamily: pub.fontFamily || "",
        fontScale: pub.fontScale || "",
        logoScale: pub.logoScale || "",
        logoDisplay: pub.logoDisplay || "",
        navTextColor: pub.navTextColor || "",
        onBrandTextColor: pub.onBrandTextColor || "",
        headerLayout: pubLayout,
        shortNameSet: !!pub.shortNameSet,
        logoUrl: pub.logoUrl || "",
        appUrl: pub.appUrl || "",
      }));
      const theme = {
        primary: pub.brandColor || DEFAULT_BRAND_COLOR,
        secondary: pub.secondaryColor,
        fontFamily: pub.fontFamily,
        fontScale: pub.fontScale,
        navText: pub.navTextColor,
        onBrandText: pub.onBrandTextColor,
      };
      applyBrandTheme(theme);
      cacheBrandTheme(slug, theme);
      void applyBrandFavicon(slug, {
        logoUrl: pub.logoUrl || "",
        brandColor: pub.brandColor || DEFAULT_BRAND_COLOR,
        name: pub.shortName || pub.name || "",
        monogram: faviconMonogram(pubLayout, pub.logoUrl || "", pub.shortNameSet ? pub.shortName : "", slug, pub.name || ""),
      });
      cacheBrandHeader(slug, {
        headerLayout: pubLayout ? serializeHeaderLayout(pubLayout) : "",
        shortNameSet: !!pub.shortNameSet,
        logoDisplay: pub.logoDisplay || "",
      });
      cacheBrandLogo(slug, pub.logoUrl);
      // Cache only — see the note on the authenticated branch above.
      cacheDocumentTitle(slug, pub.shortName || pub.name);
      // The sign-in page is where a business is most often seen cold, so the
      // public read seeds the identity cache too — without this, only users
      // who have already signed in on this browser get a flash-free login.
      cacheBrandProfile(slug, {
        legalName: pub.legalName || pub.name || "",
        kmlRegNo: "",
        addressLine: "",
        name: pub.name || "",
        shortName: pub.shortName || pub.name || "",
        lockupTagline: pub.lockupTagline || "",
        logoUrl: pub.logoUrl || "",
      });
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasModule = useCallback(
    // `=== true` via includes: an unloaded or unknown key denies, matching
    // how auth-context's can() fails closed.
    (key: string) => state.modules.includes(key),
    [state.modules]
  );

  const hasLanguage = useCallback(
    (code: string) => code === "en" || state.languages.includes(code),
    [state.languages]
  );

  const value = useMemo<BrandingValue>(
    () => ({ ...state, loaded, cached, hasModule, hasLanguage, refresh: () => void load() }),
    [state, loaded, cached, hasModule, hasLanguage, load]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

/* useBranding is safe outside the provider — it returns the platform
 * fallback rather than throwing (unlike useAuth, which must throw because a
 * missing session is a bug). A component rendering the default logo is a
 * cosmetic degradation; a crash is not. */
export function useBranding(): BrandingValue {
  const ctx = useContext(BrandingContext);
  if (ctx) return ctx;
  return {
    ...FALLBACK,
    loaded: false,
    cached: false,
    hasModule: () => false,
    hasLanguage: (code: string) => code === "en",
    refresh: () => {},
  };
}
