import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { colors as defaultColors, type Colors } from "./colors";
import { typeScale } from "./typography";
import { DEFAULT_BRAND_COLOR } from "./brandRamp";
import { fetchPublicBranding, fetchMyBranding, resolveLogoUrl, type PublicBranding, type SelfBranding } from "../api/branding";
import { getBusinessCode } from "../auth/businessCode";
import { getToken } from "../auth/tokenStorage";
import { BRAND, setPrintProfile } from "../config/brand";

// Per-tenant colour + logo (see backend/internal/branding). Cached per
// business code so a cold start repaints the last-known brand colour
// immediately instead of flashing the platform default while the fetch is
// in flight — mirrors frontend/common/config/theme.ts's
// cacheBrandColor/readCachedBrandColor for the web app.
//
// SecureStore keys may only contain [A-Za-z0-9._-], so the separator is "."
// and the code is sanitised — an invalid key throws, which readCache would
// swallow and silently disable the cache.
const BRAND_COLOR_CACHE_PREFIX = "cloudhousestaff_brand_color.";
const LOGO_URL_CACHE_PREFIX = "cloudhousestaff_logo_url.";
// JSON of CachedProfile — the business's name/registration/address (for
// print templates) and its enabled optional modules.
const PROFILE_CACHE_PREFIX = "cloudhousestaff_business_profile.";

type CachedProfile = {
  name: string;
  legalName: string;
  kmlRegNo: string;
  addressLine: string;
  modules: string[];
};

const EMPTY_PROFILE: CachedProfile = { name: "", legalName: "", kmlRegNo: "", addressLine: "", modules: [] };

function parseProfile(raw: string | null): CachedProfile {
  if (!raw) return EMPTY_PROFILE;
  try {
    return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<CachedProfile>) };
  } catch {
    return EMPTY_PROFILE;
  }
}

function isSelf(b: PublicBranding | SelfBranding): b is SelfBranding {
  return Array.isArray((b as SelfBranding).modules);
}

// How often branding is re-checked while the app is in the foreground.
const BRANDING_REFRESH_MS = 60_000;

function cacheKey(prefix: string, code: string): string {
  return prefix + (code || "default").replace(/[^A-Za-z0-9._-]/g, "_");
}

async function readCache(prefix: string, code: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(cacheKey(prefix, code));
  } catch {
    return null;
  }
}

async function writeCache(prefix: string, code: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(cacheKey(prefix, code), value);
  } catch {
    /* best-effort — the theme still applies for this session */
  }
}

export type { Colors };

type ThemeState = {
  colors: Colors;
  typeScale: typeof typeScale;
  // Resolved, absolute logo URL, or null to use the bundled platform mark.
  logoUrl: string | null;
  // The business's display name, or the platform name until one is known.
  businessName: string;
  // Whether the business has an OPTIONAL module (backend tenant.KnownModules:
  // settings, branches, demo_reset) switched on. Fails closed — unknown or
  // not-yet-loaded is false. Mirrors the web BrandingProvider's hasModule;
  // it only decides what is drawn, the backend enforces it per request.
  hasModule: (key: string) => boolean;
  // True once the cached (or default) brand has been applied — the root
  // layout keeps the splash up until then so the default colour never
  // flashes before the business's own.
  ready: boolean;
  // Re-reads the business code and re-fetches branding — call after a
  // successful sign-in (business code may have just changed) and whenever
  // the login screen's remembered code is confirmed.
  refreshBranding: () => void;
};

const ThemeContext = createContext<ThemeState>({
  colors: defaultColors,
  typeScale,
  logoUrl: null,
  businessName: BRAND.name,
  hasModule: () => false,
  ready: false,
  refreshBranding: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The staff app uses the fixed maroon palette from the prototype redesign
  // (see colors.ts) — the business's brand colour is still fetched for print
  // templates (setPrintProfile) but never re-tints the UI.
  const colors: Colors = defaultColors;
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>(BRAND.name);
  // Comma-joined so an unchanged refresh doesn't hand consumers a new array.
  const [modulesKey, setModulesKey] = useState("");
  const [ready, setReady] = useState(false);
  // Guards against an in-flight fetch for an old business code overwriting
  // the theme after a newer refreshBranding() call already started.
  const requestId = useRef(0);
  // Skips re-deriving (and re-rendering every themed screen) when the
  // fetched colour is the one already applied from cache.
  const appliedHex = useRef<string | null>(null);

  const applyBrandColor = useCallback((hex: string) => {
    const normalized = hex.trim().toLowerCase();
    if (appliedHex.current === normalized) return;
    appliedHex.current = normalized;
  }, []);

  const applyProfile = useCallback((p: CachedProfile, brandColor: string) => {
    setBusinessName(p.name || BRAND.name);
    setModulesKey(p.modules.join(","));
    setPrintProfile({
      name: p.name,
      legalName: p.legalName,
      kmlRegNo: p.kmlRegNo,
      addressLine: p.addressLine,
      brandColor,
    });
  }, []);

  const load = useCallback(async () => {
    const myRequest = ++requestId.current;
    const code = await getBusinessCode();

    const [cachedColor, cachedLogo, cachedProfile] = await Promise.all([
      readCache(BRAND_COLOR_CACHE_PREFIX, code),
      readCache(LOGO_URL_CACHE_PREFIX, code),
      readCache(PROFILE_CACHE_PREFIX, code),
    ]);
    if (myRequest !== requestId.current) return;
    const cached = parseProfile(cachedProfile);
    applyBrandColor(cachedColor || DEFAULT_BRAND_COLOR);
    setLogoUrl(resolveLogoUrl(cachedLogo));
    applyProfile(cached, cachedColor || "");
    setReady(true);

    try {
      // Signed in → the token's own business. But a stored token can be
      // expired (AuthContext clears it on 401 only after this has already
      // run), and the public endpoint answers for the same business code
      // without a session — so fall back to it rather than leaving the
      // platform default on screen.
      const token = await getToken();
      let branding;
      try {
        branding = token ? await fetchMyBranding() : await fetchPublicBranding(code);
      } catch (err) {
        if (!token) throw err;
        branding = await fetchPublicBranding(code);
      }
      if (myRequest !== requestId.current) return;
      applyBrandColor(branding.brandColor || DEFAULT_BRAND_COLOR);
      setLogoUrl(resolveLogoUrl(branding.logoUrl));
      // The public response has no registration/address/modules — keep the
      // cached signed-in values for those (same business code) rather than
      // blanking them.
      const profile: CachedProfile = isSelf(branding)
        ? {
            name: branding.name,
            legalName: branding.legalName,
            kmlRegNo: branding.kmlRegNo,
            addressLine: branding.addressLine,
            modules: branding.modules,
          }
        : { ...cached, name: branding.name, legalName: branding.legalName };
      applyProfile(profile, branding.brandColor || "");
      await Promise.all([
        writeCache(BRAND_COLOR_CACHE_PREFIX, code, branding.brandColor || ""),
        writeCache(LOGO_URL_CACHE_PREFIX, code, branding.logoUrl || ""),
        writeCache(PROFILE_CACHE_PREFIX, code, JSON.stringify(profile)),
      ]);
    } catch (err) {
      // Offline/unreachable — the cached (or default) theme from above
      // stays in place; never block the app on a branding fetch failing.
      if (__DEV__) console.warn(`[branding] fetch failed for "${code || "default"}"`, err);
    }
  }, [applyBrandColor, applyProfile]);

  useEffect(() => {
    load();
  }, [load]);

  // An admin can change the colour/logo at any time, so re-fetch whenever the
  // app comes back to the foreground and periodically while it stays open.
  // Unchanged values don't re-render anything (see applyBrandColor).
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(load, BRANDING_REFRESH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") {
        load();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [load]);

  const hasModule = useCallback((key: string) => modulesKey.split(",").includes(key), [modulesKey]);

  const value = useMemo(
    () => ({ colors, typeScale, logoUrl, businessName, hasModule, ready, refreshBranding: load }),
    [colors, logoUrl, businessName, hasModule, ready, load]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

// For StyleSheets that use brand* tokens: define them as
// `const makeStyles = (c: Colors) => StyleSheet.create({...})` at module
// level and call `useThemedStyles(makeStyles)` in the component, so the
// sheet is rebuilt only when the business's colour actually changes.
export function useThemedStyles<T>(makeStyles: (c: Colors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => makeStyles(colors), [makeStyles, colors]);
}
