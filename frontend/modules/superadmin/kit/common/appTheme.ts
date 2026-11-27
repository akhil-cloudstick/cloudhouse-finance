// One picked brand colour regenerates all six app.css --brand* steps by walking a fixed oklch curve.

export type Oklch = { l: number; c: number; h: number };

// Reference ramp from app.css's :root; chroma is a RATIO of --brand's own chroma so saturation scales with the pick. Keep in step with app.css.
const BRAND_REFERENCE_CHROMA = 0.162;

const RAMP: { token: string; l: number; chromaRatio: number }[] = [
  { token: "--brand-deep", l: 0.4, chromaRatio: 0.145 / BRAND_REFERENCE_CHROMA },
  { token: "--brand", l: 0.515, chromaRatio: 1 },
  // --brand-mid is deliberately LIGHTER than --brand: it's a fill (tabs, selected days), never text.
  { token: "--brand-mid", l: 0.58, chromaRatio: 0.15 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-light", l: 0.75, chromaRatio: 0.1 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-pale", l: 0.955, chromaRatio: 0.02 / BRAND_REFERENCE_CHROMA },
  { token: "--brand-faint", l: 0.983, chromaRatio: 0.008 / BRAND_REFERENCE_CHROMA },
];

/** The platform default, mirroring app.css and backend/internal/branding. */
export const DEFAULT_BRAND_COLOR = "#6054bf";

// Hand-rolled sRGB <-> OKLCH (Ottosson's OKLab transform) since the app has no colour library dependency.

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

// Returns channels in 0..1 plus whether the colour fell outside sRGB, which gamutFit uses to walk chroma down.
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

// Binary search on chroma until the colour fits sRGB, keeping L/H exact (browsers disagree on out-of-gamut mapping).
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

export type BrandRamp = Record<string, Oklch>;

// Regenerates all six brand steps from one colour. Falls back to the default on a bad value instead of throwing, since this runs during first paint.
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
  // --brand is pinned to the EXACT picked colour (gamut-fit only), not the RAMP table's l:0.515 — otherwise a dark pick like navy renders noticeably lighter than entered.
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

// Secondary/accent colours are OPTIONAL (unset = don't emit those variables). deriveNamedRamp generalises deriveBrandRamp to write under an arbitrary token prefix (--brand2, --brand3).

const RAMP_SUFFIXES = ["deep", "", "mid", "light", "pale", "faint"] as const;

/** deriveNamedRamp, e.g. prefix "--brand2" -> --brand2-deep/--brand2/--brand2-mid/... */
function deriveNamedRamp(hex: string, prefix: string): BrandRamp {
  const ramp = deriveBrandRamp(hex);
  const out: BrandRamp = {};
  const brandTokens = Object.keys(ramp);
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

// FontFamily is a FIXED allow-list (must match backend profile.go's knownFontFamilies) since it's written straight into a CSS property.
// Each value leads with the next/font CSS variable (app/(product)/layout.tsx); a bare name here would fall through to the system font.
export const FONT_FAMILIES: Record<string, string> = {
  inter: 'var(--font-sans, "Inter"), system-ui, -apple-system, "Segoe UI", sans-serif',
  system: '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
  lora: 'var(--font-lora, "Lora"), Georgia, "Times New Roman", serif',
  poppins: 'var(--font-poppins, "Poppins"), system-ui, -apple-system, "Segoe UI", sans-serif',
};
export const DEFAULT_FONT_FAMILY = "inter";

/** Base font-size multiplier per scale preset, applied as --brand-font-scale. */
export const FONT_SCALES: Record<string, number> = {
  compact: 0.9375,
  default: 1,
  comfortable: 1.0625,
};
export const DEFAULT_FONT_SCALE = "default";

// LogoScale/LogoDisplay presets must stay in sync with backend profile.go's knownLogoScales/knownLogoDisplays.
// Range goes up to 1.7x: a real tenant needed an 80px logo against this app's 48px base slot, beyond the old 1.25 cap.
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


// These two SVG data-URI decorations can't read a CSS variable internally, so they're rebuilt here with the derived hex (# must be %-encoded or the URI truncates).
function pagePatternURI(hex: string): string {
  const c = encodeURIComponent(hex);
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='${c}' stroke-width='0.5' opacity='0.035'%3E%3Cpath d='M60 8 L112 60 L60 112 L8 60 Z'/%3E%3Ccircle cx='60' cy='60' r='14'/%3E%3C/g%3E%3C/svg%3E")`;
}

function selectCaretURI(hex: string): string {
  const c = encodeURIComponent(hex);
  return `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='${c}' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
}
/** Everything applyBrandTheme can set. Every field optional except primary. */
export type BrandTheme = {
  primary?: string | null | undefined;
  secondary?: string | null;
  fontFamily?: string | null;
  fontScale?: string | null;
  /** Text on the sidebar ground; empty = automatic (see autoTextColor). */
  navText?: string | null;
  /** Text on primary-colour fills; empty = automatic. */
  onBrandText?: string | null;
};

// Auto text colour rule: white unless it fails WCAG AA (4.5:1) on the ground AND a dark ink of the ground's hue reads better. A vendor-picked colour always wins.
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

// Sidebar ground: secondary colour when set, else a dark shade on the primary's hue (calibrated against reference navy #0e2050).
function navOklchFor(primary: string, secondary: string | null | undefined): Oklch {
  const primaryOklch = hexToOklch(primary || DEFAULT_BRAND_COLOR) ?? hexToOklch(DEFAULT_BRAND_COLOR)!;
  const sidebarSourceOklch = secondary ? hexToOklch(secondary) : null;
  return sidebarSourceOklch
    ? gamutFit(sidebarSourceOklch)
    : gamutFit({ l: 0.22, c: Math.min(primaryOklch.c * 0.65, 0.11), h: primaryOklch.h });
}

// Gradient stop: lighter than a dark ground, darker than a light one (lightening an already-light ground just clips to white).
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

/** The CSS variables a theme sets, scoped to an element instead of the document (for the console preview). */
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

// Writes the ramp(s) and font variables onto the document root. Accepts a bare hex (legacy call shape) or a full BrandTheme; secondary is optional and clears --brand2 when unset. Safe before React mounts and safe to call repeatedly.
export function applyBrandTheme(theme: string | null | undefined | BrandTheme): void {
  if (typeof document === "undefined") return;
  const t: BrandTheme = typeof theme === "string" || theme == null ? { primary: theme as string | null | undefined } : (theme as BrandTheme);
  const root = document.documentElement;
  const ramp = deriveBrandRamp(t.primary || DEFAULT_BRAND_COLOR);
  for (const [token, color] of Object.entries(ramp)) {
    root.style.setProperty(token, oklchToCss(color));
  }
  const brandHex = oklchToHex(ramp["--brand"]);
  root.style.setProperty("--page-pattern", pagePatternURI(brandHex));
  root.style.setProperty("--select-caret", selectCaretURI(brandHex));

  // --nav/--nav-2: secondary colour when set, else auto-derived from primary's hue. Deliberately no separate "sidebar colour" field (removed in favour of secondary; do not reintroduce t.sidebarColor).
  const primaryOklch = hexToOklch(t.primary || DEFAULT_BRAND_COLOR) ?? hexToOklch(DEFAULT_BRAND_COLOR)!;
  const navOklch = navOklchFor(t.primary || DEFAULT_BRAND_COLOR, t.secondary);
  root.style.setProperty("--nav", oklchToCss(navOklch));
  root.style.setProperty("--nav-2", oklchToCss(nav2OklchFor(navOklch)));

  // Set every time (never left over from a previous business) since a light sidebar with white text is unreadable.
  const colors = resolveBrandColors(t);
  root.style.setProperty("--nav-fg", colors.navFg);
  root.style.setProperty("--on-brand", colors.onBrand);
  root.style.setProperty("--nav-ink", colors.navInk);

  // --nav-label (sidebar section headings): a muted, mid-lightness step on the primary's own hue, not a flat white-at-alpha, so it tracks the tenant's colour.
  const navLabelOklch = gamutFit({ l: 0.55, c: Math.min(primaryOklch.c * 0.3, 0.05), h: primaryOklch.h });
  root.style.setProperty("--nav-label", oklchToCss(navLabelOklch));

  if (t.secondary) applyNamedRamp(root.style, t.secondary, "--brand2");
  else clearNamedRamp(root.style, "--brand2");

  // --brand-gradient: the login panel's divider line (login.css's .bp-rule). Uses only primary/secondary, not a dedicated 3rd colour (not worth the confusion for one divider line).
  const secondOklch = t.secondary ? hexToOklch(t.secondary) : null;
  const stop0 = oklchToCss(ramp["--brand-deep"]);
  const stop1 = secondOklch ? oklchToCss(gamutFit(secondOklch)) : oklchToCss(ramp["--brand-light"]);
  root.style.setProperty("--brand-gradient", `linear-gradient(135deg, ${stop0} 0%, ${stop1} 100%)`);

  const fontFamily = FONT_FAMILIES[t.fontFamily || ""] || FONT_FAMILIES[DEFAULT_FONT_FAMILY];
  root.style.setProperty("--brand-font-family", fontFamily);
  const fontScale = FONT_SCALES[t.fontScale || ""] ?? FONT_SCALES[DEFAULT_FONT_SCALE];
  root.style.setProperty("--brand-font-scale", String(fontScale));
}

// Installs the tab icon and LATCHES it: a MutationObserver re-appends ours whenever something else inserts a later <link rel="icon">, since browsers use the last one in tree order. An empty href is a no-op, not a clear. Prefer applyBrandFavicon below (turns a raw logo into a tab-size-visible icon).
let latchedFavicon: string | null = null;
let faviconObserver: MutationObserver | null = null;

function faviconIsCurrent(): boolean {
  const icons = document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
  const last = icons[icons.length - 1];
  return !!last && last.hasAttribute("data-brand-icon") && last.getAttribute("href") === latchedFavicon;
}

function insertFavicon(href: string): void {
  // Remove-and-reinsert (not mutate .href): some browsers only re-fetch a favicon on insertion. Only our own data-brand-icon link is removed, never one React may own.
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

// buildFavicon normalises an arbitrary uploaded logo into a small square PNG: trims transparent margins, contain-fits it, adds an outline only where the artwork would vanish into a light/dark tab strip, and falls back to initials-on-brand-colour. Needed because raw logos (wide wordmarks, white-on-transparent art) are often invisible at 16px.
const FAVICON_SIZE = 64;
/** Part of the cache key — bump when the drawing below changes. */
const FAVICON_VERSION = "3";
/** Below this share of transparent pixels a logo counts as opaque. */
const FAVICON_OPAQUE_RATIO = 0.05;
// Typical tab-strip luminances (Chrome's #dee1e6/#35363a). A SHARE of visible pixels, not an average, since a mostly-white logo with blue detail still reads fine on a light tab.
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

function monogramFavicon(brandColor: string, text: string): string | null {
  const ctx = newCanvas(FAVICON_SIZE, FAVICON_SIZE);
  if (!ctx) return null;
  const rgb = parseHexColor(brandColor) ?? parseHexColor(DEFAULT_BRAND_COLOR)!;
  const tileLum = relativeLuminance(...rgb);
  roundedTile(ctx, `rgb(${rgb.join(",")})`);
  if (text) {
    ctx.fillStyle = contrastRatio(tileLum, 1) >= contrastRatio(tileLum, relativeLuminance(17, 17, 17)) ? "#fff" : "#111";
    ctx.font = `700 ${text.length > 2 ? 21 : text.length > 1 ? 28 : 38}px ${FAVICON_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, FAVICON_SIZE / 2, FAVICON_SIZE / 2 + 2);
  }
  return ctx.canvas.toDataURL("image/png");
}

// Throws if the canvas is tainted (cross-origin logo without CORS); the caller handles that.
function logoFavicon(img: HTMLImageElement): string | null {
  // Analyse at a bounded size so a 4000px original doesn't cost more than a 256px one.
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

  // No background, ever. Only artwork that would vanish into a strip gets a thin outline matching its own shape.
  if (!opaque) {
    const outline =
      showsOnLight / art < FAVICON_VISIBLE_SHARE
        ? "rgba(0,0,0,0.85)"
        : showsOnDark / art < FAVICON_VISIBLE_SHARE
          ? "rgba(255,255,255,0.9)"
          : "";
    if (outline) {
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

// Returns a normalised PNG data URL when possible; never throws. Falls back to the raw logo URL only when it loads but can't be read (cross-origin, no CORS).
export type FaviconSource = {
  logoUrl: string;
  brandColor: string;
  name: string;
  /** Letters to draw instead of the logo when it's a wide wordmark (unreadable at 16px). Up to 3 characters. */
  monogram?: string | undefined;
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

// Pre-paint cache of the generated icon per slug, read synchronously by brand-preload.tsx. `src` records what it was built from, so a changed logo/colour/name rebuilds it.
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

// Called by BrandingProvider once branding is known: builds (or reuses) the normalised icon, shows it, caches it.
export async function applyBrandFavicon(
  slug: string | null,
  brand: FaviconSource
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!brand.logoUrl && !brand.name) return;
  // FAVICON_VERSION first so bumping it rebuilds every cached icon after a drawing change.
  const src = [FAVICON_VERSION, brand.logoUrl, brand.brandColor, brand.name, brand.monogram || ""].join("|");
  const cached = readCachedFavicon(slug);
  if (cached && cached.src === src) {
    applyFavicon(cached.icon);
    return;
  }
  // A later call supersedes this one.
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

// applyFavicon's counterpart for the tab text. A plain assignment isn't enough: Next's App Router resolves <Metadata> in a separate branch that can commit AFTER this runs, overwriting the real title back to "Loading…" (or briefly empty, showing the raw URL) in a race. So the title is LATCHED and re-asserted by a MutationObserver whenever something else changes it. One-directional: only a later applyDocumentTitle call changes the latch; an empty name is a no-op, not a release.
let latchedTitle: string | null = null;
let titleObserver: MutationObserver | null = null;

function watchDocumentTitle(): void {
  if (titleObserver || typeof MutationObserver === "undefined") return;
  titleObserver = new MutationObserver(() => {
    if (latchedTitle && document.title !== latchedTitle) document.title = latchedTitle;
  });
  // childList catches Next replacing <title> wholesale; subtree+characterData catches it rewriting the text node in place.
  titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
}

export function applyDocumentTitle(businessName: string | null | undefined): void {
  if (typeof document === "undefined" || !businessName) return;
  latchedTitle = businessName;
  if (document.title !== businessName) document.title = businessName;
  watchDocumentTitle();
}

// Cached for the same reason as the colour: without a replay value, first paint briefly shows the platform title instead of the business's own (see brand-preload.tsx).
export const BRAND_TITLE_KEY_PREFIX = "cloudhouse_brand_title::";

export function cacheDocumentTitle(slug: string | null, businessName: string): void {
  if (typeof window === "undefined" || !businessName) return;
  try {
    window.localStorage.setItem(BRAND_TITLE_KEY_PREFIX + (slug || "default"), businessName);
  } catch {
    /* Private mode / storage disabled */
  }
}

// next.config.ts uses output: "export" (no server render), so the colour is cached per slug and replayed by a blocking script in app/(product)/layout.tsx before first paint.

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

// Full-theme cache. readCachedBrandTheme falls back to the old plain-hex key when JSON.parse fails, for the migration case.
export const BRAND_THEME_KEY_PREFIX = "cloudhouse_brand_theme::";

// Resolved sidebar ground/text colours as plain hex, replayed before first paint so the inline script needs no colour maths and a light sidebar doesn't flash dark.
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
    // Private mode / storage disabled — theme still applies this load, flashes default next time.
  }
}

export function readCachedBrandTheme(slug: string | null): BrandTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRAND_THEME_KEY_PREFIX + (slug || "default"));
    if (raw) return JSON.parse(raw) as BrandTheme;
  } catch {
    // fall through to the plain-colour cache below
  }
  const hex = readCachedBrandColor(slug);
  return hex ? { primary: hex } : null;
}

// Pre-paint logo cache, same per-slug keying as colour/title, read synchronously by brand-preload.tsx. Rule: a business must never see any other brand, even for a frame — first visit (no cache) falls back to a neutral placeholder, never the platform mark.
export const BRAND_LOGO_KEY_PREFIX = "cloudhouse_brand_logo::";

export function cacheBrandLogo(slug: string | null, logoUrl: string): void {
  if (typeof window === "undefined" || !logoUrl) return;
  try {
    window.localStorage.setItem(BRAND_LOGO_KEY_PREFIX + (slug || "default"), logoUrl);
  } catch {
    // Private mode / storage disabled — first paint falls back to neutral
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

// Tab text while the business name is unknown. Never the platform name; not a single space either (collapses to the URL in most browsers).
export const NEUTRAL_DOCUMENT_TITLE = "Loading…";
