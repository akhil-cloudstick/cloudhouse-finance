/* Per-business theming — one picked colour drives the whole brand ramp.
 *
 * WHY THIS EXISTS. The `:root` block in app/app/app.css defines six brand
 * steps (deep/brand/mid/light/pale/faint) that 115 `var(--brand*)` rules read
 * from. Those six are not six independent choices: they are ONE colour walked
 * up and down a fixed lightness/chroma curve, all on the same hue. So a
 * business picks one colour and this file regenerates the curve around it —
 * which is why the superadmin console offers a single picker rather than six.
 *
 * Everything is oklch, matching app.css. Lightness in oklch is perceptual, so
 * holding L fixed and moving only the hue keeps each step's contrast roughly
 * where it was designed to be — the reason the ramp survives an arbitrary hue
 * at all, and why this could not be done by scaling sRGB channels.
 */

export type Oklch = { l: number; c: number; h: number };

/* The reference ramp, read straight off app.css's :root. L is absolute; C is
 * expressed as a RATIO of --brand's own chroma (0.162) so a muted pick stays
 * muted and a vivid one stays vivid, instead of every business landing on the
 * same saturation.
 *
 * Keep in step with app.css. If a step's L changes there, change it here — the
 * fallback stylesheet and the generated one must describe the same design. */
const BRAND_REFERENCE_CHROMA = 0.162;

const RAMP: { token: string; l: number; chromaRatio: number }[] = [
  { token: "--brand-deep", l: 0.4, chromaRatio: 0.145 / BRAND_REFERENCE_CHROMA },
  { token: "--brand", l: 0.515, chromaRatio: 1 },
  // Deliberately LIGHTER than --brand: it is a fill (tabs, selected days,
  // hairlines), never text. See app.css's note.
  { token: "--brand-mid", l: 0.58, chromaRatio: 0.15 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-light", l: 0.75, chromaRatio: 0.1 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-pale", l: 0.955, chromaRatio: 0.02 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-faint", l: 0.983, chromaRatio: 0.008 / BRAND_REFERENCE_CHROMA },
];

/** The platform default, mirroring app.css and backend/internal/branding. */
export const DEFAULT_BRAND_COLOR = "#6054bf";

/* --- sRGB <-> OKLCH ---------------------------------------------------------
 *
 * Hand-rolled rather than pulled from a library: this is ~60 lines of
 * well-defined matrix maths, and the app has no colour dependency today
 * (package.json is next/react/react-dom/qrcode). Ottosson's OKLab transform.
 */

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function hexToOklch(hex: string): Oklch | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = srgbToLinear(((int >> 16) & 255) / 255);
  const g = srgbToLinear(((int >> 8) & 255) / 255);
  const b = srgbToLinear((int & 255) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const okL = 0.2104542553 * l + 0.793617785 * m_ - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m_ + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m_ - 0.808675766 * s;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  let hue = (Math.atan2(okB, okA) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { l: okL, c: chroma, h: hue };
}

/* oklchToRgb returns channels in 0..1 and a flag for whether the colour fell
 * outside sRGB before clamping — which is what gamutFit below uses to walk
 * chroma down instead of letting the browser clip unpredictably. */
function oklchToLinearRgb({ l, c, h }: Oklch): { r: number; g: number; b: number; inGamut: boolean } {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const bb = c * Math.sin(hr);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;

  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;

  const eps = 1e-4;
  const inGamut = [r, g, b].every((v) => v >= -eps && v <= 1 + eps);
  return { r, g, b, inGamut };
}

/* gamutFit reduces chroma until the colour fits in sRGB.
 *
 * app.css's header warns that above the gamut ceiling browsers gamut-map
 * differently and Chrome and Safari disagree — which would desync the hex
 * mirrors this file also produces for print. Binary search on chroma keeps
 * lightness and hue exact and gives one answer everywhere. */
function gamutFit(color: Oklch): Oklch {
  if (oklchToLinearRgb(color).inGamut) return color;
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (oklchToLinearRgb({ ...color, c: mid }).inGamut) lo = mid;
    else hi = mid;
  }
  return { ...color, c: lo };
}

export function oklchToHex(color: Oklch): string {
  const { r, g, b } = oklchToLinearRgb(gamutFit(color));
  const to255 = (v: number) => {
    const n = Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

export function oklchToCss({ l, c, h }: Oklch): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

/* --- The ramp --------------------------------------------------------------- */

export type BrandRamp = Record<string, Oklch>;

/**
 * deriveBrandRamp regenerates all six brand steps from one picked colour,
 * keeping its hue and scaling the reference chroma curve by how saturated the
 * pick actually is.
 *
 * A malformed or unparseable value falls back to the platform default rather
 * than throwing: this runs during first paint, and a bad stored colour must
 * degrade to the default theme, never to a blank app.
 */
export function deriveBrandRamp(hex: string): BrandRamp {
  const picked = hexToOklch(hex) ?? hexToOklch(DEFAULT_BRAND_COLOR)!;
  const ramp: BrandRamp = {};
  for (const step of RAMP) {
    ramp[step.token] = gamutFit({
      l: step.l,
      c: picked.c * step.chromaRatio,
      h: picked.h,
    });
  }
  // --brand is pinned to the EXACT picked colour (only gamut-fit, never
  // re-lightened) — not the RAMP table's l:0.515 for that step, which
  // normalises every business's pick to one fixed lightness regardless of
  // how light or dark the colour they actually chose is. A business that
  // picks a genuinely dark navy like #1a3e93 (L≈0.39) got a NOTICEABLY
  // lighter blue rendered as its "primary" everywhere — buttons, links,
  // headings — than the hex they entered, which was never actually
  // achievable through the UI at all: the default button/link colour
  // (.btn, --brand) simply never equalled what was typed for any colour
  // whose own lightness wasn't already 0.515. The rest of the ramp
  // (deep/mid/light/pale/faint) keeps deriving from the RAMP table as
  // before — those are supporting shades, not the colour itself, and are
  // fine to land at their own designed lightness steps.
  ramp["--brand"] = gamutFit(picked);
  return ramp;
}

/** The six steps as hex — for the surfaces that cannot read a CSS variable. */
export function brandRampHex(hex: string): Record<string, string> {
  const ramp = deriveBrandRamp(hex);
  const out: Record<string, string> = {};
  for (const [token, color] of Object.entries(ramp)) out[token] = oklchToHex(color);
  return out;
}

/* --- Second/third colours ---------------------------------------------------
 *
 * Most businesses only ever set BrandColor and get one ramp. A minority need
 * 2-3 coordinated colours (their mark genuinely uses more than tints of one
 * hue) — SecondaryColor/AccentColor exist for exactly that case, and are
 * OPTIONAL: unset means "don't emit these variables at all", not "derive one
 * from the primary colour". `deriveNamedRamp` is deriveBrandRamp generalised
 * to write under an arbitrary token prefix, so the same OKLCH curve/gamut-fit
 * logic produces the --brand2 and --brand3 step variables exactly the way it
 * produces the --brand ones.
 */

const RAMP_SUFFIXES = ["deep", "", "mid", "light", "pale", "faint"] as const;

/** deriveNamedRamp, e.g. prefix "--brand2" -> --brand2-deep/--brand2/--brand2-mid/... */
function deriveNamedRamp(hex: string, prefix: string): BrandRamp {
  const ramp = deriveBrandRamp(hex);
  const out: BrandRamp = {};
  const brandTokens = Object.keys(ramp); // in RAMP's declared order
  brandTokens.forEach((token, i) => {
    const suffix = RAMP_SUFFIXES[i];
    out[suffix ? `${prefix}-${suffix}` : prefix] = ramp[token];
  });
  return out;
}

function applyNamedRamp(root: CSSStyleDeclaration, hex: string, prefix: string): void {
  const ramp = deriveNamedRamp(hex, prefix);
  for (const [token, color] of Object.entries(ramp)) root.setProperty(token, oklchToCss(color));
}

function clearNamedRamp(root: CSSStyleDeclaration, prefix: string): void {
  for (const suffix of RAMP_SUFFIXES) root.removeProperty(suffix ? `${prefix}-${suffix}` : prefix);
}

/* --- Fonts -------------------------------------------------------------------
 *
 * FontFamily is chosen from a FIXED allow-list, never free text: the value
 * comes from the backend (also validated against a closed set — see
 * backend/internal/superadmin/profile.go's knownFontFamilies) and is written
 * straight into a CSS custom property, so an arbitrary string here would be
 * a way to inject CSS, not just a typo. Keep this list in the same order and
 * with the same keys as the backend's.
 */
export const FONT_FAMILIES: Record<string, string> = {
  inter: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  system: '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
  lora: '"Lora", Georgia, "Times New Roman", serif',
  poppins: '"Poppins", system-ui, -apple-system, "Segoe UI", sans-serif',
};
export const DEFAULT_FONT_FAMILY = "inter";

/** Base font-size multiplier per scale preset, applied as --brand-font-scale. */
export const FONT_SCALES: Record<string, number> = {
  compact: 0.9375, // ~15px base if the page's default is 16px
  default: 1,
  comfortable: 1.0625,
};
export const DEFAULT_FONT_SCALE = "default";

/* --- Logo slot ---------------------------------------------------------------
 *
 * LogoScale/LogoDisplay never touch a CSS variable that other rules already
 * key off of — they're consumed directly by BrandLogo.tsx — but the presets
 * live here so the frontend and backend (profile.go's knownLogoScales/
 * knownLogoDisplays) enumerate the exact same closed sets in one place each.
 */
/* Range widened from an earlier {small,default,large} capped at 1.25: a real
 * reference tenant's sidebar logo was hand-set to 80px against this app's
 * 48px base slot — a 1.67x multiplier "large" could not reach at all, which
 * would have made exact visual parity with that tenant impossible from this
 * dropdown no matter what the operator picked. */
export const LOGO_SCALES: Record<string, number> = {
  small: 0.75,
  default: 1,
  large: 1.35,
  xlarge: 1.7,
};
export const DEFAULT_LOGO_SCALE = "default";
export const LOGO_DISPLAYS = ["transparent", "light-pad", "dark-pad"] as const;
export type LogoDisplay = (typeof LOGO_DISPLAYS)[number];
export const DEFAULT_LOGO_DISPLAY: LogoDisplay = "transparent";


/* The two decorations whose colour lives INSIDE a data-URI SVG, where CSS
 * cannot interpolate a variable — see the --page-pattern/--select-caret
 * block in app/app/app.css. Rebuilt here with the derived hex so they track
 * the business's colour like everything else.
 *
 * The `#` must be percent-encoded as %23 inside a data URI; leaving it raw
 * silently truncates the URL at the fragment and the image disappears. */
function pagePatternURI(hex: string): string {
  const c = encodeURIComponent(hex); // "#" becomes "%23"
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='${c}' stroke-width='0.5' opacity='0.035'%3E%3Cpath d='M60 8 L112 60 L60 112 L8 60 Z'/%3E%3Ccircle cx='60' cy='60' r='14'/%3E%3C/g%3E%3C/svg%3E")`;
}

function selectCaretURI(hex: string): string {
  const c = encodeURIComponent(hex);
  return `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='${c}' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
}
/** Everything applyBrandTheme can set. Every field is optional except the
 * primary colour, matching how little a business is required to configure. */
export type BrandTheme = {
  primary?: string | null;
  secondary?: string | null;
  fontFamily?: string | null;
  fontScale?: string | null;
};

/**
 * applyBrandTheme writes the ramp(s), font variables onto the document root,
 * where all 115 `var(--brand*)` consumers in app.css and login.css pick up
 * --brand* immediately. login.css's `color-mix(in oklab, var(--brand) ...)`
 * focus rings follow for free, since they are expressed in terms of the
 * variable rather than a literal.
 *
 * Accepts either a bare hex string (the pre-existing call shape, kept so
 * every caller that only ever set one colour does not need to change) or a
 * full BrandTheme. secondary is OPTIONAL: omitting it clears the --brand2
 * step variables rather than deriving a guess, so CSS that only reads the
 * plain --brand variables is completely unaffected by a business that has
 * not set it.
 *
 * Safe to call before React mounts, and safe to call repeatedly.
 */
export function applyBrandTheme(theme: string | null | undefined | BrandTheme): void {
  if (typeof document === "undefined") return;
  const t: BrandTheme = typeof theme === "string" || theme == null ? { primary: theme } : theme;
  const root = document.documentElement;
  const ramp = deriveBrandRamp(t.primary || DEFAULT_BRAND_COLOR);
  for (const [token, color] of Object.entries(ramp)) {
    root.style.setProperty(token, oklchToCss(color));
  }
  // The two data-URI decorations, which cannot read a variable from inside
  // the SVG and so are regenerated whole.
  const brandHex = oklchToHex(ramp["--brand"]);
  root.style.setProperty("--page-pattern", pagePatternURI(brandHex));
  root.style.setProperty("--select-caret", selectCaretURI(brandHex));

  // --nav/--nav-2 (the sidebar/login-panel/toast dark ground) were a FIXED
  // near-black in :root, never touched by applyBrandTheme at all — so a
  // tenant's colour changed buttons/links/fills but the sidebar itself
  // stayed the same near-black for every business.
  //
  // Deliberately NOT its own 3rd colour picker in the console — two pickers
  // (primary/secondary) already exist and a 3rd "sidebar colour" duplicated
  // what secondary is for, without a documented reason to pick one over the
  // other. So NOTHING here reads `t.sidebarColor` — a dedicated field
  // briefly existed, got exposed in the console, and was then removed in
  // favour of secondary; a business that happened to set it during that
  // window would otherwise have that invisible, no-longer-editable value
  // silently keep overriding a correctly-set secondary colour forever,
  // which is exactly the bug this comment used to describe as a *feature*
  // ("still supported... just not exposed") before it actually bit a real
  // tenant. In priority order now:
  //   1. secondary set — the sidebar/login panel IS what "a second
  //      coordinated colour" is for in this product: most real brands (the
  //      CTFI-style reference this was checked against included) use a
  //      second colour for exactly this dark ground, distinct from the
  //      primary (buttons/links).
  //   2. unset — auto-derived from the primary colour's own hue, calibrated
  //      against a real hand-picked reference navy (#0e2050 converted to
  //      OKLCH: L≈0.26 C≈0.091 h≈265) so a business that has set only a
  //      primary colour still gets a plausible tinted dark ground rather
  //      than flat black.
  //
  // --nav-2 is a step LIGHTER than --nav (not equal, as an earlier flat
  // version had it) — matching the reference's own subtle top-to-bottom
  // sidebar gradient (its --nav-2 is measurably lighter than --nav), applied
  // automatically from whichever colour --nav itself resolved to, so this
  // never needs its own separate setting either.
  const primaryOklch = hexToOklch(t.primary || DEFAULT_BRAND_COLOR) ?? hexToOklch(DEFAULT_BRAND_COLOR)!;
  const sidebarSourceOklch = t.secondary ? hexToOklch(t.secondary) : null;
  const navOklch = sidebarSourceOklch
    ? gamutFit(sidebarSourceOklch)
    : gamutFit({ l: 0.22, c: Math.min(primaryOklch.c * 0.65, 0.11), h: primaryOklch.h });
  const nav2Oklch = gamutFit({ l: navOklch.l + 0.07, c: navOklch.c * 1.2, h: navOklch.h });
  root.style.setProperty("--nav", oklchToCss(navOklch));
  root.style.setProperty("--nav-2", oklchToCss(nav2Oklch));

  // --nav-label — the sidebar's section headings ("OVERVIEW", "LENDING",
  // etc.). Was a flat oklch(0.95 0.006 290 / 50%) — a near-white at low
  // opacity, completely independent of any tenant's colour, which reads as
  // a generic "faded white" rather than the reference's actual technique:
  // its label colour (#55637d) is a MUTED, MID-lightness step of the SAME
  // hue as its own primary colour (~262° for both), not white-at-an-alpha
  // at all. Calibrated against that real value (L≈0.50, C≈0.045 on the
  // primary's own hue) so the "faded" look tracks whatever colour a
  // business has actually picked instead of looking the same for everyone.
  const navLabelOklch = gamutFit({ l: 0.55, c: Math.min(primaryOklch.c * 0.3, 0.05), h: primaryOklch.h });
  root.style.setProperty("--nav-label", oklchToCss(navLabelOklch));

  if (t.secondary) applyNamedRamp(root.style, t.secondary, "--brand2");
  else clearNamedRamp(root.style, "--brand2");

  // --brand-gradient is the login panel's small divider line (app/login.css's
  // .bp-rule) — its only remaining consumer now that the sidebar's own top
  // rail and the login panel's hardcoded glow-orb wash have both been
  // removed. No longer reads a 3rd "accent" colour at all: that field had
  // exactly one visible use in the whole product (this gradient) and
  // nothing else, so asking every business to pick a 3rd colour for one
  // small divider line wasn't worth the confusion — see PRIMARY/SECONDARY
  // colour, which cover buttons/links and the sidebar/login background
  // respectively. Just those two now: primary's own deep step fading to
  // secondary (or, with no secondary set, to primary's own light step).
  const secondOklch = t.secondary ? hexToOklch(t.secondary) : null;
  const stop0 = oklchToCss(ramp["--brand-deep"]);
  const stop1 = secondOklch ? oklchToCss(gamutFit(secondOklch)) : oklchToCss(ramp["--brand-light"]);
  root.style.setProperty("--brand-gradient", `linear-gradient(135deg, ${stop0} 0%, ${stop1} 100%)`);

  const fontFamily = FONT_FAMILIES[t.fontFamily || ""] || FONT_FAMILIES[DEFAULT_FONT_FAMILY];
  root.style.setProperty("--brand-font-family", fontFamily);
  const fontScale = FONT_SCALES[t.fontScale || ""] ?? FONT_SCALES[DEFAULT_FONT_SCALE];
  root.style.setProperty("--brand-font-scale", String(fontScale));
}

/* applyFavicon swaps the browser tab icon to a business's own logo.
 *
 * Next's static export bakes app/icon.png into the HTML <link rel="icon">
 * at build time — there's no per-request way to vary it server-side, same
 * constraint applyBrandTheme's own header explains for colour. This is the
 * runtime equivalent: called from the same two places BrandingProvider
 * calls applyBrandTheme.
 *
 * logoUrl empty (business has no logo of its own) is a no-op, not a clear —
 * it leaves whatever icon is already showing (the platform default on first
 * paint) rather than ever pointing the tab at a broken/empty href.
 *
 * Browsers cache favicons aggressively per ORIGIN, not per page state, so a
 * tenant switch on an already-open tab may not visibly update the tab icon
 * until a hard reload. That is a browser limitation to note, not a bug to
 * chase further here.
 */
export function applyFavicon(logoUrl: string | null | undefined): void {
  if (typeof document === "undefined" || !logoUrl) return;
  // Removing and re-inserting the <link>, not mutating .href in place:
  // several browsers only re-fetch a favicon when the element is inserted
  // into the document, not on an attribute change to an existing one — a
  // same-element href swap can silently keep showing the old icon
  // indefinitely, which is exactly the "stuck on the platform icon" failure
  // mode this exists to avoid. Next's static export may have baked in more
  // than one <link rel="icon"> (different sizes) — remove all of them so
  // the browser has exactly one to choose from, unambiguously the tenant's.
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((el) => el.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = logoUrl;
  document.head.appendChild(link);
}

/* applyDocumentTitle is applyFavicon's counterpart for the browser TAB TEXT
 * — same problem (a build-time static value, `app/layout.tsx`'s Metadata
 * `title`, baked once for every tenant), same fix (set it at runtime once a
 * tenant's own name is known). Unlike the favicon, `document.title` has no
 * browser-caching quirk to work around — a plain assignment always takes
 * effect immediately. */
export function applyDocumentTitle(businessName: string | null | undefined): void {
  if (typeof document === "undefined" || !businessName) return;
  document.title = businessName;
}

/** Cached alongside the theme, for the SAME reason as the colour: a static
 * export's first paint happens before any fetch can return, and without a
 * cached value to replay the tab briefly (or, on a slow connection, not so
 * briefly) shows the platform title instead of the signed-in business's own
 * — see brand-preload.tsx, which reads this synchronously before hydration. */
export const BRAND_TITLE_KEY_PREFIX = "cloudhouse_brand_title::";

export function cacheDocumentTitle(slug: string | null, businessName: string): void {
  if (typeof window === "undefined" || !businessName) return;
  try {
    window.localStorage.setItem(BRAND_TITLE_KEY_PREFIX + (slug || "default"), businessName);
  } catch {
    /* Private mode / storage disabled */
  }
}

/* --- Pre-paint cache --------------------------------------------------------
 *
 * next.config.ts sets output: "export", so there is no server render to inject
 * the colour into — the first paint happens before any fetch can return. The
 * colour is therefore cached per business slug and replayed by a tiny blocking
 * script in app/layout.tsx, exactly like tenantSession.ts keys sessions per
 * slug so two businesses in two tabs cannot clobber each other.
 */

export const BRAND_COLOR_KEY_PREFIX = "cloudhouse_brand::";

/** Kept for callers that only ever cared about the primary colour. */
export function cacheBrandColor(slug: string | null, hex: string): void {
  cacheBrandTheme(slug, { primary: hex });
}

export function readCachedBrandColor(slug: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BRAND_COLOR_KEY_PREFIX + (slug || "default"));
  } catch {
    return null;
  }
}

/** Full-theme cache, alongside the plain-hex key above (same key: readers of
 * the old plain-string value still get a valid hex, since JSON.parse on a
 * bare "#rrggbb" string throws and readCachedBrandTheme falls back to
 * readCachedBrandColor for exactly that transition case). */
export const BRAND_THEME_KEY_PREFIX = "cloudhouse_brand_theme::";

export function cacheBrandTheme(slug: string | null, theme: BrandTheme): void {
  if (typeof window === "undefined") return;
  try {
    if (theme.primary) {
      window.localStorage.setItem(BRAND_COLOR_KEY_PREFIX + (slug || "default"), theme.primary);
    }
    window.localStorage.setItem(BRAND_THEME_KEY_PREFIX + (slug || "default"), JSON.stringify(theme));
  } catch {
    /* Private mode / storage disabled — the theme still applies for this
     * page load, it just flashes the default on the next one. */
  }
}

export function readCachedBrandTheme(slug: string | null): BrandTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRAND_THEME_KEY_PREFIX + (slug || "default"));
    if (raw) return JSON.parse(raw) as BrandTheme;
  } catch {
    /* fall through to the plain-colour cache below */
  }
  const hex = readCachedBrandColor(slug);
  return hex ? { primary: hex } : null;
}
