import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from "react";
import * as SecureStore from "expo-secure-store";
import { colors as defaultColors } from "./colors";
import { typeScale } from "./typography";
import { deriveBrandRampHex, DEFAULT_BRAND_COLOR } from "./brandRamp";
import { fetchPublicBranding, fetchMyBranding, resolveLogoUrl } from "@/common/services/brandingService";
import { getBusinessCode, isValidBusinessCode, normalizeBusinessCode } from "@/common/services/businessCode";
import { getToken } from "@/common/services/tokenStorage";

// Per-tenant colour + logo (see backend/internal/branding), same approach as
// mobile/src/common/theme/ThemeProvider.tsx — cached per lender code so a cold
// start repaints the last-known brand colour immediately instead of
// flashing the platform default while the fetch is in flight.
const BRAND_COLOR_CACHE_PREFIX = "cloudhousecustomer_brand_color::";
const LOGO_URL_CACHE_PREFIX = "cloudhousecustomer_logo_url::";

async function readCache(prefix: string, code: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(prefix + (code || "default"));
  } catch {
    return null;
  }
}

async function writeCache(prefix: string, code: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(prefix + (code || "default"), value);
  } catch {
    /* best-effort — the theme still applies for this session */
  }
}

type Colors = { [K in keyof typeof defaultColors]: string };

type ThemeState = {
  colors: Colors;
  typeScale: typeof typeScale;
  // Resolved, absolute logo URL, or null to use the bundled platform mark.
  logoUrl: string | null;
  // Re-fetches branding — call after a successful sign-in (the remembered
  // code may have just changed). Pass `codeOverride` while the lender-code
  // field is still being typed, before it's saved to SecureStore, so the
  // login screen's theme previews the business the customer is entering.
  refreshBranding: (codeOverride?: string) => void;
};

const ThemeContext = createContext<ThemeState>({
  colors: defaultColors,
  typeScale,
  logoUrl: null,
  refreshBranding: () => {},
});

type ThemeProviderProps = { children: React.ReactNode };

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [colors, setColors] = useState<Colors>(defaultColors);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const requestId = useRef(0);

  const applyBrandColor = useCallback((hex: string) => {
    setColors({ ...defaultColors, ...deriveBrandRampHex(hex) });
  }, []);

  const load = useCallback(async (codeOverride?: string) => {
    const myRequest = ++requestId.current;
    let code: string;
    if (codeOverride !== undefined) {
      const normalized = normalizeBusinessCode(codeOverride);
      code = isValidBusinessCode(normalized) ? normalized : "";
    } else {
      code = await getBusinessCode();
    }

    const cachedColor = await readCache(BRAND_COLOR_CACHE_PREFIX, code);
    const cachedLogo = await readCache(LOGO_URL_CACHE_PREFIX, code);
    if (myRequest !== requestId.current) return;
    applyBrandColor(cachedColor || DEFAULT_BRAND_COLOR);
    setLogoUrl(cachedLogo || null);

    try {
      const token = await getToken();
      const branding = token ? await fetchMyBranding() : await fetchPublicBranding(code);
      if (myRequest !== requestId.current) return;
      applyBrandColor(branding.brandColor);
      setLogoUrl(resolveLogoUrl(branding.logoUrl));
      await writeCache(BRAND_COLOR_CACHE_PREFIX, code, branding.brandColor);
      await writeCache(LOGO_URL_CACHE_PREFIX, code, branding.logoUrl || "");
    } catch {
      // Offline/unreachable — the cached (or default) theme from above
      // stays in place; never block the app on a branding fetch failing.
    }
  }, [applyBrandColor]);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo(
    () => ({ colors, typeScale, logoUrl, refreshBranding: load }),
    [colors, logoUrl, load]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
