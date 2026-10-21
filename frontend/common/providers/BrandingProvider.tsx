"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { cacheBrandHeader, cacheBrandProfile, readCachedBrandHeader, readCachedBrandIdentity } from "@/common/config/brand";
import { monogramFor, parseHeaderLayout, serializeHeaderLayout, type HeaderLayout } from "@/common/config/headerLayout";
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
} from "@/common/config/theme";
import { activeBusinessSlug, readToken } from "@/common/services/tenantSession";
import { resolveAssetUrl } from "@/common/services/httpClient";
import { fetchMyBranding, fetchPublicBranding } from "@/modules/branding/services/brandingService";
import { type MyBranding } from "@/modules/branding/types/branding-types";

// Sits beside AuthProvider (not inside it) since branding is needed pre-session — the sign-in page shows a business's logo/colour before auth.
// Loads in two stages: (1) signed out — PUBLIC endpoint keyed by the URL slug, name/logo/colour only; (2) signed in — authenticated endpoint, also returns address/reg no/modules/languages, business resolved from the token not the URL (see tenantSession.ts).
// Everything falls back to the platform brand; a failed lookup degrades to CloudHouse's own mark, never another tenant's.

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
  contactPhone: string;
  policy: string;
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
   * See common/config/headerLayout.ts. */
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
  // EMPTY, not the platform brand — a business sees its own brand or a neutral placeholder, never the vendor's or another tenant's, not even for a frame.
  name: "",
  legalName: "",
  shortName: "",
  lockupTagline: "",
  addressLine: "",
  kmlRegNo: "",
  contactPhone: "",
  policy: "",
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

// Replays the business's last-known name/logo so a reload shows its identity on the first frame. Returns FALLBACK only when this browser never loaded this business (treat as neutral placeholder, never the platform mark).
// Must be applied from an EFFECT, not a lazy useState initializer: the client's first render is the hydration render, which must match the server's no-localStorage output or React crashes on mismatch. Deferring costs nothing visually since the prerendered HTML paints first either way.
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
      logoUrl: resolveAssetUrl(id.logoUrl),
    },
    cached: true,
  };
}

// Draws letters instead of the logo when the logo is wide (unreadable at 16px) or an arranged header has no logo. Classic-lockup businesses keep the icon they had.
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

type BrandingProviderProps = { children: React.ReactNode };

export function BrandingProvider({ children }: BrandingProviderProps) {
  // FALLBACK on both the server and first client render, so hydration agrees with the prerendered HTML; the cache lands one tick later in the effect below.
  const [state, setState] = useState(FALLBACK);
  const [cached, setCached] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname();

  // Replays the cache and re-asserts the favicon after hydration, since Next's App Router re-applies the static <Metadata> on hydrate and would otherwise leave the neutral placeholder until the fetch returns.
  useEffect(() => {
    const seed = initialBranding();
    if (!seed.cached) return;
    // set-state-in-effect is intentional: localStorage can't be read during render without breaking hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(seed.state);
    setCached(true);
    // The cached GENERATED icon, not the raw logo — see applyBrandFavicon. The fetch below rebuilds it if anything changed.
    applyCachedFavicon(activeBusinessSlug());
  }, []);

  // Tab text in one place, re-applied on every pathname/shortName change — a per-fetch-site apply left "Loading…" stuck on a failed fetch or a client-side nav restoring the static metadata title. Falls back through the title cache to the neutral placeholder so it's never empty (an empty title shows the raw URL).
  useEffect(() => {
    applyDocumentTitle(
      state.shortName || readCachedDocumentTitle(activeBusinessSlug()) || NEUTRAL_DOCUMENT_TITLE
    );
  }, [pathname, state.shortName]);

  const load = useCallback(async () => {
    const slug = activeBusinessSlug();

    // Signed in: the authoritative read. Modules/languages only ever come from here — the public endpoint deliberately doesn't expose them.
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
          contactPhone: b.contactPhone || "",
          policy: b.policy || "",
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
        // Only CACHE here — applying is the title effect's job, driven off state.shortName.
        cacheDocumentTitle(slug, next.shortName);
        // Print templates are plain string builders and can't read React context — see printBrand in brand.ts.
        cacheBrandProfile(slug, {
          legalName: next.legalName,
          kmlRegNo: next.kmlRegNo,
          contactPhone: next.contactPhone,
          policy: next.policy,
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
        contactPhone: "",
        policy: "",
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
