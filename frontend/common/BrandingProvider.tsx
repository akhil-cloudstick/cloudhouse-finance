"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BRAND, cacheBrandProfile } from "@/common/config/brand";
import { applyBrandTheme, cacheBrandColor, DEFAULT_BRAND_COLOR } from "@/common/config/theme";
import { activeBusinessSlug, readToken } from "@/common/services/tenantSession";
import {
  fetchMyBranding,
  fetchPublicBranding,
  type MyBranding,
} from "@/modules/branding/services/brandingService";

/* The business's own identity — name, logo, colour — and the two grants that
 * decide what the app will show at all.
 *
 * Sits beside AuthProvider rather than inside it because branding is needed
 * in states where there is no session: the sign-in page renders a business's
 * logo and colour before anyone has authenticated. So this loads in two
 * stages:
 *
 *   1. Signed out — the PUBLIC endpoint, keyed by the slug in the URL
 *      (/login/<code>). Name, logo and colour only.
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
  addressLine: string;
  kmlRegNo: string;
  brandColor: string;
  /** Empty means "render the platform mark" — see BrandLogo. */
  logoUrl: string;
  appUrl: string;
  modules: string[];
  languages: string[];
  /** True once a real response has been applied (either stage). */
  loaded: boolean;
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

const FALLBACK: Omit<BrandingValue, "hasModule" | "hasLanguage" | "refresh" | "loaded"> = {
  name: BRAND.name,
  legalName: BRAND.legalName,
  addressLine: "",
  kmlRegNo: BRAND.kmlReg,
  brandColor: DEFAULT_BRAND_COLOR,
  logoUrl: "",
  appUrl: "",
  modules: [],
  languages: ["en"],
};

const BrandingContext = createContext<BrandingValue | undefined>(undefined);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(FALLBACK);
  const [loaded, setLoaded] = useState(false);

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
          addressLine: b.addressLine || "",
          kmlRegNo: b.kmlRegNo || "",
          brandColor: b.brandColor || DEFAULT_BRAND_COLOR,
          logoUrl: b.logoUrl || "",
          appUrl: b.appUrl || "",
          modules: b.modules || [],
          languages: b.languages?.length ? b.languages : ["en"],
        };
        setState(next);
        setLoaded(true);
        applyBrandTheme(next.brandColor);
        cacheBrandColor(slug, next.brandColor);
        // The print templates are plain string builders and cannot read
        // React context — see printBrand in common/config/brand.ts.
        cacheBrandProfile(slug, {
          legalName: next.legalName,
          kmlRegNo: next.kmlRegNo,
          addressLine: next.addressLine,
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
      setState((prev) => ({
        ...prev,
        name: pub.name || FALLBACK.name,
        legalName: pub.legalName || pub.name || FALLBACK.legalName,
        brandColor: pub.brandColor || DEFAULT_BRAND_COLOR,
        logoUrl: pub.logoUrl || "",
        appUrl: pub.appUrl || "",
      }));
      applyBrandTheme(pub.brandColor);
      cacheBrandColor(slug, pub.brandColor || DEFAULT_BRAND_COLOR);
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
    () => ({ ...state, loaded, hasModule, hasLanguage, refresh: () => void load() }),
    [state, loaded, hasModule, hasLanguage, load]
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
    hasModule: () => false,
    hasLanguage: (code: string) => code === "en",
    refresh: () => {},
  };
}
