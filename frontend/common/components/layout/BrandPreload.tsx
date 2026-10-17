import {
  BRAND_COLOR_KEY_PREFIX,
  BRAND_FAVICON_KEY_PREFIX,
  BRAND_LOGO_KEY_PREFIX,
  BRAND_TITLE_KEY_PREFIX,
  BRAND_VARS_KEY_PREFIX,
  DEFAULT_BRAND_COLOR,
} from "@/common/config/theme";

/* A blocking inline script that paints the signed-in business's brand colour
 * before React ever mounts.
 *
 * WHY IT HAS TO BE INLINE AND BLOCKING. next.config.ts sets output: "export",
 * so these pages are static HTML with no server render — the first paint
 * happens long before BrandingProvider's fetch can return. Without this, a
 * business with its own colour would see CloudHouse violet flash on every
 * page load and then swap. Only a synchronous script in the document, ahead
 * of the first paint, can prevent that.
 *
 * It reads the colour BrandingProvider cached under the business's own slug
 * (the same per-slug keying tenantSession.ts uses for sessions, so two
 * businesses in two tabs never read each other's). The cache is a hint, never
 * an authority: it only decides a colour, the real values still arrive from
 * the API, and anything unparseable falls through to the default.
 *
 * The ramp maths is duplicated here in miniature rather than imported —
 * this string cannot import a module, and pulling in the full oklch
 * conversion would mean shipping it twice. Instead it sets only the hue and
 * chroma-scaled steps via CSS's own oklch(), which the browser can compute
 * without any JavaScript colour library. Keep the L/C table in step with
 * RAMP in common/config/theme.ts.
 */
const script = `
(function () {
  try {
    // The business is the FIRST path segment (/ctfi/dashboard), unless that
    // segment is a page name — the same ambiguity common/config/routes.ts
    // resolves with RESERVED_ROOT_SEGMENTS, in the smallest form that can be
    // inlined here. Getting it wrong only costs a cache miss (the neutral
    // loading state, then the real branding a moment later), never another
    // business's brand: an unknown slug simply has nothing cached under it.
    var p = location.pathname.split("/").filter(Boolean);
    var reserved = /^(login|reset|app|api|uploads|assets|static|_next|index|superadmin|forgot-password|reset-password|digilocker-callback|esign-callback|dashboard|customers?|loans?|newloan|schemes|goldrates|requests|loanrisk|personalloans?|investments?|cash|auctions|packets?|bankpledge|reports|employees|calendar|branches|roles-permissions|billing|settings)$/;
    var first = p.length ? p[0].toLowerCase() : "";
    // The desktop shell has no tenant subdomain of its own (always
    // wails.localhost) — mirrors tenantSession.ts's desktopSlugFromApiBase,
    // reading the one baked into this build instead. Avoids this earliest,
    // pre-React guess ever landing on "default" (and fetching a stale/wrong
    // cached logo through it) for a desktop build that already names its tenant.
    var desktopSlug = "";
    try {
      var apiBaseHost = new URL(${JSON.stringify(process.env.NEXT_PUBLIC_API_BASE || "")}).hostname.toLowerCase();
      var hl = apiBaseHost.split(".");
      if (hl.length >= 3 && /^[a-z0-9][a-z0-9-]*$/.test(hl[0])) desktopSlug = hl[0];
    } catch (e) { /* no NEXT_PUBLIC_API_BASE, or it's relative — not a desktop tenant build */ }
    var slug = (first && /^[a-z0-9][a-z0-9-]*$/.test(first) && !reserved.test(first))
      ? first
      : ((location.hostname === "wails.localhost" && desktopSlug) || localStorage.getItem("cloudhouse_active_business") || "default");
    var hex = localStorage.getItem(${JSON.stringify(BRAND_COLOR_KEY_PREFIX)} + slug) || ${JSON.stringify(DEFAULT_BRAND_COLOR)};
    var m = /^#?([0-9a-f]{6})$/i.exec(hex);
    // Not a bare return: the tab icon below must still be installed.
    if (m) {
    var n = parseInt(m[1], 16);
    function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    var r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
    var l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
    var m2 = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
    var s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
    var A = 1.9779984951*l - 2.4285922050*m2 + 0.4505937099*s;
    var B = 0.0259040371*l + 0.7827717662*m2 - 0.8086757660*s;
    var C = Math.sqrt(A*A + B*B);
    var H = Math.atan2(B, A) * 180 / Math.PI; if (H < 0) H += 360;
    var steps = [["--brand-deep",0.400,0.145],["--brand",0.515,0.162],["--brand-mid",0.580,0.150],
                 ["--brand-light",0.750,0.100],["--brand-pale",0.955,0.020],["--brand-faint",0.983,0.008]];
    for (var i = 0; i < steps.length; i++) {
      var c = C * (steps[i][2] / 0.162);
      document.documentElement.style.setProperty(steps[i][0],
        "oklch(" + steps[i][1] + " " + c.toFixed(3) + " " + H.toFixed(1) + ")");
    }
    }
    // The sidebar ground and the text colours on it and on buttons, resolved
    // by theme.ts (cacheBrandTheme) and stored as plain values — so a business
    // with a light sidebar never flashes the default dark one with white text.
    // Only known names, and only plain colour values, are ever applied.
    var vars = JSON.parse(localStorage.getItem(${JSON.stringify(BRAND_VARS_KEY_PREFIX)} + slug) || "null");
    if (vars && typeof vars === "object") {
      var names = ["--nav", "--nav-2", "--nav-fg", "--on-brand", "--nav-ink"];
      for (var k = 0; k < names.length; k++) {
        var v = vars[names[k]];
        if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) document.documentElement.style.setProperty(names[k], v);
      }
    }
    // The browser tab TEXT — same problem, same fix: a static export bakes
    // one title for every business at build time (see app/(product)/layout.tsx's
    // Metadata), so without this it shows the platform name until
    // BrandingProvider's fetch resolves, on every load. Cached by
    // BrandingProvider.tsx's cacheDocumentTitle, same per-slug keying as
    // the colour above.
    var title = localStorage.getItem(${JSON.stringify(BRAND_TITLE_KEY_PREFIX)} + slug);
    if (title) document.title = title;
  } catch (e) { /* storage blocked or malformed value — keep the default theme */ }
  // The tab ICON, same problem once more. app/(product)/layout.tsx deliberately ships
  // NO icon in its metadata — a React-owned icon link could commit after
  // ours and win (browsers use the last icon in tree order), which is what
  // left some tabs randomly blank. So this script inserts the ONE icon link,
  // always, and applyFavicon (common/config/theme.ts) replaces it later.
  //
  // Preference: the normalised icon BrandingProvider generated and cached
  // (see applyBrandFavicon), then the raw logo URL an older cache may hold,
  // then a blank square — a business must never see another brand, not even
  // for one frame. Outside the try above so a storage failure still gets the
  // blank link rather than letting the browser fall back to /favicon.ico.
  var icon = "";
  try {
    var fav = JSON.parse(localStorage.getItem(${JSON.stringify(BRAND_FAVICON_KEY_PREFIX)} + slug) || "null");
    icon = (fav && typeof fav.icon === "string" && fav.icon) || localStorage.getItem(${JSON.stringify(BRAND_LOGO_KEY_PREFIX)} + slug) || "";
  } catch (e) { /* storage blocked or malformed value */ }
  var el = document.createElement("link");
  el.rel = "icon";
  el.href = icon || "/blank-icon.svg";
  el.setAttribute("data-brand-icon", "");
  document.head.appendChild(el);
})();
`;

export function BrandPreload() {
  // suppressHydrationWarning: in the desktop dev shell, DESKTOP_RUNTIME_LOADER
  // (the sibling script right after this one — see app/(product)/layout.tsx)
  // rewrites the page via document.write() before React hydrates, which
  // shifts this node too; same reasoning as that script's own suppression.
  // eslint-disable-next-line @next/next/no-sync-scripts
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} />;
}
