/* Per-business theming — one picked colour drives the whole brand ramp.
 *
 * WHY THIS EXISTS. The `:root` block in common/styles/app.css defines six brand
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
/* Each choice leads with the font the app actually LOADS. next/font registers
 * a self-hosted face under a generated name, exposed only through its CSS
 * variable (app/(product)/layout.tsx), so a bare "Inter" or "Poppins" here
 * matched nothing and fell through to the system font — Inter and Poppins
 * looked identical to System. The quoted name after each var() is only the
 * fallback for a page where the variable is not defined. */
export const FONT_FAMILIES: Record<string, string> = {
  inter: 'var(--font-sans, "Inter"), system-ui, -apple-system, "Segoe UI", sans-serif',
  system: '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
  lora: 'var(--font-lora, "Lora"), Georgia, "Times New Roman", serif',
  poppins: 'var(--font-poppins, "Poppins"), system-ui, -apple-system, "Segoe UI", sans-serif',
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
 * block in common/styles/app.css. Rebuilt here with the derived hex so they track
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
  /** Text on the sidebar ground; empty = automatic (see autoTextColor). */
  navText?: string | null;
  /** Text on primary-colour fills; empty = automatic. */
  onBrandText?: string | null;
};

/* --- Text colours on the brand grounds ----------------------------------------
 *
 * Sidebar and button text used to be hardcoded white. That is right for the
 * dark grounds most businesses pick, and unreadable on the light secondary
 * colour some logos need. So the text colour is now a setting, and its
 * automatic value follows one rule: white, unless white would fail WCAG AA
 * (4.5:1) on that ground AND a dark ink of the ground's own hue reads better.
 * A vendor-picked colour always wins over the rule.
 *
 * The superadmin console's live preview calls these same functions, so what
 * the vendor sees while editing is exactly what the business's app renders.
 */
const AA_CONTRAST = 4.5;

function hexLuminance(hex: string): number {
  const rgb = parseHexColor(hex) ?? [0, 0, 0];
  return relativeLuminance(...rgb);
}

/** WCAG contrast ratio between two "#rrggbb" colours (1–21). */
export function hexContrast(a: string, b: string): number {
  return contrastRatio(hexLuminance(a), hexLuminance(b));
}

/** A dark ink on a colour's own hue — text that reads on that colour when it is light. */
export function inkFor(hex: string): string {
  const c = hexToOklch(hex) ?? hexToOklch(DEFAULT_BRAND_COLOR)!;
  return oklchToHex({ l: 0.24, c: Math.min(c.c, 0.06), h: c.h });
}

/** The automatic text colour for a ground: white, or a dark ink when white would not read. */
export function autoTextColor(bgHex: string): string {
  const white = hexContrast("#ffffff", bgHex);
  if (white >= AA_CONTRAST) return "#ffffff";
  const ink = inkFor(bgHex);
  return hexContrast(ink, bgHex) > white ? ink : "#ffffff";
}

/* The sidebar ground: the secondary colour when set, otherwise a dark shade on
 * the primary's own hue (calibrated against a real hand-picked navy, #0e2050:
 * L≈0.26 C≈0.091). One function so the app and the console preview agree. */
function navOklchFor(primary: string, secondary: string | null | undefined): Oklch {
  const primaryOklch = hexToOklch(primary || DEFAULT_BRAND_COLOR) ?? hexToOklch(DEFAULT_BRAND_COLOR)!;
  const sidebarSourceOklch = secondary ? hexToOklch(secondary) : null;
  return sidebarSourceOklch
    ? gamutFit(sidebarSourceOklch)
    : gamutFit({ l: 0.22, c: Math.min(primaryOklch.c * 0.65, 0.11), h: primaryOklch.h });
}

/* The second gradient stop: a step LIGHTER than a dark ground (the reference
 * sidebar's own subtle top-to-bottom gradient), but a step DARKER than a light
 * one — lightening an already-light ground just clips to white. */
function nav2OklchFor(nav: Oklch): Oklch {
  return nav.l > 0.6
    ? gamutFit({ l: nav.l - 0.03, c: nav.c, h: nav.h })
    : gamutFit({ l: nav.l + 0.07, c: nav.c * 1.2, h: nav.h });
}

export type BrandColors = {
  /** The --brand colour as hex (the exact pick, gamut-fitted). */
  brand: string;
  /** Sidebar / login-panel ground, and its gradient partner. */
  nav: string;
  nav2: string;
  /** Text on the nav ground. */
  navFg: string;
  /** Text on --brand fills. */
  onBrand: string;
  /** --nav as a text colour on white pages — never pale. */
  navInk: string;
};

/** Resolves every colour a theme puts on screen, as hex. Pure: no DOM. */
export function resolveBrandColors(t: BrandTheme): BrandColors {
  const brand = oklchToHex(deriveBrandRamp(t.primary || DEFAULT_BRAND_COLOR)["--brand"]);
  const navOklch = navOklchFor(t.primary || DEFAULT_BRAND_COLOR, t.secondary);
  const nav = oklchToHex(navOklch);
  const valid = (v: string | null | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : "");
  return {
    brand,
    nav,
    nav2: oklchToHex(nav2OklchFor(navOklch)),
    navFg: valid(t.navText) || autoTextColor(nav),
    onBrand: valid(t.onBrandText) || autoTextColor(brand),
    navInk: navOklch.l <= 0.45 ? nav : oklchToHex({ l: 0.25, c: Math.min(navOklch.c, 0.08), h: navOklch.h }),
  };
}

/** The CSS variables a theme sets that the console preview also needs, scoped
 * to an element instead of the document. */
export function brandPreviewVars(t: BrandTheme): Record<string, string> {
  const c = resolveBrandColors(t);
  return {
    "--brand": c.brand,
    "--nav": c.nav,
    "--nav-2": c.nav2,
    "--nav-fg": c.navFg,
    "--on-brand": c.onBrand,
    "--nav-ink": c.navInk,
  };
}

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
  const navOklch = navOklchFor(t.primary || DEFAULT_BRAND_COLOR, t.secondary);
  root.style.setProperty("--nav", oklchToCss(navOklch));
  root.style.setProperty("--nav-2", oklchToCss(nav2OklchFor(navOklch)));

  // Text on those grounds — see resolveBrandColors. Set every time (never
  // left over from a previous business), since a light sidebar with white
  // text is unreadable.
  const colors = resolveBrandColors(t);
  root.style.setProperty("--nav-fg", colors.navFg);
  root.style.setProperty("--on-brand", colors.onBrand);
  root.style.setProperty("--nav-ink", colors.navInk);

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

  // --brand-gradient is the login panel's small divider line (common/styles/login.css's
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

/* applyFavicon installs an icon as the browser tab icon, and keeps it there.
 *
 * Next's static export would bake one icon into every page's HTML at build
 * time — there's no per-request way to vary it server-side, same constraint
 * applyBrandTheme's own header explains for colour. So app/(product)/layout.tsx ships NO
 * icon in its metadata at all, brand-preload.tsx inserts the one icon link
 * before first paint, and this is the runtime equivalent. Callers should
 * normally go through applyBrandFavicon below, which turns a business's raw
 * logo into an icon that is actually visible at tab size.
 *
 * An empty href is a no-op, not a clear — it leaves whatever icon is already
 * showing rather than ever pointing the tab at a broken/empty href.
 *
 * LATCHED, like applyDocumentTitle and for the same reason: anything else that
 * inserts a <link rel="icon"> after ours (a metadata commit, a library, a
 * future layout) would win, because browsers use the LAST icon in tree order.
 * That race is what made the tab icon randomly blank on some loads. A
 * MutationObserver re-appends ours whenever it is no longer the last icon.
 */
let latchedFavicon: string | null = null;
let faviconObserver: MutationObserver | null = null;

function faviconIsCurrent(): boolean {
  const icons = document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
  const last = icons[icons.length - 1];
  return !!last && last.hasAttribute("data-brand-icon") && last.getAttribute("href") === latchedFavicon;
}

function insertFavicon(href: string): void {
  // Removing and re-inserting the <link>, not mutating .href in place:
  // several browsers only re-fetch a favicon when the element is inserted
  // into the document, not on an attribute change to an existing one.
  //
  // Only OUR link (data-brand-icon) is ever removed. Any other icon link is
  // left alone — if React owns it, removing it behind React's back makes
  // React's own later removal crash with "Cannot read properties of null
  // (reading 'removeChild')". Ours being last is enough.
  document.querySelectorAll<HTMLLinkElement>("link[data-brand-icon]").forEach((el) => el.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = href;
  link.setAttribute("data-brand-icon", "");
  document.head.appendChild(link);
}

function watchFavicon(): void {
  if (faviconObserver || typeof MutationObserver === "undefined") return;
  faviconObserver = new MutationObserver(() => {
    if (latchedFavicon && !faviconIsCurrent()) insertFavicon(latchedFavicon);
  });
  faviconObserver.observe(document.head, { childList: true });
}

export function applyFavicon(href: string | null | undefined): void {
  if (typeof document === "undefined" || !href) return;
  latchedFavicon = href;
  if (!faviconIsCurrent()) insertFavicon(href);
  watchFavicon();
}

/* --- Tab icon from an arbitrary logo -----------------------------------------
 *
 * A business uploads whatever logo it has: a JPEG with a solid background, a
 * transparent PNG with white artwork meant for a dark header, a wide wordmark,
 * a 4000px original. Used raw as a favicon, many of those are INVISIBLE at
 * 16px — white artwork on a transparent background disappears into a light
 * tab strip, and a wide wordmark shrinks to a hairline. That, not the
 * fetching, is why some businesses appeared to have no tab icon.
 *
 * So the tab never gets the raw upload. buildFavicon normalises ANY logo into
 * a small square PNG, deciding everything from the pixels themselves:
 *
 *   - transparent margins are trimmed, so the mark fills the icon;
 *   - the result is contain-fitted into a square, whatever the aspect ratio;
 *   - the logo is never put on a background: opaque logos carry their own,
 *     transparent ones stay transparent;
 *   - only artwork that would vanish into a light or dark tab strip (measured
 *     luminance, not guessed) gets a thin outline following its own shape;
 *   - no logo, or one that will not load, becomes the business's initials on
 *     its brand colour. Never blank.
 */
const FAVICON_SIZE = 64;
/** Part of the cache key — bump when the drawing below changes. */
const FAVICON_VERSION = "3";
/** Below this share of transparent pixels a logo counts as opaque. */
const FAVICON_OPAQUE_RATIO = 0.05;
/* Typical browser tab strips, light and dark theme (Chrome's #dee1e6 and
 * #35363a), as relative luminance. A pixel at least FAVICON_PIXEL_CONTRAST
 * against a strip shows on it; a logo with less than FAVICON_VISIBLE_SHARE of
 * its artwork showing is effectively invisible there and gets an outline.
 *
 * A SHARE, not an average: a logo with a white fill and blue detail averages
 * out "light", yet its blue reads perfectly on a light tab and needs nothing. */
const FAVICON_LIGHT_TAB_LUM = 0.75;
const FAVICON_DARK_TAB_LUM = 0.036;
const FAVICON_PIXEL_CONTRAST = 2;
const FAVICON_VISIBLE_SHARE = 0.2;
/** Outline thickness in icon pixels (of 64) — about 0.5px at 16px. */
const FAVICON_OUTLINE = 2;
const FAVICON_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function roundedTile(ctx: CanvasRenderingContext2D, color: string): void {
  const r = FAVICON_SIZE * 0.2;
  const s = FAVICON_SIZE;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(s, 0, s, s, r);
  ctx.arcTo(s, s, 0, s, r);
  ctx.arcTo(0, s, 0, 0, r);
  ctx.arcTo(0, 0, s, 0, r);
  ctx.closePath();
  ctx.fill();
}

function loadImage(src: string, anonymous: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (anonymous) img.crossOrigin = "anonymous";
    img.onload = () => (img.naturalWidth && img.naturalHeight ? resolve(img) : reject(new Error("empty image")));
    img.onerror = () => reject(new Error("logo failed to load"));
    img.src = src;
  });
}

function newCanvas(w: number, h: number): CanvasRenderingContext2D | null {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d", { willReadFrequently: true });
}

/** Up to two initials: "AJ Finance" → "AF", "Ambika" → "A". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase();
}

/* text is the exact letters to draw (already chosen by the caller), up to 3. */
function monogramFavicon(brandColor: string, text: string): string | null {
  const ctx = newCanvas(FAVICON_SIZE, FAVICON_SIZE);
  if (!ctx) return null;
  const rgb = parseHexColor(brandColor) ?? parseHexColor(DEFAULT_BRAND_COLOR)!;
  const tileLum = relativeLuminance(...rgb);
  roundedTile(ctx, `rgb(${rgb.join(",")})`);
  if (text) {
    // White or near-black letters, whichever reads better on this colour.
    ctx.fillStyle = contrastRatio(tileLum, 1) >= contrastRatio(tileLum, relativeLuminance(17, 17, 17)) ? "#fff" : "#111";
    ctx.font = `700 ${text.length > 2 ? 21 : text.length > 1 ? 28 : 38}px ${FAVICON_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, FAVICON_SIZE / 2, FAVICON_SIZE / 2 + 2);
  }
  return ctx.canvas.toDataURL("image/png");
}

/* logoFavicon analyses and redraws a loaded logo. Throws if the canvas is
 * tainted (a cross-origin logo without CORS), which the caller handles. */
function logoFavicon(img: HTMLImageElement): string | null {
  // Analyse at a bounded size: a 4000px original costs the same as a 256px one.
  const scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
  const aw = Math.max(1, Math.round(img.naturalWidth * scale));
  const ah = Math.max(1, Math.round(img.naturalHeight * scale));
  const actx = newCanvas(aw, ah);
  if (!actx) return null;
  actx.drawImage(img, 0, 0, aw, ah);
  const px = actx.getImageData(0, 0, aw, ah).data;

  let transparent = 0;
  let art = 0;
  let showsOnLight = 0;
  let showsOnDark = 0;
  let minX = aw, minY = ah, maxX = -1, maxY = -1;
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = (y * aw + x) * 4;
      const a = px[i + 3];
      if (a < 24) {
        transparent++;
        continue;
      }
      const lum = relativeLuminance(px[i], px[i + 1], px[i + 2]);
      art++;
      if (contrastRatio(lum, FAVICON_LIGHT_TAB_LUM) >= FAVICON_PIXEL_CONTRAST) showsOnLight++;
      if (contrastRatio(lum, FAVICON_DARK_TAB_LUM) >= FAVICON_PIXEL_CONTRAST) showsOnDark++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Fully transparent: nothing to draw.
  if (maxX < 0) return null;

  const opaque = transparent / (aw * ah) < FAVICON_OPAQUE_RATIO;
  const ctx = newCanvas(FAVICON_SIZE, FAVICON_SIZE);
  if (!ctx) return null;

  // Trim to the visible artwork (in source pixels), then contain-fit it.
  const sx = minX / scale;
  const sy = minY / scale;
  const sw = (maxX - minX + 1) / scale;
  const sh = (maxY - minY + 1) / scale;
  // A transparent logo keeps a hair of room for the outline below.
  const pad = opaque ? 0 : FAVICON_OUTLINE + 1;
  const box = FAVICON_SIZE - pad * 2;
  const fit = Math.min(box / sw, box / sh);
  const dw = sw * fit;
  const dh = sh * fit;
  const dx = (FAVICON_SIZE - dw) / 2;
  const dy = (FAVICON_SIZE - dh) / 2;
  const draw = (target: CanvasRenderingContext2D, ox = 0, oy = 0) => {
    target.imageSmoothingQuality = "high";
    target.drawImage(img, sx, sy, sw, sh, dx + ox, dy + oy, dw, dh);
  };

  /* No background, ever — the logo is shown as the business made it. Only
   * when the artwork would vanish into a tab strip (white artwork on a light
   * strip, black artwork on a dark one) does it get a thin OUTLINE following
   * its own shape, dark for a light strip and light for a dark one. A logo
   * with enough visible detail on both strips gets nothing. */
  if (!opaque) {
    const outline =
      showsOnLight / art < FAVICON_VISIBLE_SHARE
        ? "rgba(0,0,0,0.85)"
        : showsOnDark / art < FAVICON_VISIBLE_SHARE
          ? "rgba(255,255,255,0.9)"
          : "";
    if (outline) {
      // The logo's silhouette in the outline colour, stamped around it.
      const sil = newCanvas(FAVICON_SIZE, FAVICON_SIZE);
      if (sil) {
        draw(sil);
        sil.globalCompositeOperation = "source-in";
        sil.fillStyle = outline;
        sil.fillRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
        const o = FAVICON_OUTLINE;
        for (const [ox, oy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]]) {
          ctx.drawImage(sil.canvas, ox, oy);
        }
      }
    }
  }
  draw(ctx);
  return ctx.canvas.toDataURL("image/png");
}

/* buildFavicon returns an icon href for a business: a normalised PNG data URL
 * whenever the browser allows it. Never throws. Falls back to the raw logo URL
 * only when the logo loads but cannot be read (a cross-origin logo without
 * CORS) — exactly the pre-normalisation behaviour, so this never does worse. */
export type FaviconSource = {
  logoUrl: string;
  brandColor: string;
  name: string;
  /** Letters to draw instead of the logo — set when the logo is WIDE, since a
   * wordmark shrunk to 16px is an unreadable smear. Up to 3 characters. */
  monogram?: string;
};

export async function buildFavicon(opts: FaviconSource): Promise<string | null> {
  if (typeof document === "undefined") return null;
  if (opts.logoUrl && !opts.monogram) {
    let img: HTMLImageElement | null = null;
    let readable = true;
    try {
      img = await loadImage(opts.logoUrl, true);
    } catch {
      try {
        img = await loadImage(opts.logoUrl, false);
        readable = false;
      } catch {
        img = null;
      }
    }
    if (img) {
      if (!readable) return opts.logoUrl;
      try {
        const icon = logoFavicon(img);
        if (icon) return icon;
      } catch {
        return opts.logoUrl;
      }
    }
  }
  try {
    return monogramFavicon(opts.brandColor, opts.monogram || initialsOf(opts.name));
  } catch {
    return opts.logoUrl || null;
  }
}

/* Pre-paint cache of the GENERATED icon, per slug — read synchronously by
 * brand-preload.tsx, so a reload shows the business's icon on the first frame
 * without waiting for a fetch or a canvas. `src` records what it was built
 * from; a replaced logo, a new colour or a renamed business rebuilds it. */
export const BRAND_FAVICON_KEY_PREFIX = "cloudhouse_brand_favicon::";

type CachedFavicon = { src: string; icon: string };

function readCachedFavicon(slug: string | null): CachedFavicon | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRAND_FAVICON_KEY_PREFIX + (slug || "default"));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CachedFavicon>;
    return typeof v.src === "string" && typeof v.icon === "string" && v.icon ? (v as CachedFavicon) : null;
  } catch {
    return null;
  }
}

/** Re-shows the cached icon for a business, if any. True when one was applied. */
export function applyCachedFavicon(slug: string | null): boolean {
  const cached = readCachedFavicon(slug);
  if (!cached) return false;
  applyFavicon(cached.icon);
  return true;
}

let faviconBuildSeq = 0;

/* applyBrandFavicon is what BrandingProvider calls once a business's branding
 * is known: build (or reuse) the normalised icon, show it, cache it. */
export async function applyBrandFavicon(
  slug: string | null,
  brand: FaviconSource
): Promise<void> {
  if (typeof window === "undefined") return;
  // Nothing to build from yet — keep whatever is showing.
  if (!brand.logoUrl && !brand.name) return;
  // FAVICON_VERSION first: bumping it rebuilds every cached icon after a
  // change to how icons are drawn.
  const src = [FAVICON_VERSION, brand.logoUrl, brand.brandColor, brand.name, brand.monogram || ""].join("|");
  const cached = readCachedFavicon(slug);
  if (cached && cached.src === src) {
    applyFavicon(cached.icon);
    return;
  }
  // A later call supersedes this one; drop a stale result.
  const seq = ++faviconBuildSeq;
  const icon = await buildFavicon(brand);
  if (seq !== faviconBuildSeq || !icon) return;
  applyFavicon(icon);
  try {
    window.localStorage.setItem(BRAND_FAVICON_KEY_PREFIX + (slug || "default"), JSON.stringify({ src, icon }));
  } catch {
    /* Private mode / storage full — the icon still applies for this load */
  }
}

/* applyDocumentTitle is applyFavicon's counterpart for the browser TAB TEXT
 * — same problem (a build-time static value, `app/(product)/layout.tsx`'s Metadata
 * `title`, baked once for every tenant), same fix (set it at runtime once a
 * tenant's own name is known).
 *
 * WHY A PLAIN ASSIGNMENT IS NOT ENOUGH. It used to be one, on the reasoning
 * that document.title has no caching quirk to work around. It does not — but
 * it has a competitor. Next's App Router does not render <Metadata> together
 * with the page: it resolves it in a separate, suspended branch of the tree
 * that commits whenever it is ready, which may be BEFORE or AFTER this
 * function runs on any given load. When it commits last it writes the neutral
 * "Loading…" back over the business's real name, and nothing re-runs to
 * correct it — the "tab stuck on Loading…, fixed by a refresh, broken again
 * by the next one" symptom, random precisely because it is a race. React then
 * believes the title element already says "Loading…", so later renders are
 * no-ops and it never self-corrects. That same commit is also what briefly
 * empties the title, which is when the browser falls back to showing the raw
 * URL — the "tab says localhost:3000" half of the report.
 *
 * So the tenant's title is LATCHED: assigned, then re-asserted by a
 * MutationObserver any time anything else changes it. The observer is
 * installed once and watches only the <title> element, so the cost is a
 * handful of callbacks over the page's life.
 *
 * The latch is deliberately one-directional: only a later applyDocumentTitle
 * call (real branding arriving, or the navigation re-assert in
 * BrandingProvider) changes what is held. An empty name is a no-op, not a
 * release — an empty document.title is the URL-in-the-tab bug itself.
 */
let latchedTitle: string | null = null;
let titleObserver: MutationObserver | null = null;

function watchDocumentTitle(): void {
  if (titleObserver || typeof MutationObserver === "undefined") return;
  titleObserver = new MutationObserver(() => {
    if (latchedTitle && document.title !== latchedTitle) document.title = latchedTitle;
  });
  /* childList on <head> catches Next REPLACING the <title> element wholesale;
   * subtree + characterData catches it rewriting the text node inside the
   * existing one. Both occur, depending on how the metadata branch commits. */
  titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
}

export function applyDocumentTitle(businessName: string | null | undefined): void {
  if (typeof document === "undefined" || !businessName) return;
  latchedTitle = businessName;
  if (document.title !== businessName) document.title = businessName;
  watchDocumentTitle();
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
 * script in app/(product)/layout.tsx, exactly like tenantSession.ts keys sessions per
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

/* The resolved sidebar ground and text colours, replayed by brand-preload.tsx
 * before first paint. Without it a business with a light sidebar would flash
 * the default dark one (with white text) on every load. Plain hex values, so
 * the inline script needs no colour maths of its own. */
export const BRAND_VARS_KEY_PREFIX = "cloudhouse_brand_vars::";

export function cacheBrandTheme(slug: string | null, theme: BrandTheme): void {
  if (typeof window === "undefined") return;
  try {
    if (theme.primary) {
      window.localStorage.setItem(BRAND_COLOR_KEY_PREFIX + (slug || "default"), theme.primary);
    }
    const c = resolveBrandColors(theme);
    window.localStorage.setItem(
      BRAND_VARS_KEY_PREFIX + (slug || "default"),
      JSON.stringify({ "--nav": c.nav, "--nav-2": c.nav2, "--nav-fg": c.navFg, "--on-brand": c.onBrand, "--nav-ink": c.navInk })
    );
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

/* --- Pre-paint logo cache ---------------------------------------------------
 *
 * The colour and the tab text are replayed before the first paint; the LOGO
 * was not, which is why a cold load still showed the platform mark for a
 * frame or two in the tab icon and on the login panel. Same cache, same
 * per-slug keying, read synchronously by brand-preload.tsx.
 *
 * Product rule this serves: a business must never see any brand but its own,
 * not even for a frame — not another business's, and not the vendor's. When
 * no cached logo exists (the very first visit on this browser) the correct
 * answer is a neutral placeholder, never the platform mark.
 */
export const BRAND_LOGO_KEY_PREFIX = "cloudhouse_brand_logo::";

export function cacheBrandLogo(slug: string | null, logoUrl: string): void {
  if (typeof window === "undefined" || !logoUrl) return;
  try {
    window.localStorage.setItem(BRAND_LOGO_KEY_PREFIX + (slug || "default"), logoUrl);
  } catch {
    /* Private mode / storage disabled — first paint falls back to neutral */
  }
}

export function readCachedBrandLogo(slug: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BRAND_LOGO_KEY_PREFIX + (slug || "default"));
  } catch {
    return null;
  }
}

export function readCachedDocumentTitle(slug: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BRAND_TITLE_KEY_PREFIX + (slug || "default"));
  } catch {
    return null;
  }
}

/* The tab text shown while a business's own name is still unknown. Never the
 * platform name: see the header above. A single space would collapse to the
 * URL in most browsers, which leaks nothing but reads as broken, so this says
 * what is actually happening. */
export const NEUTRAL_DOCUMENT_TITLE = "Loading…";
